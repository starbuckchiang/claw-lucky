"use strict";

/**
 * Account Merge Repository (P-AUTH-05B-1)
 *
 * Thin wrapper around the two SECURITY DEFINER RPCs added by the P-AUTH-05A
 * migrations (`create_account_merge_claim`, `finalize_account_merge`).
 * Server-side / Edge-Function-only (no `window.X =` export, matching the
 * existing Node/Edge-only convention used by
 * `js/services/wallpaper/points-repository.js`) — both RPCs are granted
 * EXECUTE to `service_role` ONLY, so `supabaseClient` here MUST be a
 * service-role client (`createServiceClient()` in
 * supabase/functions/_shared/supabase-clients.ts), never the anon-key
 * client used to verify the caller's own JWT.
 *
 * This module does no validation/business logic itself (that lives in
 * account-merge-handler.js) — it only translates a plain JS call into the
 * exact RPC parameter names the SQL functions expect, and normalizes a
 * Supabase `{ data, error }` result into either a return value or a thrown
 * error (matching the style of the other `js/services/**` repositories,
 * e.g. job-repository.js).
 */

function createAccountMergeRepositoryFromSupabaseClient({ supabaseClient }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
    throw new Error("createAccountMergeRepositoryFromSupabaseClient requires a supabaseClient with rpc().");
  }

  return {
    // Begin Merge (spec Section 7): creates a claim row keyed by a HASH of
    // a one-time token — the raw token itself is never passed to or
    // returned by this repository/RPC, only its hash (computed by the
    // caller via merge-claim-crypto.js BEFORE calling this).
    async createClaim({ anonymousUserId, claimTokenHash, targetEmailHash, ttlSeconds }) {
      const { data, error } = await supabaseClient.rpc("create_account_merge_claim", {
        p_anonymous_user_id: anonymousUserId,
        p_claim_token_hash: claimTokenHash,
        p_target_email_hash: targetEmailHash,
        p_ttl_seconds: ttlSeconds
      });

      if (error) {
        throw error;
      }

      return data;
    },

    // Finalize Merge: the 3-argument RPC (P-AUTH-05A.1) — deliberately has
    // NO idempotency-key parameter; the database computes its own
    // canonical key internally from `claimTokenHash`'s claim row +
    // `existingUserId`. This repository must never be extended to accept
    // or forward a caller-supplied idempotency key.
    async finalizeMerge({ claimTokenHash, existingUserId, existingUserEmailHash }) {
      const { data, error } = await supabaseClient.rpc("finalize_account_merge", {
        p_claim_token_hash: claimTokenHash,
        p_existing_user_id: existingUserId,
        p_existing_user_email_hash: existingUserEmailHash
      });

      if (error) {
        throw error;
      }

      return data;
    }
  };
}

module.exports = {
  createAccountMergeRepositoryFromSupabaseClient
};
