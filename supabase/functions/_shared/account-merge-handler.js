"use strict";

/**
 * Account Merge — Shared Request Handler (Node.js / CommonJS) (P-AUTH-05B-1)
 *
 * Mirrors `subscription-checkout-handler.js`'s convention: this file is the
 * Node.js-testable source of truth; the Supabase Edge Runtime (Deno) loads
 * `account-merge-handler.ts`, a line-for-line ESM twin. Whenever business
 * logic changes here, mirror the change in the `.ts` twin (same function
 * names, same error codes, same HTTP status mapping).
 *
 * Implements the Begin/Finalize contract from
 * docs/0-review/review-auth/review-auth-05A.1-hotfix.md exactly:
 *
 * Begin (requirement 1/2):
 *   - Request body may ONLY contain `targetEmail` — any other field
 *     (anonymousUserId, existingUserId, email hash, idempotencyKey,
 *     service-role key, ...) is rejected outright (400 INVALID_REQUEST).
 *   - The caller's own identity comes SOLELY from the already-verified
 *     `user` object (resolved server-side by the Edge Function entrypoint
 *     from the Authorization JWT, via `resolveAuthenticatedUser()`) — never
 *     from the request body. `user.is_anonymous` MUST be `true`.
 *   - `targetEmail` is normalized then hashed (via merge-claim-crypto.js)
 *     BEFORE being sent to `create_account_merge_claim`.
 *   - A high-entropy claim token is generated here, hashed, and ONLY the
 *     hash is ever persisted (via the repository/RPC) or logged. The raw
 *     token is returned to the caller exactly once, in the response body.
 *
 * Finalize (requirement 1/4/5/6):
 *   - Request body may ONLY contain `claimToken` — `anonymousUserId`,
 *     `existingUserId`, `email`, `emailHash`, `idempotencyKey` (or any
 *     other field) cause the WHOLE request to be rejected (400
 *     INVALID_REQUEST), never silently ignored-but-still-processed.
 *   - The caller's own existing-account identity (`user.id`/`user.email`)
 *     comes SOLELY from the already-verified `user` object. `user.
 *     is_anonymous` MUST be `false`.
 *   - Calls the 3-argument `finalize_account_merge` RPC (P-AUTH-05A.1) —
 *     there is NO idempotency-key parameter to forward; the database
 *     computes its own canonical key internally.
 *   - EVERY failure mode (claim not found, expired, email mismatch,
 *     already used, data inconsistency, RPC/network error) is translated
 *     to the EXACT SAME external error code/message
 *     (`MERGE_CLAIM_INVALID`) — never leaking which specific reason
 *     applies, whether a claim/email exists, or any raw SQL detail. The
 *     real reason is only ever logged server-side via `console.error`.
 *
 * Hotfix (P-AUTH-05B-1 hotfix, requirement 6): server-side logs (both
 * Begin and Finalize failure paths) NEVER include the raw error message,
 * claimToken, claim/token hash, email, Authorization header, or request
 * body — only `correlationId` plus a small ALLOWLISTED `reason` code (see
 * `classifyFinalizeFailureReason` below). A raw `Error.message` is never
 * safe to log as-is here: it could originate from a future/unexpected
 * code path and isn't guaranteed to be PII-free, so this module never
 * forwards it verbatim to any log sink.
 */

const crypto = require("node:crypto");
const { normalizeEmailForHash, hashClaimValue } = require("../../../js/services/auth/merge-claim-crypto");

const ERROR_HTTP_STATUS = Object.freeze({
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  MERGE_REQUIRES_ANONYMOUS_SESSION: 403,
  MERGE_REQUIRES_OFFICIAL_SESSION: 403,
  MERGE_CLAIM_INVALID: 409,
  MERGE_BEGIN_FAILED: 502
});

function toHttpStatus(code) {
  return ERROR_HTTP_STATUS[code] || 500;
}

// Hotfix (P-AUTH-05B-1 hotfix, requirement 6): a FIXED, small allowlist of
// server-log-only reason codes for a Finalize RPC failure — classified
// from the error message via pattern-matching, but the message itself is
// NEVER logged, only whichever single fixed code below matched (or
// "UNKNOWN" if none did). This lets ops distinguish failure classes in
// logs without ever risking a leaked email/token/SQL detail.
const FINALIZE_FAILURE_REASON_PATTERNS = Object.freeze([
  { reason: "CLAIM_NOT_FOUND", pattern: /claim not found/i },
  { reason: "CLAIM_EXPIRED", pattern: /expired/i },
  { reason: "EMAIL_MISMATCH", pattern: /email does not match|email mismatch/i },
  { reason: "DATA_INCONSISTENCY", pattern: /data inconsistency/i }
]);

function classifyFinalizeFailureReason(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  for (const { reason, pattern } of FINALIZE_FAILURE_REASON_PATTERNS) {
    if (pattern.test(message)) {
      return reason;
    }
  }
  return "UNKNOWN";
}

const BEGIN_REQUIRED_FIELDS = ["targetEmail"];
// Denylist AND the body is also checked against an explicit allowlist
// below — both a required field and a hard reject-list for defense in
// depth, matching subscription-checkout-handler.js's existing style.
const BEGIN_ALLOWED_FIELDS = ["targetEmail"];

function validateBeginRequestShape(body) {
  const errors = [];

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

function validateFinalizeRequestShape(body) {
  const errors = [];

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

// 256 bits of entropy, hex-encoded (64 chars) — generated fresh per Begin
// call, never derived from anything predictable.
function generateClaimToken() {
  return crypto.randomBytes(32).toString("hex");
}

function errorResponse(statusCode, code, message, correlationId, details = null) {
  return {
    statusCode,
    correlationId,
    body: {
      ok: false,
      error: { code, message, details }
    }
  };
}

/**
 * @param {object} params
 * @param {object} params.body - parsed JSON request body (`{ targetEmail }` ONLY)
 * @param {object|null} params.user - Supabase auth user object
 *   (`is_anonymous`/`id`), resolved server-side from the Authorization
 *   header — NEVER derived from the request body.
 * @param {string} params.correlationId
 * @param {object} params.deps - `{ repository, ttlSeconds? }`
 */
async function handleBeginMergeRequest({ body, user, correlationId, deps = {} }) {
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

  const targetEmailHash = hashClaimValue(normalizeEmailForHash(body.targetEmail));
  const claimToken = generateClaimToken();
  const claimTokenHash = hashClaimValue(claimToken);

  const repository = deps.repository;
  let claim;
  try {
    claim = await repository.createClaim({
      anonymousUserId,
      claimTokenHash,
      targetEmailHash,
      ttlSeconds: deps.ttlSeconds || 900
    });
  } catch (error) {
    // Log the raw reason server-side ONLY — never the raw claimToken
    // itself (only its hash, which is already one-way and non-reversible,
    // is ever referenced anywhere in this module). Hotfix (P-AUTH-05B-1
    // hotfix, requirement 6): also never log the raw error message —
    // Begin failures have no interesting sub-classification today, so a
    // single fixed "RPC_ERROR" reason code is logged instead.
    console.error(JSON.stringify({
      level: "error",
      event: "account_merge_begin_failed",
      correlationId,
      reason: "RPC_ERROR"
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
        expiresAt: claim?.expires_at || null
      }
    }
  };
}

/**
 * @param {object} params
 * @param {object} params.body - parsed JSON request body (`{ claimToken }` ONLY)
 * @param {object|null} params.user - Supabase auth user object
 *   (`is_anonymous`/`id`/`email`), resolved server-side from the
 *   Authorization header — NEVER derived from the request body.
 * @param {string} params.correlationId
 * @param {object} params.deps - `{ repository }`
 */
async function handleFinalizeMergeRequest({ body, user, correlationId, deps = {} }) {
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

  const claimTokenHash = hashClaimValue(String(body.claimToken || "").trim());
  const existingUserEmailHash = hashClaimValue(normalizeEmailForHash(existingUserEmail));

  const repository = deps.repository;
  let request;
  try {
    request = await repository.finalizeMerge({ claimTokenHash, existingUserId, existingUserEmailHash });
  } catch (error) {
    // CRITICAL: every failure reason (claim not found / expired / email
    // mismatch / already used / data inconsistency / network error) maps
    // to the EXACT SAME external code+message — never leak which one
    // applies, whether a claim exists, or any raw SQL message. Hotfix
    // (P-AUTH-05B-1 hotfix, requirement 6): the SERVER-SIDE log is also
    // never the raw message — only `classifyFinalizeFailureReason(error)`'s
    // fixed allowlisted code, never `error.message`/claimToken/email/body.
    console.error(JSON.stringify({
      level: "error",
      event: "account_merge_finalize_failed",
      correlationId,
      reason: classifyFinalizeFailureReason(error)
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
        result: request?.result_json || {}
      }
    }
  };
}

module.exports = {
  handleBeginMergeRequest,
  handleFinalizeMergeRequest,
  validateBeginRequestShape,
  validateFinalizeRequestShape,
  generateClaimToken,
  classifyFinalizeFailureReason,
  toHttpStatus
};
