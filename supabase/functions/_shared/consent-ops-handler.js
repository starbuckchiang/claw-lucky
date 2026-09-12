"use strict";

/**
 * Consent Ops — Shared Request Handler (Node.js / CommonJS) (WEB-HOME-01A)
 *
 * Mirrors wallet-ops-handler.js's convention: this file is the
 * Node.js-testable source of truth; the Supabase Edge Runtime (Deno) loads
 * `consent-ops-handler.ts`, a line-for-line ESM twin.
 *
 * ONE route:
 *   - record -> writes an append-only user_consents row via
 *               public.record_user_consent (idempotent)
 *
 * Server authority (WEB-HOME-01A section 5): the caller's identity comes
 * ONLY from `params.user` (verified JWT); terms/privacy versions and
 * content hashes come ONLY from the canonical policy module
 * (policy-versions.js) — the request body may not carry user_id,
 * accepted_at, versions, or hashes at all (strict allowlist; any extra
 * field rejects the WHOLE request). accepted_at is the database's own
 * now() inside the RPC.
 *
 * digital_content_waiver: the feature flag (terms-consent.js
 * ENABLE_DIGITAL_CONTENT_WAIVER) is OFF — this handler REJECTS that scope
 * outright (400) and never writes a record for it, so no fake waiver
 * consent can exist while the flag is closed.
 *
 * Safe logs: only correlationId + an allowlisted reason code — never the
 * JWT, email, user id, request body, or policy text.
 */

const {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  TERMS_CONTENT_SHA256,
  PRIVACY_CONTENT_SHA256
} = require("../../../js/services/auth/policy-versions");

// Scopes accepted over HTTP while the waiver flag is OFF.
const ENABLED_CONSENT_SCOPES = Object.freeze(["account_upgrade", "checkout"]);

const ALLOWED_SOURCES = Object.freeze(["subscription_page", "account_upgrade_form"]);

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

const OWNER_ID_FIELDS = ["userId", "user_id", "ownerId", "owner_id"];

// Server-authoritative fields a caller must never attempt to supply.
const SERVER_AUTHORITY_FIELDS = [
  "acceptedAt", "accepted_at",
  "termsVersion", "terms_version",
  "privacyVersion", "privacy_version",
  "termsContentSha256", "terms_content_sha256",
  "privacyContentSha256", "privacy_content_sha256"
];

function validateRecordRequestShape(body) {
  const errors = [];

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

function errorResponse(statusCode, code, message, correlationId, { retryable = false, details = null } = {}) {
  return {
    statusCode,
    correlationId,
    body: { ok: false, error: { code, message, details, retryable: Boolean(retryable) } }
  };
}

function safeLog(event, correlationId, reason) {
  // Only correlationId + an allowlisted reason — never JWT/email/user id/
  // body/policy content.
  console.error(JSON.stringify({ level: "error", event, correlationId, reason }));
}

// The server decides what the user consented to, per scope.
function resolvePolicyFieldsForScope(consentScope) {
  if (consentScope === "account_upgrade") {
    return {
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION,
      termsContentSha256: TERMS_CONTENT_SHA256,
      privacyContentSha256: PRIVACY_CONTENT_SHA256
    };
  }
  // checkout: consent re-confirms the Terms of Service only.
  return {
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: null,
    termsContentSha256: TERMS_CONTENT_SHA256,
    privacyContentSha256: null
  };
}

async function handleRecordConsentRequest({ body, user, correlationId, deps = {} }) {
  const validationErrors = validateRecordRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, {
      details: { errors: validationErrors }
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
      idempotencyKey: body.idempotencyKey
    });

    if (!record || !record.out_id) {
      safeLog("consent_ops_record_failed", correlationId, "EMPTY_RPC_RESULT");
      return errorResponse(502, "CONSENT_RECORD_FAILED", "同意紀錄儲存失敗，請再試一次。", correlationId, { retryable: true });
    }

    // Response carries no email/JWT/user id — only the consent's own
    // non-sensitive metadata.
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
          wasExisting: Boolean(record.out_was_existing)
        }
      }
    };
  } catch (_error) {
    // Any RPC/DB failure collapses to one generic retryable code — the raw
    // error is never logged or surfaced.
    safeLog("consent_ops_record_failed", correlationId, "RPC_ERROR");
    return errorResponse(502, "CONSENT_RECORD_FAILED", "同意紀錄儲存失敗，請再試一次。", correlationId, { retryable: true });
  }
}

module.exports = {
  handleRecordConsentRequest,
  validateRecordRequestShape,
  resolvePolicyFieldsForScope,
  ENABLED_CONSENT_SCOPES,
  ALLOWED_SOURCES,
  IDEMPOTENCY_KEY_PATTERN
};
