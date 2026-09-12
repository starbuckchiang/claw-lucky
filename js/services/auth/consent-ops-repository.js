"use strict";

/**
 * Consent Ops Repository (WEB-HOME-01A)
 *
 * Thin wrapper around the SECURITY DEFINER RPC `record_user_consent`
 * (migration 20260910000300_user_consents_append_only.sql). Server-side /
 * Edge-Function-only (no `window.X =` export) — the RPC is granted
 * EXECUTE to `service_role` ONLY, so `supabaseClient` here MUST be a
 * service-role client, never the anon-key client used to verify the
 * caller's own JWT.
 *
 * No validation/business logic here (that lives in consent-ops-handler.js)
 * — this only maps a plain JS call onto the exact RPC parameter names and
 * normalizes `{ data, error }` into a return value or thrown error.
 *
 * Deno ESM twin: supabase/functions/_shared/lib/consent-ops-repository.ts.
 */

function createConsentOpsRepositoryFromSupabaseClient({ supabaseClient }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
    throw new Error("createConsentOpsRepositoryFromSupabaseClient requires a supabaseClient with rpc().");
  }

  return {
    // Idempotent append-only insert; a retry with the same
    // (userId, consentScope, idempotencyKey) returns the ORIGINAL row.
    // accepted_at is always the database's own now() — never a parameter.
    async recordConsent({
      userId,
      consentScope,
      source,
      termsVersion,
      privacyVersion,
      termsContentSha256,
      privacyContentSha256,
      correlationId,
      idempotencyKey
    }) {
      const { data, error } = await supabaseClient.rpc("record_user_consent", {
        p_user_id: userId,
        p_consent_scope: consentScope,
        p_source: source,
        p_terms_version: termsVersion,
        p_privacy_version: privacyVersion,
        p_terms_content_sha256: termsContentSha256,
        p_privacy_content_sha256: privacyContentSha256,
        p_correlation_id: correlationId,
        p_idempotency_key: idempotencyKey
      });

      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    }
  };
}

module.exports = {
  createConsentOpsRepositoryFromSupabaseClient
};
