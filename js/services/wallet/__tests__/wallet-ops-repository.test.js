"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createWalletOpsRepositoryFromSupabaseClient } = require("../wallet-ops-repository");

function createFakeSupabaseClient({ rpcResults = {} } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(fnName, params) {
      calls.push({ fnName, params });
      const configured = rpcResults[fnName];
      if (configured?.error) {
        return { data: null, error: configured.error };
      }
      return { data: configured?.data ?? null, error: null };
    }
  };
}

test("createWalletOpsRepositoryFromSupabaseClient requires a supabaseClient with rpc()", () => {
  assert.throws(() => createWalletOpsRepositoryFromSupabaseClient({ supabaseClient: {} }));
  assert.throws(() => createWalletOpsRepositoryFromSupabaseClient({}));
});

test("ensureUser: calls ensure_user_row with the exact RPC parameter names", async () => {
  const supabaseClient = createFakeSupabaseClient({
    rpcResults: { ensure_user_row: { data: { user_id: "u-1", points: 0, tickets: 0, coins: 20 } } }
  });
  const repository = createWalletOpsRepositoryFromSupabaseClient({ supabaseClient });

  const result = await repository.ensureUser({ userId: "u-1", nickname: "Alice" });

  assert.deepEqual(supabaseClient.calls[0].params, { p_user_id: "u-1", p_nickname: "Alice" });
  assert.equal(result.user_id, "u-1");
});

test("ensureUser: throws the raw Supabase error unchanged on failure", async () => {
  const supabaseClient = createFakeSupabaseClient({ rpcResults: { ensure_user_row: { error: { message: "boom" } } } });
  const repository = createWalletOpsRepositoryFromSupabaseClient({ supabaseClient });

  await assert.rejects(() => repository.ensureUser({ userId: "u-1" }), { message: "boom" });
});

test("claimGachaDraw: calls claim_gacha_draw with EXACTLY 2 params (no mascotId — the server decides the draw) and unwraps a single-row TABLE result", async () => {
  const supabaseClient = createFakeSupabaseClient({
    rpcResults: { claim_gacha_draw: { data: [{ mascot_id: "m-1", is_new: true, points_earned: 10, tickets_earned: 1, coins_delta: -1 }] } }
  });
  const repository = createWalletOpsRepositoryFromSupabaseClient({ supabaseClient });

  const result = await repository.claimGachaDraw({ userId: "u-1", idempotencyKey: "key-1" });

  assert.deepEqual(supabaseClient.calls[0].params, { p_user_id: "u-1", p_idempotency_key: "key-1" });
  assert.equal(Object.keys(supabaseClient.calls[0].params).length, 2);
  assert.equal(result.mascot_id, "m-1");
  assert.equal(result.is_new, true);
});

test("claimGachaDraw: throws the raw Supabase error unchanged on failure", async () => {
  const supabaseClient = createFakeSupabaseClient({ rpcResults: { claim_gacha_draw: { error: { message: "insufficient coins" } } } });
  const repository = createWalletOpsRepositoryFromSupabaseClient({ supabaseClient });

  await assert.rejects(
    () => repository.claimGachaDraw({ userId: "u-1", idempotencyKey: "key-1" }),
    { message: "insufficient coins" }
  );
});

test("redeemGift: calls redeem_gift_transaction with EXACTLY 3 params and unwraps a single-row TABLE result", async () => {
  const supabaseClient = createFakeSupabaseClient({
    rpcResults: { redeem_gift_transaction: { data: [{ redeem_history_id: "r-1", gift_id: "g-1", points_cost: 100 }] } }
  });
  const repository = createWalletOpsRepositoryFromSupabaseClient({ supabaseClient });

  const result = await repository.redeemGift({ userId: "u-1", giftId: "g-1", idempotencyKey: "key-2" });

  assert.deepEqual(supabaseClient.calls[0].params, { p_user_id: "u-1", p_gift_id: "g-1", p_idempotency_key: "key-2" });
  assert.equal(Object.keys(supabaseClient.calls[0].params).length, 3);
  assert.equal(result.redeem_history_id, "r-1");
});

test("redeemGift: throws the raw Supabase error unchanged on failure", async () => {
  const supabaseClient = createFakeSupabaseClient({ rpcResults: { redeem_gift_transaction: { error: { message: "out of stock" } } } });
  const repository = createWalletOpsRepositoryFromSupabaseClient({ supabaseClient });

  await assert.rejects(
    () => repository.redeemGift({ userId: "u-1", giftId: "g-1", idempotencyKey: "key-2" }),
    { message: "out of stock" }
  );
});
