"use strict";

/**
 * Wallet Ops Repository (P-AUTH-05B-2A, revised by the P-AUTH-05B-2A
 * Hotfix)
 *
 * Thin wrapper around the SECURITY DEFINER RPCs added by the P-AUTH-05B-2A
 * migrations (`ensure_user_row`, `claim_gacha_draw`,
 * `redeem_gift_transaction`). Server-side / Edge-Function-only (no
 * `window.X =` export, matching `account-merge-repository.js`'s
 * convention) — all RPCs are granted EXECUTE to `service_role` ONLY, so
 * `supabaseClient` here MUST be a service-role client
 * (`createServiceClient()` in supabase/functions/_shared/supabase-clients.ts),
 * never the anon-key client used to verify the caller's own JWT.
 *
 * HOTFIX (requirements 2/3): `adjustBalance()`/`upsertMascot()` have been
 * REMOVED from this repository entirely — there is no longer a generic
 * balance-adjustment RPC (`apply_generic_balance_adjustment` was deleted,
 * see the 20260817000100 migration) nor a standalone mascot-upsert route
 * (`upsert_user_mascot_obtain` is now called ONLY from inside
 * `claim_gacha_draw` at the SQL level).
 *
 * This module does no validation/business logic itself (that lives in
 * wallet-ops-handler.js) — it only translates a plain JS call into the
 * exact RPC parameter names the SQL functions expect, and normalizes a
 * Supabase `{ data, error }` result into either a return value or a thrown
 * error (matching the style of `account-merge-repository.js`).
 */

function createWalletOpsRepositoryFromSupabaseClient({ supabaseClient }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
    throw new Error("createWalletOpsRepositoryFromSupabaseClient requires a supabaseClient with rpc().");
  }

  return {
    // Secure replacement for Api.createUserIfNotExists(): true
    // insert-if-missing, NEVER resets an existing row's balance/nickname.
    async ensureUser({ userId, nickname }) {
      const { data, error } = await supabaseClient.rpc("ensure_user_row", {
        p_user_id: userId,
        p_nickname: nickname || ""
      });

      if (error) throw error;
      return data;
    },

    // Atomic Gacha Draw (hotfix requirement 1): the server decides which
    // mascot/rarity was drawn ENTIRELY on its own (weighted random against
    // public.mascot_rarities/public.mascots) — there is NO mascotId
    // parameter here at all. `idempotencyKey` MUST be fresh per logical
    // draw ATTEMPT (generated once by the caller when the attempt begins,
    // e.g. crypto.randomUUID()), reused verbatim on a retry of that SAME
    // attempt (requirement 5) — this repository never generates one
    // itself.
    async claimGachaDraw({ userId, idempotencyKey }) {
      const { data, error } = await supabaseClient.rpc("claim_gacha_draw", {
        p_user_id: userId,
        p_idempotency_key: idempotencyKey
      });

      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    // Atomic Gift Redemption: locks users+gifts, verifies balance/stock,
    // deducts, decrements stock, writes redeem_history — all in one RPC
    // transaction. Cost/name are ALWAYS resolved server-side from
    // `gifts` — never accepted from the caller.
    async redeemGift({ userId, giftId, idempotencyKey }) {
      const { data, error } = await supabaseClient.rpc("redeem_gift_transaction", {
        p_user_id: userId,
        p_gift_id: giftId,
        p_idempotency_key: idempotencyKey
      });

      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    }
  };
}

module.exports = {
  createWalletOpsRepositoryFromSupabaseClient
};
