// Consent Ops — Shared Request Handler (Deno / ESM) (WEB-HOME-01A)
//
// Line-for-line twin of consent-ops-handler.js (the Node.js-testable
// source of truth). Whenever business logic changes there, mirror it here
// (same function names, same error codes, same HTTP status mapping).

import {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  TERMS_CONTENT_SHA256,
  PRIVACY_CONTENT_SHA256,
} from "./lib/policy-versions.ts";

export const ENABLED_CONSENT_SCOPES = Object.freeze(["account_upgrade", "checkout"]);

export const ALLOWED_SOURCES = Object.freeze(["subscription_page", "account_upgrade_form"]);

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

const OWNER_ID_FIELDS = ["userId", "user_id", "ownerId", "owner_id"];

const SERVER_AUTHORITY_FIELDS = [
  "acceptedAt", "accepted_at",
  "termsVersion", "terms_version",
  "privacyVersion", "privacy_version",
  "termsContentSha256", "terms_content_sha256",
  "privacyContentSha256", "privacy_content_sha256",
];

// deno-lint-ignore no-explicit-any
export function validateRecordRequestShape(body: any): string[] {
  const errors: string[] = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ["Request body must be a JSON object."];
  }

  for (const field of ["consentScope", "source", "idempotencyKey"]) {
    if (typeof body[field] !== "string" || !body[field].trim()) {
      errors.push(`${field} is required.`);
    }
  }

  const allowedSet = new Set(["consentScope", "source", "idempotencyKey"]);
  for (const key of Object.keys(body)) {
    if (!allowedSet.has(key)) {
      errors.push(`${key} is not allowed in the request body.`);
    }
  }

  for (const field of [...OWNER_ID_FIELDS, ...SERVER_AUTHORITY_FIELDS]) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      errors.push(`${field} is not allowed in the request body.`);
    }
  }

  if (typeof body.consentScope === "string" && !ENABLED_CONSENT_SCOPES.includes(body.consentScope)) {
    errors.push("consentScope is not allowed.");
  }

  if (typeof body.source === "string" && !ALLOWED_SOURCES.includes(body.source)) {
    errors.push("source is not allowed.");
  }

  if (typeof body.idempotencyKey === "string" && !IDEMPOTENCY_KEY_PATTERN.test(body.idempotencyKey)) {
    errors.push("idempotencyKey format is invalid.");
  }

  return errors;
}

function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  correlationId: string,
  { retryable = false, details = null }: { retryable?: boolean; details?: unknown } = {},
) {
  return {
    statusCode,
    correlationId,
    body: { ok: false, error: { code, message, details, retryable: Boolean(retryable) } },
  };
}

function safeLog(event: string, correlationId: string, reason: string) {
  // Only correlationId + an allowlisted reason — never JWT/email/user id/
  // body/policy content.
  console.error(JSON.stringify({ level: "error", event, correlationId, reason }));
}

export function resolvePolicyFieldsForScope(consentScope: string) {
  if (consentScope === "account_upgrade") {
    return {
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION,
      termsContentSha256: TERMS_CONTENT_SHA256,
      privacyContentSha256: PRIVACY_CONTENT_SHA256,
    };
  }
  // checkout: consent re-confirms the Terms of Service only.
  return {
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: null,
    termsContentSha256: TERMS_CONTENT_SHA256,
    privacyContentSha256: null,
  };
}

// deno-lint-ignore no-explicit-any
export async function handleRecordConsentRequest({ body, user, correlationId, deps = {} }: any) {
  const validationErrors = validateRecordRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, {
      details: { errors: validationErrors },
    });
  }

  const userId = String(user?.id || "").trim();
  if (!userId) {
    return errorResponse(401, "UNAUTHORIZED", "無法辨識使用者身份，請重新整理頁面後再試一次。", correlationId);
  }

  const policyFields = resolvePolicyFieldsForScope(body.consentScope);

  try {
    const record = await deps.repository.recordConsent({
      userId,
      consentScope: body.consentScope,
      source: body.source,
      termsVersion: policyFields.termsVersion,
      privacyVersion: policyFields.privacyVersion,
      termsContentSha256: policyFields.termsContentSha256,
      privacyContentSha256: policyFields.privacyContentSha256,
      correlationId,
      idempotencyKey: body.idempotencyKey,
    });

    if (!record || !record.out_id) {
      safeLog("consent_ops_record_failed", correlationId, "EMPTY_RPC_RESULT");
      return errorResponse(502, "CONSENT_RECORD_FAILED", "同意紀錄儲存失敗，請再試一次。", correlationId, { retryable: true });
    }

    return {
      statusCode: 200,
      correlationId,
      body: {
        ok: true,
        data: {
          consentId: String(record.out_id),
          consentScope: String(record.out_consent_scope || body.consentScope),
          termsVersion: record.out_terms_version || null,
          privacyVersion: record.out_privacy_version || null,
          acceptedAt: record.out_accepted_at || null,
          wasExisting: Boolean(record.out_was_existing),
        },
      },
    };
  } catch (_error) {
    safeLog("consent_ops_record_failed", correlationId, "RPC_ERROR");
    return errorResponse(502, "CONSENT_RECORD_FAILED", "同意紀錄儲存失敗，請再試一次。", correlationId, { retryable: true });
  }
}
