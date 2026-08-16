// ESM twin of `wallet-ops-repository.js`. Logic unchanged — see that
// file's header for the full rationale (including the P-AUTH-05B-2A
// Hotfix that removed adjustBalance/upsertMascot and dropped mascotId
// from claimGachaDraw). Whenever business logic changes here, mirror the
// change in the `.js` twin (same function names, same RPC parameter
// names).

// deno-lint-ignore no-explicit-any
export function createWalletOpsRepositoryFromSupabaseClient({ supabaseClient }: { supabaseClient: any }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
    throw new Error("createWalletOpsRepositoryFromSupabaseClient requires a supabaseClient with rpc().");
  }

  return {
    async ensureUser({ userId, nickname }: { userId: string; nickname?: string }) {
      const { data, error } = await supabaseClient.rpc("ensure_user_row", {
        p_user_id: userId,
        p_nickname: nickname || "",
      });

      if (error) throw error;
      return data;
    },

    async claimGachaDraw({ userId, idempotencyKey }: { userId: string; idempotencyKey: string }) {
      const { data, error } = await supabaseClient.rpc("claim_gacha_draw", {
        p_user_id: userId,
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async redeemGift({ userId, giftId, idempotencyKey }: { userId: string; giftId: string; idempotencyKey: string }) {
      const { data, error } = await supabaseClient.rpc("redeem_gift_transaction", {
        p_user_id: userId,
        p_gift_id: giftId,
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
  };
}

