// ESM twin of `account-merge-handler.js`. Logic unchanged — see that
// file's header for the full rationale (Begin/Finalize contract from
// review-auth-05A.1-hotfix.md). Whenever business logic changes here,
// mirror the change in the `.js` twin (same function names, same error
// codes, same HTTP status mapping).
//
// Divergence forced by the runtime: `merge-claim-crypto.ts`'s
// `hashClaimValue`/`hashNormalizedEmail` are ASYNC (Web Crypto's
// `subtle.digest`), unlike the Node twin's synchronous `crypto.createHash`
// — every call site here is `await`ed accordingly.

import { normalizeEmailForHash, hashClaimValue } from "./lib/merge-claim-crypto.ts";

const ERROR_HTTP_STATUS: Record<string, number> = Object.freeze({
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  MERGE_REQUIRES_ANONYMOUS_SESSION: 403,
  MERGE_REQUIRES_OFFICIAL_SESSION: 403,
  MERGE_CLAIM_INVALID: 409,
  MERGE_BEGIN_FAILED: 502,
});

export function toHttpStatus(code: string): number {
  return ERROR_HTTP_STATUS[code] || 500;
}

// Hotfix (P-AUTH-05B-1 hotfix, requirement 6): a FIXED, small allowlist of
// server-log-only reason codes for a Finalize RPC failure — classified
// from the error message via pattern-matching, but the message itself is
// NEVER logged, only whichever single fixed code below matched (or
// "UNKNOWN" if none did). This lets ops distinguish failure classes in
// logs without ever risking a leaked email/token/SQL detail.
const FINALIZE_FAILURE_REASON_PATTERNS: { reason: string; pattern: RegExp }[] = [
  { reason: "CLAIM_NOT_FOUND", pattern: /claim not found/i },
  { reason: "CLAIM_EXPIRED", pattern: /expired/i },
  { reason: "EMAIL_MISMATCH", pattern: /email does not match|email mismatch/i },
  { reason: "DATA_INCONSISTENCY", pattern: /data inconsistency/i },
];

export function classifyFinalizeFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  for (const { reason, pattern } of FINALIZE_FAILURE_REASON_PATTERNS) {
    if (pattern.test(message)) {
      return reason;
    }
  }
  return "UNKNOWN";
}

const BEGIN_REQUIRED_FIELDS = ["targetEmail"];
const BEGIN_ALLOWED_FIELDS = ["targetEmail"];

// deno-lint-ignore no-explicit-any
export function validateBeginRequestShape(body: any): string[] {
  const errors: string[] = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ["Request body must be a JSON object."];
  }

  for (const field of BEGIN_REQUIRED_FIELDS) {
    if (typeof body[field] !== "string" || !body[field].trim()) {
      errors.push(`${field} is required.`);
    }
  }

  for (const key of Object.keys(body)) {
    if (!BEGIN_ALLOWED_FIELDS.includes(key)) {
      errors.push(`${key} is not allowed in the request body.`);
    }
  }

  return errors;
}

const FINALIZE_ALLOWED_FIELDS = ["claimToken"];

// deno-lint-ignore no-explicit-any
export function validateFinalizeRequestShape(body: any): string[] {
  const errors: string[] = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ["Request body must be a JSON object."];
  }

  if (typeof body.claimToken !== "string" || !body.claimToken.trim()) {
    errors.push("claimToken is required.");
  }

  for (const key of Object.keys(body)) {
    if (!FINALIZE_ALLOWED_FIELDS.includes(key)) {
      errors.push(`${key} is not allowed in the request body.`);
    }
  }

  return errors;
}

export function generateClaimToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function errorResponse(statusCode: number, code: string, message: string, correlationId: string, details: unknown = null) {
  return {
    statusCode,
    correlationId,
    body: {
      ok: false,
      error: { code, message, details },
    },
  };
}

export async function handleBeginMergeRequest({
  body,
  user,
  correlationId,
  deps = {},
  // deno-lint-ignore no-explicit-any
}: { body: any; user: any; correlationId: string; deps?: any }) {
  const validationErrors = validateBeginRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, { errors: validationErrors });
  }

  if (!user || user.is_anonymous !== true) {
    return errorResponse(
      403,
      "MERGE_REQUIRES_ANONYMOUS_SESSION",
      "此操作僅限尚未升級的訪客身份使用，請重新整理頁面後再試一次。",
      correlationId
    );
  }

  const anonymousUserId = String(user.id || "").trim();
  if (!anonymousUserId) {
    return errorResponse(401, "UNAUTHORIZED", "無法辨識使用者身份，請重新整理頁面後再試一次。", correlationId);
  }

  const targetEmailHash = await hashClaimValue(normalizeEmailForHash(body.targetEmail));
  const claimToken = generateClaimToken();
  const claimTokenHash = await hashClaimValue(claimToken);

  const repository = deps.repository;
  // deno-lint-ignore no-explicit-any
  let claim: any;
  try {
    claim = await repository.createClaim({
      anonymousUserId,
      claimTokenHash,
      targetEmailHash,
      ttlSeconds: deps.ttlSeconds || 900,
    });
  } catch (error) {
    // Hotfix (P-AUTH-05B-1 hotfix, requirement 6): never log the raw error
    // message — Begin failures have no interesting sub-classification
    // today, so a single fixed "RPC_ERROR" reason code is logged instead.
    console.error(JSON.stringify({
      level: "error",
      event: "account_merge_begin_failed",
      correlationId,
      reason: "RPC_ERROR",
    }));

    return errorResponse(502, "MERGE_BEGIN_FAILED", "無法建立合併請求，請稍後再試一次。", correlationId);
  }

  return {
    statusCode: 201,
    correlationId,
    body: {
      ok: true,
      data: {
        claimToken,
        expiresAt: claim?.expires_at || null,
      },
    },
  };
}

export async function handleFinalizeMergeRequest({
  body,
  user,
  correlationId,
  deps = {},
  // deno-lint-ignore no-explicit-any
}: { body: any; user: any; correlationId: string; deps?: any }) {
  const validationErrors = validateFinalizeRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, { errors: validationErrors });
  }

  if (!user || user.is_anonymous !== false) {
    return errorResponse(
      403,
      "MERGE_REQUIRES_OFFICIAL_SESSION",
      "請先完成既有帳號登入後再試一次。",
      correlationId
    );
  }

  const existingUserId = String(user.id || "").trim();
  const existingUserEmail = String(user.email || "").trim();
  if (!existingUserId || !existingUserEmail) {
    return errorResponse(401, "UNAUTHORIZED", "無法辨識使用者身份，請重新整理頁面後再試一次。", correlationId);
  }

  const claimTokenHash = await hashClaimValue(String(body.claimToken || "").trim());
  const existingUserEmailHash = await hashClaimValue(normalizeEmailForHash(existingUserEmail));

  const repository = deps.repository;
  // deno-lint-ignore no-explicit-any
  let request: any;
  try {
    request = await repository.finalizeMerge({ claimTokenHash, existingUserId, existingUserEmailHash });
  } catch (error) {
    // CRITICAL: every failure reason maps to the EXACT SAME external
    // code+message. Hotfix (P-AUTH-05B-1 hotfix, requirement 6): the
    // server-side log is also never the raw message — only
    // `classifyFinalizeFailureReason(error)`'s fixed allowlisted code.
    console.error(JSON.stringify({
      level: "error",
      event: "account_merge_finalize_failed",
      correlationId,
      reason: classifyFinalizeFailureReason(error),
    }));

    return errorResponse(
      409,
      "MERGE_CLAIM_INVALID",
      "合併驗證失敗，請重新開始既有帳號登入流程。",
      correlationId
    );
  }

  return {
    statusCode: 200,
    correlationId,
    body: {
      ok: true,
      data: {
        merged: true,
        mergeId: request?.id || null,
        result: request?.result_json || {},
      },
    },
  };
}
