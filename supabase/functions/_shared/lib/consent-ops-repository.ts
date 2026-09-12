// Consent Ops Repository (WEB-HOME-01A) — Deno ESM twin of
// js/services/auth/consent-ops-repository.js. Keep both files in sync;
// the Node.js CJS original is the tested source of truth.
//
// Server-side only: `record_user_consent` is granted EXECUTE to
// service_role ONLY, so the injected client must be the service-role
// client from supabase-clients.ts.

// deno-lint-ignore no-explicit-any
type SupabaseLikeClient = { rpc: (fn: string, args: Record<string, unknown>) => Promise<any> };

export function createConsentOpsRepositoryFromSupabaseClient({
  supabaseClient,
}: {
  supabaseClient: SupabaseLikeClient;
}) {
  if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
    throw new Error("createConsentOpsRepositoryFromSupabaseClient requires a supabaseClient with rpc().");
  }

  return {
    async recordConsent({
      userId,
      consentScope,
      source,
      termsVersion,
      privacyVersion,
      termsContentSha256,
      privacyContentSha256,
      correlationId,
      idempotencyKey,
    }: {
      userId: string;
      consentScope: string;
      source: string;
      termsVersion: string | null;
      privacyVersion: string | null;
      termsContentSha256: string | null;
      privacyContentSha256: string | null;
      correlationId: string;
      idempotencyKey: string;
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
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
  };
}
