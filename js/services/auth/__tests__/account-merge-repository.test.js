"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createAccountMergeRepositoryFromSupabaseClient } = require("../account-merge-repository");

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

test("createAccountMergeRepositoryFromSupabaseClient requires a supabaseClient with rpc()", () => {
  assert.throws(() => createAccountMergeRepositoryFromSupabaseClient({ supabaseClient: {} }));
  assert.throws(() => createAccountMergeRepositoryFromSupabaseClient({}));
});

test("createClaim: calls create_account_merge_claim with the exact RPC parameter names", async () => {
  const supabaseClient = createFakeSupabaseClient({
    rpcResults: { create_account_merge_claim: { data: { id: "claim-1", expires_at: "2026-01-01T00:00:00Z" } } }
  });
  const repository = createAccountMergeRepositoryFromSupabaseClient({ supabaseClient });

  const result = await repository.createClaim({
    anonymousUserId: "anon-1",
    claimTokenHash: "hash-a",
    targetEmailHash: "hash-b",
    ttlSeconds: 900
  });

  assert.equal(supabaseClient.calls.length, 1);
  assert.equal(supabaseClient.calls[0].fnName, "create_account_merge_claim");
  assert.deepEqual(supabaseClient.calls[0].params, {
    p_anonymous_user_id: "anon-1",
    p_claim_token_hash: "hash-a",
    p_target_email_hash: "hash-b",
    p_ttl_seconds: 900
  });
  assert.equal(result.id, "claim-1");
});

test("createClaim: throws the raw Supabase error unchanged on failure", async () => {
  const supabaseClient = createFakeSupabaseClient({
    rpcResults: { create_account_merge_claim: { error: { message: "boom" } } }
  });
  const repository = createAccountMergeRepositoryFromSupabaseClient({ supabaseClient });

  await assert.rejects(
    () => repository.createClaim({ anonymousUserId: "a", claimTokenHash: "b", targetEmailHash: "c", ttlSeconds: 900 }),
    { message: "boom" }
  );
});

test("finalizeMerge: calls finalize_account_merge with EXACTLY 3 params (never an idempotencyKey)", async () => {
  const supabaseClient = createFakeSupabaseClient({
    rpcResults: { finalize_account_merge: { data: { id: "req-1", result_json: {} } } }
  });
  const repository = createAccountMergeRepositoryFromSupabaseClient({ supabaseClient });

  await repository.finalizeMerge({
    claimTokenHash: "hash-a",
    existingUserId: "existing-1",
    existingUserEmailHash: "hash-c"
  });

  assert.equal(supabaseClient.calls[0].fnName, "finalize_account_merge");
  assert.deepEqual(supabaseClient.calls[0].params, {
    p_claim_token_hash: "hash-a",
    p_existing_user_id: "existing-1",
    p_existing_user_email_hash: "hash-c"
  });
  assert.equal(Object.keys(supabaseClient.calls[0].params).length, 3);
});

test("finalizeMerge: throws the raw Supabase error unchanged on failure", async () => {
  const supabaseClient = createFakeSupabaseClient({
    rpcResults: { finalize_account_merge: { error: { message: "claim not found" } } }
  });
  const repository = createAccountMergeRepositoryFromSupabaseClient({ supabaseClient });

  await assert.rejects(
    () => repository.finalizeMerge({ claimTokenHash: "x", existingUserId: "y", existingUserEmailHash: "z" }),
    { message: "claim not found" }
  );
});

// P-AUTH-05B-1 hotfix requirement 2: a STATEFUL fake `rpc()` that models the
// real `finalize_account_merge` RPC's canonical-key idempotency — the same
// (claimTokenHash, existingUserId, existingUserEmailHash) triple only ever
// "applies" the merge/points-transfer side effect ONCE; every later call
// with the identical triple returns the SAME cached row. This proves the
// repository itself (a thin pass-through) introduces no double-call/
// double-mutation behavior of its own on top of whatever the RPC returns —
// it does NOT, and cannot, prove Postgres's real `FOR UPDATE` lock/MVCC
// behavior under true concurrency (that remains a 05C Staging Gate concern,
// see docs/0-review/review-auth/review-auth-05B-1-hotfix.md).
function createStatefulFinalizeSupabaseClient({ mergeId = "req-1", resultOnFirstApply = { cartMerged: 2, pointsTransferred: 10 } } = {}) {
  let appliedCount = 0;
  let cachedRow = null;
  return {
    get appliedCount() {
      return appliedCount;
    },
    async rpc(fnName, params) {
      if (fnName !== "finalize_account_merge") {
        throw new Error(`unexpected rpc: ${fnName}`);
      }
      if (cachedRow) {
        return { data: cachedRow, error: null };
      }
      appliedCount += 1;
      cachedRow = { id: mergeId, result_json: resultOnFirstApply, _calledWith: params };
      return { data: cachedRow, error: null };
    }
  };
}

test("finalizeMerge: resend after the first response was lost (sequential retries) applies the underlying RPC's merge/points transfer exactly ONCE", async () => {
  const supabaseClient = createStatefulFinalizeSupabaseClient();
  const repository = createAccountMergeRepositoryFromSupabaseClient({ supabaseClient });
  const params = { claimTokenHash: "hash-a", existingUserId: "existing-1", existingUserEmailHash: "hash-c" };

  const first = await repository.finalizeMerge(params);
  const second = await repository.finalizeMerge(params);
  const third = await repository.finalizeMerge(params);

  assert.equal(first.id, "req-1");
  assert.deepEqual(first.result_json, { cartMerged: 2, pointsTransferred: 10 });
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.equal(supabaseClient.appliedCount, 1);
});

test("finalizeMerge: resend after concurrent duplicate clicks applies the underlying RPC's merge/points transfer exactly ONCE", async () => {
  const supabaseClient = createStatefulFinalizeSupabaseClient();
  const repository = createAccountMergeRepositoryFromSupabaseClient({ supabaseClient });
  const params = { claimTokenHash: "hash-a", existingUserId: "existing-1", existingUserEmailHash: "hash-c" };

  const [first, second, third] = await Promise.all([
    repository.finalizeMerge(params),
    repository.finalizeMerge(params),
    repository.finalizeMerge(params)
  ]);

  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
  // NOTE: this fake is single-threaded (Node's event loop, no real
  // parallel I/O), so this proves the REPOSITORY layer never issues an
  // extra/duplicate call or re-derives its own result on top of the RPC —
  // it does NOT simulate a true multi-connection Postgres race.
  assert.equal(supabaseClient.appliedCount, 1);
});
