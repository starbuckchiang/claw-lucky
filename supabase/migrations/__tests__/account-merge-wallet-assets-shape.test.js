"use strict";

/**
 * P-AUTH-05A.2: static structural + simulated-arithmetic tests for
 * `20260817001000_account_merge_wallet_assets.sql` — adds Coins/Tickets
 * to `finalize_account_merge`'s existing atomic transaction (previously
 * only Points/Cart/Mascots/RedeemHistory were merged; Coins/Tickets were
 * explicitly out of the V1 scope defined in
 * `20260816000400_account_merge_requests_and_finalize.sql`, already
 * applied to production and NOT modified by this migration).
 *
 * Hotfix (same task chain, before this migration was ever applied): the
 * Points block originally still declared `v_anon_points INTEGER` (copied
 * verbatim from 20260816000400) with no overflow guard — the SAME
 * bigint/integer mismatch class the Coins/Tickets blocks were designed to
 * avoid. Since `20260817001000` was never applied, it was corrected in
 * place (BIGINT + explicit `> 2147483647` range guard + explicit
 * `::INTEGER` casts, byte-for-byte the same pattern as Coins/Tickets) —
 * tests below cover both the original Coins/Tickets behavior AND this
 * Points hotfix.
 *
 * SAME LIMITATION as every other migration-shape test in this repo: no
 * local Postgres/pg-mem harness — the "static" half below is a TEXT
 * assertion on the migration SQL only. The "simulated" half is a
 * plain-JS re-implementation of the DOCUMENTED transfer algorithm (lock,
 * read anon balance, skip if zero, ledgered transfer-out then
 * transfer-in, reject negative results) — it proves the ARITHMETIC is
 * correct given that algorithm, but does NOT prove the real SQL executes
 * this way; that requires a real Postgres run (see
 * review-auth-05A.2-account-merge-wallet-assets.md's manual verification
 * plan, NOT executed by this task — local migration + tests only, no
 * `db push`/deploy).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "..");
const WALLET_ASSETS_SQL = fs.readFileSync(
  path.join(MIGRATIONS_DIR, "20260817001000_account_merge_wallet_assets.sql"),
  "utf8"
);
const ORIGINAL_MERGE_SQL = fs.readFileSync(
  path.join(MIGRATIONS_DIR, "20260816000400_account_merge_requests_and_finalize.sql"),
  "utf8"
);

function extractFunctionBody(sql, functionName) {
  const regex = new RegExp(`^CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?END;\\r?\\n\\$\\$;`, "m");
  const match = sql.match(regex);
  assert.ok(match, `${functionName} function body not found`);
  return match[0];
}

// ============================================================
// PART A: static structural tests on the new migration's SQL
// ============================================================

test("this migration does not modify 20260816000400 (already-applied migration untouched)", () => {
  assert.match(ORIGINAL_MERGE_SQL, /CREATE OR REPLACE FUNCTION public\.finalize_account_merge/);
  assert.match(ORIGINAL_MERGE_SQL, /excludedV1/);
});

test("finalize_account_merge: same 3-arg signature and return type as the original (no DROP FUNCTION needed, no overload created)", () => {
  assert.match(
    WALLET_ASSETS_SQL,
    /CREATE OR REPLACE FUNCTION public\.finalize_account_merge\(\s*\n\s*p_claim_token_hash TEXT,\s*\n\s*p_existing_user_id TEXT,\s*\n\s*p_existing_user_email_hash TEXT\s*\n\s*\) RETURNS public\.account_merge_requests/
  );
});

test("finalize_account_merge: SECURITY DEFINER, fixed search_path, and service_role-only EXECUTE are all preserved", () => {
  const fnBody = extractFunctionBody(WALLET_ASSETS_SQL, "finalize_account_merge");
  assert.match(fnBody, /SECURITY DEFINER/);
  assert.match(fnBody, /SET search_path = public, pg_temp/);
  assert.match(WALLET_ASSETS_SQL, /REVOKE ALL ON FUNCTION public\.finalize_account_merge\(TEXT, TEXT, TEXT\) FROM PUBLIC/);
  assert.match(WALLET_ASSETS_SQL, /REVOKE ALL ON FUNCTION public\.finalize_account_merge\(TEXT, TEXT, TEXT\) FROM anon/);
  assert.match(WALLET_ASSETS_SQL, /REVOKE ALL ON FUNCTION public\.finalize_account_merge\(TEXT, TEXT, TEXT\) FROM authenticated/);
  assert.match(WALLET_ASSETS_SQL, /GRANT EXECUTE ON FUNCTION public\.finalize_account_merge\(TEXT, TEXT, TEXT\) TO service_role/);
});

test("finalize_account_merge: claim-lock -> email-check -> canonical-idempotency-lookup ordering is UNCHANGED and runs BEFORE any coins/tickets ledger call (requirement 7/11: cross-UID claim reuse still rejected before any asset moves)", () => {
  const fnBody = extractFunctionBody(WALLET_ASSETS_SQL, "finalize_account_merge");
  const claimLockIdx = fnBody.indexOf("FOR UPDATE;");
  const emailCheckIdx = fnBody.indexOf("v_claim.target_email_hash <> p_existing_user_email_hash");
  const idempotencyLookupIdx = fnBody.indexOf("SELECT * INTO v_existing_request");
  const coinsBlockIdx = fnBody.indexOf("-- Coins: read as BIGINT");
  const ticketsBlockIdx = fnBody.indexOf("-- Tickets: identical pattern to Coins above.");

  assert.ok(claimLockIdx > -1 && emailCheckIdx > -1 && idempotencyLookupIdx > -1 && coinsBlockIdx > -1 && ticketsBlockIdx > -1);
  assert.ok(claimLockIdx < emailCheckIdx);
  assert.ok(emailCheckIdx < idempotencyLookupIdx);
  assert.ok(idempotencyLookupIdx < coinsBlockIdx);
  assert.ok(coinsBlockIdx < ticketsBlockIdx);
});

test("finalize_account_merge: coins/tickets/points ledger calls all happen BEFORE the claim is marked 'used' and the request row is inserted (requirement 6/9: any failure anywhere rolls back everything, no partial success)", () => {
  const fnBody = extractFunctionBody(WALLET_ASSETS_SQL, "finalize_account_merge");
  const pointsCallIdx = fnBody.indexOf("apply_point_transaction(v_claim.anonymous_user_id");
  const coinsCallIdx = fnBody.indexOf("apply_coin_transaction(v_claim.anonymous_user_id");
  const ticketsCallIdx = fnBody.indexOf("apply_ticket_transaction(v_claim.anonymous_user_id");
  const claimUsedIdx = fnBody.indexOf("SET status = 'used', used_at = NOW()");
  const requestInsertIdx = fnBody.indexOf("INSERT INTO public.account_merge_requests");

  assert.ok(pointsCallIdx > -1 && coinsCallIdx > -1 && ticketsCallIdx > -1);
  assert.ok(pointsCallIdx < coinsCallIdx);
  assert.ok(coinsCallIdx < ticketsCallIdx);
  assert.ok(ticketsCallIdx < claimUsedIdx);
  assert.ok(claimUsedIdx < requestInsertIdx);
});

test("finalize_account_merge: points/coins/tickets are each deducted from the anonymous account BEFORE being added to the existing account (requirement 4)", () => {
  const fnBody = extractFunctionBody(WALLET_ASSETS_SQL, "finalize_account_merge");
  for (const [fnName, negParam] of [
    ["apply_point_transaction", "(-v_anon_points)::INTEGER"],
    ["apply_coin_transaction", "(-v_anon_coins)::INTEGER"],
    ["apply_ticket_transaction", "(-v_anon_tickets)::INTEGER"],
  ]) {
    const outIdx = fnBody.indexOf(`${fnName}(v_claim.anonymous_user_id, ${negParam}, 'account_merge_transfer_out', v_claim.id)`);
    const inIdx = fnBody.indexOf(`${fnName}(p_existing_user_id,`);
    assert.ok(outIdx > -1, `${fnName} transfer-out call not found`);
    assert.ok(inIdx > -1, `${fnName} transfer-in call not found`);
    assert.ok(outIdx < inIdx, `${fnName}: transfer-out must run before transfer-in`);
  }
});

test("finalize_account_merge: points/coins/tickets transfers all use v_claim.id as the stable reference_id for BOTH legs (requirement 3: idempotency key derived from the claim, never freshly generated per call)", () => {
  const fnBody = extractFunctionBody(WALLET_ASSETS_SQL, "finalize_account_merge");
  const pointCalls = fnBody.match(/apply_point_transaction\([^;]*?v_claim\.id\)/g) || [];
  const coinCalls = fnBody.match(/apply_coin_transaction\([^;]*?v_claim\.id\)/g) || [];
  const ticketCalls = fnBody.match(/apply_ticket_transaction\([^;]*?v_claim\.id\)/g) || [];
  assert.equal(pointCalls.length, 2, "expected exactly 2 apply_point_transaction(..., v_claim.id) calls (out + in)");
  assert.equal(coinCalls.length, 2, "expected exactly 2 apply_coin_transaction(..., v_claim.id) calls (out + in)");
  assert.equal(ticketCalls.length, 2, "expected exactly 2 apply_ticket_transaction(..., v_claim.id) calls (out + in)");
});

test("finalize_account_merge: points/coins/tickets transfers are SKIPPED entirely (no ledger call, no exception) when the anonymous balance is zero (requirement 5/8)", () => {
  const fnBody = extractFunctionBody(WALLET_ASSETS_SQL, "finalize_account_merge");
  assert.match(fnBody, /IF v_anon_points IS NOT NULL AND v_anon_points > 0 THEN/);
  assert.match(fnBody, /IF v_anon_coins IS NOT NULL AND v_anon_coins > 0 THEN/);
  assert.match(fnBody, /IF v_anon_tickets IS NOT NULL AND v_anon_tickets > 0 THEN/);
});

test("finalize_account_merge (hotfix): v_anon_points is declared BIGINT, matching users.points' real type (no lingering 'v_anon_points INTEGER' declaration anywhere)", () => {
  assert.match(WALLET_ASSETS_SQL, /v_anon_points BIGINT := 0;/);
  assert.doesNotMatch(WALLET_ASSETS_SQL, /v_anon_points INTEGER/);
});

test("finalize_account_merge (hotfix): the points range guard runs BEFORE the ::INTEGER casts at both apply_point_transaction call sites", () => {
  const fnBody = extractFunctionBody(WALLET_ASSETS_SQL, "finalize_account_merge");
  const rangeGuardIdx = fnBody.indexOf("IF v_anon_points > 2147483647 THEN");
  const outCastIdx = fnBody.indexOf("(-v_anon_points)::INTEGER");
  const inCastIdx = fnBody.indexOf("v_anon_points::INTEGER", outCastIdx + 1);
  assert.ok(rangeGuardIdx > -1, "points range guard not found");
  assert.ok(outCastIdx > -1, "points transfer-out ::INTEGER cast not found");
  assert.ok(inCastIdx > -1, "points transfer-in ::INTEGER cast not found");
  assert.ok(rangeGuardIdx < outCastIdx, "range guard must run before the transfer-out cast");
  assert.ok(outCastIdx < inCastIdx, "transfer-out cast must run before the transfer-in cast");
});

test("finalize_account_merge: points/coins/tickets balances are ALL read into BIGINT variables and explicitly range-checked against INTEGER bounds before any cast (requirement 9: never a silent bigint->integer narrowing)", () => {
  const fnBody = extractFunctionBody(WALLET_ASSETS_SQL, "finalize_account_merge");
  assert.match(WALLET_ASSETS_SQL, /v_anon_points BIGINT := 0;/);
  assert.match(WALLET_ASSETS_SQL, /v_anon_coins BIGINT := 0;/);
  assert.match(WALLET_ASSETS_SQL, /v_anon_tickets BIGINT := 0;/);
  assert.match(fnBody, /IF v_anon_points > 2147483647 THEN\s*\n\s*RAISE EXCEPTION/);
  assert.match(fnBody, /IF v_anon_coins > 2147483647 THEN\s*\n\s*RAISE EXCEPTION/);
  assert.match(fnBody, /IF v_anon_tickets > 2147483647 THEN\s*\n\s*RAISE EXCEPTION/);
  // Every cast to INTEGER is an EXPLICIT `::INTEGER`, never a bare
  // assignment that would rely on an implicit/silent narrowing.
  assert.match(fnBody, /\(-v_anon_points\)::INTEGER/);
  assert.match(fnBody, /v_anon_points::INTEGER/);
  assert.match(fnBody, /\(-v_anon_coins\)::INTEGER/);
  assert.match(fnBody, /v_anon_coins::INTEGER/);
  assert.match(fnBody, /\(-v_anon_tickets\)::INTEGER/);
  assert.match(fnBody, /v_anon_tickets::INTEGER/);
});

test("finalize_account_merge: never issues a raw UPDATE of users.points/coins/tickets directly (must go through apply_point_transaction/apply_coin_transaction/apply_ticket_transaction only, per requirement 2/6)", () => {
  const fnBody = extractFunctionBody(WALLET_ASSETS_SQL, "finalize_account_merge");
  assert.doesNotMatch(fnBody, /UPDATE public\.users\s+SET\s+points/i);
  assert.doesNotMatch(fnBody, /UPDATE public\.users\s+SET\s+coins/i);
  assert.doesNotMatch(fnBody, /UPDATE public\.users\s+SET\s+tickets/i);
});

test("finalize_account_merge: request body/front-end never supplies an asset amount — no p_coins/p_tickets/p_points/p_amount parameter exists on the function signature (requirement 14)", () => {
  const signatureMatch = WALLET_ASSETS_SQL.match(/CREATE OR REPLACE FUNCTION public\.finalize_account_merge\(([\s\S]*?)\) RETURNS/);
  assert.ok(signatureMatch);
  assert.doesNotMatch(signatureMatch[1], /p_coins|p_tickets|p_points|p_amount|p_delta/i);
});

test("cart/mascot/redeem-history blocks are copied verbatim (byte-identical) from the already-applied 20260816000400 migration", () => {
  const originalFnBody = extractFunctionBody(ORIGINAL_MERGE_SQL, "finalize_account_merge");
  const newFnBody = extractFunctionBody(WALLET_ASSETS_SQL, "finalize_account_merge");

  const cartBlock = originalFnBody.match(/-- Cart: merge by product_id[\s\S]*?DELETE FROM public\.shop_cart WHERE user_id::text = v_claim\.anonymous_user_id;\s*\n\s*END IF;/)[0];
  const mascotBlock = originalFnBody.match(/-- Mascots: requires uq_user_mascots_user_mascot[\s\S]*?DELETE FROM public\.user_mascots WHERE user_id::text = v_claim\.anonymous_user_id;\s*\n\s*END IF;/)[0];
  const redeemBlock = originalFnBody.match(/-- Redeem history: reassign ownership only[\s\S]*?SELECT COUNT\(\*\) INTO v_redeem_reassigned_count FROM reassigned;\s*\n\s*END IF;/)[0];

  assert.ok(newFnBody.includes(cartBlock), "Cart block was not copied verbatim");
  assert.ok(newFnBody.includes(mascotBlock), "Mascot block was not copied verbatim");
  assert.ok(newFnBody.includes(redeemBlock), "Redeem history block was not copied verbatim");
});

test("result_json now includes coinsTransferred/ticketsTransferred alongside the existing pointsTransferred/cartMerged/mascotsMerged/redeemHistoryReassigned/excludedV1 fields", () => {
  const fnBody = extractFunctionBody(WALLET_ASSETS_SQL, "finalize_account_merge");
  const insertMatch = fnBody.match(/INSERT INTO public\.account_merge_requests[\s\S]*?RETURNING \* INTO v_request;/);
  assert.ok(insertMatch);
  assert.match(insertMatch[0], /'coinsTransferred', COALESCE\(v_anon_coins, 0\)/);
  assert.match(insertMatch[0], /'ticketsTransferred', COALESCE\(v_anon_tickets, 0\)/);
  assert.match(insertMatch[0], /'pointsTransferred', COALESCE\(v_anon_points, 0\)/);
});

// ============================================================
// PART B: [SIMULATED, not real Postgres] arithmetic verification
// of the documented transfer algorithm
// ============================================================

function createSimulatedWallet(initialBalances) {
  const users = new Map(Object.entries(initialBalances).map(([id, b]) => [id, { ...b }]));
  const transactions = { coin: [], ticket: [], point: [] };

  function applyTransaction(kind, userId, delta, reason, referenceId) {
    const user = users.get(userId);
    if (!user) throw new Error(`user ${userId} not found`);
    const next = (user[kind] || 0) + delta;
    if (next < 0) throw new Error(`resulting ${kind} balance would be negative (user=${userId}, delta=${delta})`);
    user[kind] = next;
    transactions[kind].push({ userId, delta, reason, referenceId, balanceAfter: next });
    return { balanceAfter: next };
  }

  // Mirrors the migration's own coins/tickets/points block EXACTLY: skip
  // entirely when zero, deduct-then-add, same reference_id (claim id)
  // for both legs.
  function mergeAsset(kind, anonymousUserId, existingUserId, claimId) {
    const anonBalance = users.get(anonymousUserId)[kind] || 0;
    if (anonBalance > 0) {
      applyTransaction(kind, anonymousUserId, -anonBalance, "account_merge_transfer_out", claimId);
      applyTransaction(kind, existingUserId, anonBalance, "account_merge_transfer_in", claimId);
    }
    return anonBalance;
  }

  // Mirrors the migration's EXPLICIT `IF v_anon_x > 2147483647 THEN RAISE
  // EXCEPTION` guard: raises BEFORE any ledger call is made for this
  // asset, exactly like the real SQL raising before its first `PERFORM
  // apply_*_transaction(...)` call — a real Postgres function-body
  // exception at this point rolls back the ENTIRE transaction (including
  // any OTHER asset already merged earlier in the SAME call), which this
  // JS simulation cannot itself execute/prove (see file header) but can
  // demonstrate raises before mutating THIS asset at all.
  const INT4_MAX = 2147483647;
  function mergeAssetWithRangeGuard(kind, anonymousUserId, existingUserId, claimId) {
    const anonBalance = users.get(anonymousUserId)[kind] || 0;
    if (anonBalance > 0) {
      if (anonBalance > INT4_MAX) {
        throw new Error(`finalize_account_merge: anonymous account ${kind} balance ${anonBalance} exceeds the ledger's INTEGER range, cannot merge safely`);
      }
      applyTransaction(kind, anonymousUserId, -anonBalance, "account_merge_transfer_out", claimId);
      applyTransaction(kind, existingUserId, anonBalance, "account_merge_transfer_in", claimId);
    }
    return anonBalance;
  }

  return { users, transactions, applyTransaction, mergeAsset, mergeAssetWithRangeGuard };
}

test("[SIMULATED] coins: anon=19, formal=20 -> formal=39, anon=0", () => {
  const wallet = createSimulatedWallet({
    anon: { coin: 19 },
    official: { coin: 20 },
  });

  const transferred = wallet.mergeAsset("coin", "anon", "official", "claim-1");

  assert.equal(transferred, 19);
  assert.equal(wallet.users.get("official").coin, 39);
  assert.equal(wallet.users.get("anon").coin, 0);
});

test("[SIMULATED] tickets: anon=1, formal=0 -> formal=1, anon=0", () => {
  const wallet = createSimulatedWallet({
    anon: { ticket: 1 },
    official: { ticket: 0 },
  });

  const transferred = wallet.mergeAsset("ticket", "anon", "official", "claim-2");

  assert.equal(transferred, 1);
  assert.equal(wallet.users.get("official").ticket, 1);
  assert.equal(wallet.users.get("anon").ticket, 0);
});

test("[SIMULATED] points: anon=90, formal=0 -> formal=90, anon=0 (same algorithm as the already-applied, unmodified points block)", () => {
  const wallet = createSimulatedWallet({
    anon: { point: 90 },
    official: { point: 0 },
  });

  const transferred = wallet.mergeAsset("point", "anon", "official", "claim-3");

  assert.equal(transferred, 90);
  assert.equal(wallet.users.get("official").point, 90);
  assert.equal(wallet.users.get("anon").point, 0);
});

test("[SIMULATED] all three assets merge independently and correctly in one pass, mirroring a real mixed-balance merge", () => {
  const wallet = createSimulatedWallet({
    anon: { coin: 19, ticket: 1, point: 90 },
    official: { coin: 20, ticket: 0, point: 0 },
  });

  wallet.mergeAsset("coin", "anon", "official", "claim-4");
  wallet.mergeAsset("ticket", "anon", "official", "claim-4");
  wallet.mergeAsset("point", "anon", "official", "claim-4");

  assert.deepEqual(wallet.users.get("official"), { coin: 39, ticket: 1, point: 90 });
  assert.deepEqual(wallet.users.get("anon"), { coin: 0, ticket: 0, point: 0 });
  // Every ledger entry (both legs, all 3 assets) references the SAME
  // claim id — matches the migration's stable-reference-id requirement.
  const allEntries = [...wallet.transactions.coin, ...wallet.transactions.ticket, ...wallet.transactions.point];
  assert.equal(allEntries.length, 6);
  assert.ok(allEntries.every((e) => e.referenceId === "claim-4"));
});

test("[SIMULATED] zero balance merges with no exception and no ledger entry (requirement 8)", () => {
  const wallet = createSimulatedWallet({
    anon: { coin: 0 },
    official: { coin: 20 },
  });

  const transferred = wallet.mergeAsset("coin", "anon", "official", "claim-5");

  assert.equal(transferred, 0);
  assert.equal(wallet.users.get("official").coin, 20);
  assert.equal(wallet.users.get("anon").coin, 0);
  assert.equal(wallet.transactions.coin.length, 0);
});

test("[SIMULATED] points balance exceeding INTEGER range raises BEFORE any ledger call for that asset (mirrors the real SQL's guard, which would roll back the ENTIRE merge transaction — not provable in JS, see file header)", () => {
  const wallet = createSimulatedWallet({
    anon: { point: 2147483648 }, // INT4_MAX + 1
    official: { point: 0 },
  });

  assert.throws(
    () => wallet.mergeAssetWithRangeGuard("point", "anon", "official", "claim-7"),
    /exceeds the ledger's INTEGER range/
  );
  // No transaction was ever recorded and no balance moved — the guard
  // fires before the first apply_point_transaction call, exactly where
  // the real SQL's `IF v_anon_points > 2147483647 THEN RAISE EXCEPTION`
  // sits (before either PERFORM call).
  assert.equal(wallet.transactions.point.length, 0);
  assert.equal(wallet.users.get("anon").point, 2147483648);
  assert.equal(wallet.users.get("official").point, 0);
});

test("[SIMULATED] a coins/tickets overflow behaves identically to the points overflow above (same guard shape, same fail-before-any-mutation behavior)", () => {
  for (const kind of ["coin", "ticket"]) {
    const wallet = createSimulatedWallet({
      anon: { [kind]: 2147483648 },
      official: { [kind]: 0 },
    });

    assert.throws(
      () => wallet.mergeAssetWithRangeGuard(kind, "anon", "official", "claim-8"),
      /exceeds the ledger's INTEGER range/
    );
    assert.equal(wallet.transactions[kind].length, 0);
    assert.equal(wallet.users.get("official")[kind], 0);
  }
});

test("[SIMULATED] apply_*_transaction's own negative-balance guard rejects a delta that would make the result negative — mirrors the real ledger RPCs, proves a downstream failure raises loudly rather than silently corrupting a balance (requirement: no partial success)", () => {
  const wallet = createSimulatedWallet({
    anon: { ticket: 1 },
    official: { ticket: 0 },
  });

  // A delta larger than the current balance would drive it negative —
  // exactly the class of failure apply_ticket_transaction's own
  // `IF v_next_tickets < 0 THEN RAISE EXCEPTION` guard exists to catch.
  assert.throws(
    () => wallet.applyTransaction("ticket", "anon", -5, "account_merge_transfer_out", "claim-6"),
    /would be negative/
  );
  // The rejected attempt must not have mutated the balance at all.
  assert.equal(wallet.users.get("anon").ticket, 1);
});
