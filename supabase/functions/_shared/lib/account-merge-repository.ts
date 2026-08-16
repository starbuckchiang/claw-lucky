// Deno twin of js/services/auth/account-merge-repository.js — used by the
// account-merge Edge Function (P-AUTH-05B-1). Same RPC parameter names,
// same "service_role client only" requirement. See that file's header for
// the full rationale.

// deno-lint-ignore no-explicit-any
export function createAccountMergeRepositoryFromSupabaseClient({ supabaseClient }: { supabaseClient: any }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
    throw new Error("createAccountMergeRepositoryFromSupabaseClient requires a supabaseClient with rpc().");
  }

  return {
    async createClaim({
      anonymousUserId,
      claimTokenHash,
      targetEmailHash,
      ttlSeconds
    }: {
      anonymousUserId: string;
      claimTokenHash: string;
      targetEmailHash: string;
      ttlSeconds: number;
      // deno-lint-ignore no-explicit-any
    }): Promise<any> {
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

    async finalizeMerge({
      claimTokenHash,
      existingUserId,
      existingUserEmailHash
    }: {
      claimTokenHash: string;
      existingUserId: string;
      existingUserEmailHash: string;
      // deno-lint-ignore no-explicit-any
    }): Promise<any> {
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
