"use strict";

/**
 * P-AUTH-05B-2A: Static structural tests for the Gacha/Gift Secure Write
 * RPC migrations.
 *
 * SAME LIMITATION as `rls-policy-shape.test.js` (see that file's header):
 * no local Postgres/pg-mem harness and no live Supabase project access
 * from this environment — these are STATIC assertions on the migration SQL
 * TEXT itself (hardening pattern present, dangerous patterns absent,
 * validation/locking ORDER via string position), NOT proof of real
 * Postgres runtime behavior. A real Supabase project run (see
 * review-auth-05B-2A.md's 05C Staging Gate plan) is still required before
 * this is considered verified.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "..");

function readMigration(filename) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
}

const WALLET_LEDGER_SQL = readMigration("20260817000000_ticket_coin_wallet_ledger.sql");
const ENSURE_USER_SQL = readMigration("20260817000100_ensure_user_row_and_generic_balance_adjustment.sql");
const GACHA_DRAW_SQL = readMigration("20260817000200_gacha_draw_secure_rpc.sql");
const GIFT_REDEEM_SQL = readMigration("20260817000300_gift_redeem_secure_rpc.sql");

// --- 20260817000000: ticket/coin ledger ---

for (const currency of ["ticket", "coin"]) {
  test(`${currency}_transactions: table has RLS enabled, owner-only SELECT, and denies all authenticated writes`, () => {
    assert.match(WALLET_LEDGER_SQL, new RegExp(`ALTER TABLE IF EXISTS public\\.${currency}_transactions ENABLE ROW LEVEL SECURITY`));
    assert.match(WALLET_LEDGER_SQL, new RegExp(`CREATE POLICY p_${currency}_transactions_select_owner[\\s\\S]{0,300}?public\\.request_user_key\\(\\)`));
    assert.match(WALLET_LEDGER_SQL, new RegExp(`CREATE POLICY p_${currency}_transactions_deny_insert_authenticated`));
  });

  test(`apply_${currency}_transaction: SECURITY DEFINER hardened (search_path pinned, revoked from PUBLIC/anon/authenticated, granted only to service_role)`, () => {
    const fnRegex = new RegExp(`CREATE OR REPLACE FUNCTION public\\.apply_${currency}_transaction\\([\\s\\S]{0,2000}?\\$\\$;`);
    const fnMatch = WALLET_LEDGER_SQL.match(fnRegex);
    assert.ok(fnMatch, `apply_${currency}_transaction function body not found`);
    const fnBody = fnMatch[0];

    assert.match(fnBody, /SECURITY DEFINER/);
    assert.match(fnBody, /SET search_path = public, pg_temp/);
    assert.match(fnBody, /FOR UPDATE/);
    assert.match(fnBody, /< 0 THEN\s*\n\s*RAISE EXCEPTION/);

    assert.match(WALLET_LEDGER_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.apply_${currency}_transaction\\(TEXT, INTEGER, TEXT, UUID\\) FROM PUBLIC`));
    assert.match(WALLET_LEDGER_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.apply_${currency}_transaction\\(TEXT, INTEGER, TEXT, UUID\\) FROM anon`));
    assert.match(WALLET_LEDGER_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.apply_${currency}_transaction\\(TEXT, INTEGER, TEXT, UUID\\) FROM authenticated`));
    assert.match(WALLET_LEDGER_SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.apply_${currency}_transaction\\(TEXT, INTEGER, TEXT, UUID\\) TO service_role`));
  });
}

test("wallet ledger migration: never uses a fully-permissive USING/WITH CHECK (true) policy", () => {
  assert.doesNotMatch(WALLET_LEDGER_SQL, /USING\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(WALLET_LEDGER_SQL, /WITH CHECK\s*\(\s*true\s*\)/i);
});

test("wallet ledger migration: backfill block only INSERTs, never UPDATEs users.tickets/users.coins directly", () => {
  const backfillIdx = WALLET_LEDGER_SQL.indexOf("One-time backfill");
  assert.ok(backfillIdx > -1, "backfill block not found");
  const backfillBlock = WALLET_LEDGER_SQL.slice(backfillIdx);
  assert.doesNotMatch(backfillBlock, /UPDATE public\.users\s+SET\s+(tickets|coins)/i);
  assert.match(backfillBlock, /INSERT INTO public\.ticket_transactions/);
  assert.match(backfillBlock, /INSERT INTO public\.coin_transactions/);
});

// --- 20260817000100: ensure_user_row + generic balance adjustment ---

test("ensure_user_row: is a true insert-if-missing (ON CONFLICT ... DO NOTHING), never overwrites an existing row's balance columns", () => {
  assert.match(ENSURE_USER_SQL, /ON CONFLICT\s*\(%2\$I\)\s*DO NOTHING/);
  assert.doesNotMatch(ENSURE_USER_SQL, /ON CONFLICT[\s\S]{0,100}?DO UPDATE[\s\S]{0,200}?(points|tickets|coins)\s*=/);
});

test("ensure_user_row: SECURITY DEFINER hardened, granted only to service_role", () => {
  assert.match(ENSURE_USER_SQL, /SECURITY DEFINER/);
  assert.match(ENSURE_USER_SQL, /SET search_path = public, pg_temp/);
  assert.match(ENSURE_USER_SQL, /REVOKE ALL ON FUNCTION public\.ensure_user_row\(TEXT, TEXT\) FROM PUBLIC/);
  assert.match(ENSURE_USER_SQL, /REVOKE ALL ON FUNCTION public\.ensure_user_row\(TEXT, TEXT\) FROM anon/);
  assert.match(ENSURE_USER_SQL, /REVOKE ALL ON FUNCTION public\.ensure_user_row\(TEXT, TEXT\) FROM authenticated/);
  assert.match(ENSURE_USER_SQL, /GRANT EXECUTE ON FUNCTION public\.ensure_user_row\(TEXT, TEXT\) TO service_role/);
});

// P-AUTH-05B-2A Hotfix (requirement 2): the generic
// apply_generic_balance_adjustment() RPC (and its wallet-ops/adjust-balance
// HTTP route) has been REMOVED ENTIRELY — there is no longer ANY RPC
// accepting arbitrary points/tickets/coins deltas from a caller.
test("ensure_user_row migration: apply_generic_balance_adjustment no longer exists (hotfix requirement 2 removed the generic adjustment RPC entirely)", () => {
  assert.doesNotMatch(ENSURE_USER_SQL, /CREATE OR REPLACE FUNCTION public\.apply_generic_balance_adjustment/);
  assert.match(ENSURE_USER_SQL, /DROP FUNCTION IF EXISTS public\.apply_generic_balance_adjustment/);
});

// --- 20260817000200: gacha draw ---

test("claim_gacha_draw: has EXACTLY 2 parameters (p_user_id, p_idempotency_key) — structurally NO mascotId/reward/rarity parameter can ever be supplied by a caller (hotfix requirement 1)", () => {
  assert.match(GACHA_DRAW_SQL, /CREATE OR REPLACE FUNCTION public\.claim_gacha_draw\(\s*\n\s*p_user_id TEXT,\s*\n\s*p_idempotency_key TEXT\s*\n\s*\)/);

  // Scope to the claim_gacha_draw FUNCTION BODY only (upsert_user_mascot_obtain,
  // an internal-only helper called ONLY from inside this function with the
  // SERVER-CHOSEN mascot id, legitimately has its own p_mascot_id/p_rarity
  // parameters — those must not be confused with a caller-facing parameter).
  const claimFnMatch = GACHA_DRAW_SQL.match(/CREATE OR REPLACE FUNCTION public\.claim_gacha_draw\([\s\S]*?END;\r?\n\$\$;/);
  assert.ok(claimFnMatch, "claim_gacha_draw function body not found");
  assert.doesNotMatch(claimFnMatch[0], /p_mascot_id/);

  assert.match(GACHA_DRAW_SQL, /REVOKE ALL ON FUNCTION public\.claim_gacha_draw\(TEXT, TEXT\) FROM PUBLIC/);
  assert.match(GACHA_DRAW_SQL, /GRANT EXECUTE ON FUNCTION public\.claim_gacha_draw\(TEXT, TEXT\) TO service_role/);
});

test("claim_gacha_draw: rolls a weighted-random rarity from public.mascot_rarities, then picks a random enabled mascot within it — the CLIENT has no input into either step", () => {
  assert.match(GACHA_DRAW_SQL, /SELECT SUM\(rate\) INTO v_total_rate FROM public\.mascot_rarities/);
  assert.match(GACHA_DRAW_SQL, /v_roll := random\(\) \* v_total_rate/);
  assert.match(GACHA_DRAW_SQL, /FOR v_rarity_row IN SELECT rarity_code, rate FROM public\.mascot_rarities ORDER BY sort_order LOOP/);
  assert.match(GACHA_DRAW_SQL, /WHERE rarity = v_rarity_code AND enabled = true\s*\n\s*ORDER BY random\(\)\s*\n\s*LIMIT 1/);
});

test("mascot_rarities: seeded with the same weights as js/data/gacha-data.js (N:62, R:25, SR:10, SSR:3), RLS enabled, read-only to authenticated", () => {
  assert.match(GACHA_DRAW_SQL, /\('N', 62, 1\)/);
  assert.match(GACHA_DRAW_SQL, /\('R', 25, 2\)/);
  assert.match(GACHA_DRAW_SQL, /\('SR', 10, 3\)/);
  assert.match(GACHA_DRAW_SQL, /\('SSR', 3, 4\)/);
  assert.match(GACHA_DRAW_SQL, /ALTER TABLE IF EXISTS public\.mascot_rarities ENABLE ROW LEVEL SECURITY/);
  assert.match(GACHA_DRAW_SQL, /CREATE POLICY p_mascot_rarities_deny_write_authenticated[\s\S]{0,200}?AS RESTRICTIVE/);
});

test("claim_gacha_draw: idempotency lookup happens FIRST, and rejects a cached row belonging to a DIFFERENT user (P-AUTH-05A.1 lesson)", () => {
  const idx = {
    idempotencyLookup: GACHA_DRAW_SQL.indexOf("SELECT * INTO v_cached FROM public.gacha_draw_requests"),
    ownershipCheck: GACHA_DRAW_SQL.indexOf("v_cached.user_id <> p_user_id"),
    userLock: GACHA_DRAW_SQL.indexOf("SELECT * INTO v_user FROM public.users WHERE user_id::text = p_user_id FOR UPDATE"),
    coinCheck: GACHA_DRAW_SQL.indexOf("insufficient coins")
  };

  assert.ok(idx.idempotencyLookup > -1, "idempotency lookup not found");
  assert.ok(idx.ownershipCheck > -1, "ownership check not found");
  assert.ok(idx.idempotencyLookup < idx.ownershipCheck, "ownership check must immediately follow the idempotency lookup");
  assert.ok(idx.userLock > -1, "user row lock not found");
  assert.ok(idx.coinCheck > -1, "insufficient coins check not found");
  assert.ok(idx.userLock < idx.coinCheck, "user row must be locked before the balance check");
});

test("claim_gacha_draw: reward (points/tickets/duplicate_bonus) is looked up from public.mascots via the SERVER'S OWN rolled rarity, never accepted as a parameter", () => {
  const claimFnMatch = GACHA_DRAW_SQL.match(/CREATE OR REPLACE FUNCTION public\.claim_gacha_draw\([\s\S]*?END;\r?\n\$\$;/);
  assert.ok(claimFnMatch, "claim_gacha_draw function body not found");
  assert.doesNotMatch(claimFnMatch[0], /p_points_earned|p_tickets_earned|p_is_new|p_rarity\b/i);
  assert.match(GACHA_DRAW_SQL, /SELECT id, name, points, tickets, duplicate_bonus, image, rarity INTO v_mascot\s*\n\s*FROM public\.mascots\s*\n\s*WHERE rarity = v_rarity_code AND enabled = true/);
});

test("claim_gacha_draw: new-vs-duplicate is determined from the ACTUAL (locked) user_mascots row for the SERVER-CHOSEN mascot, never a client-supplied flag", () => {
  assert.match(GACHA_DRAW_SQL, /SELECT \* INTO v_existing_mascot\s*\n\s*FROM public\.user_mascots\s*\n\s*WHERE user_id = p_user_id AND mascot_id = v_mascot\.id\s*\n\s*FOR UPDATE/);
  assert.match(GACHA_DRAW_SQL, /v_is_new := NOT FOUND/);
});

test("claim_gacha_draw: mascot upsert relies on ON CONFLICT (user_id, mascot_id) — documents its dependency on 20260816000300", () => {
  assert.match(GACHA_DRAW_SQL, /ON CONFLICT \(user_id, mascot_id\) DO UPDATE/);
  assert.match(GACHA_DRAW_SQL, /20260816000300/);
});

test("claim_gacha_draw / upsert_user_mascot_obtain: SECURITY DEFINER hardened, granted only to service_role", () => {
  for (const fn of ["claim_gacha_draw(TEXT, TEXT)", "upsert_user_mascot_obtain(TEXT, TEXT, TEXT, TEXT, TEXT)"]) {
    const escaped = fn.replace(/[()]/g, (c) => `\\${c}`);
    assert.match(GACHA_DRAW_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC`));
    assert.match(GACHA_DRAW_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM anon`));
    assert.match(GACHA_DRAW_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM authenticated`));
    assert.match(GACHA_DRAW_SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped} TO service_role`));
  }
  assert.match(GACHA_DRAW_SQL, /CREATE OR REPLACE FUNCTION public\.claim_gacha_draw[\s\S]{0,600}?SECURITY DEFINER/);
  assert.match(GACHA_DRAW_SQL, /CREATE OR REPLACE FUNCTION public\.upsert_user_mascot_obtain[\s\S]{0,300}?SECURITY DEFINER/);
});

test("gacha_draw_requests: RLS enabled, owner-only SELECT, denies all authenticated writes, and stores mascot_name/rarity/image for a deterministic idempotent resend", () => {
  assert.match(GACHA_DRAW_SQL, /ALTER TABLE IF EXISTS public\.gacha_draw_requests ENABLE ROW LEVEL SECURITY/);
  assert.match(GACHA_DRAW_SQL, /CREATE POLICY p_gacha_draw_requests_select_owner[\s\S]{0,300}?public\.request_user_key\(\)/);
  assert.match(GACHA_DRAW_SQL, /CREATE POLICY p_gacha_draw_requests_deny_write_authenticated[\s\S]{0,200}?AS RESTRICTIVE/);
  assert.match(GACHA_DRAW_SQL, /mascot_name TEXT NOT NULL DEFAULT ''/);
  assert.match(GACHA_DRAW_SQL, /rarity TEXT NOT NULL DEFAULT ''/);
});

// --- 20260817000300: gift redeem ---

test("redeem_gift_transaction: idempotency lookup happens FIRST, and rejects a cached row belonging to a DIFFERENT user (P-AUTH-05A.1 lesson)", () => {
  const idx = {
    idempotencyLookup: GIFT_REDEEM_SQL.indexOf("SELECT * INTO v_cached FROM public.gift_redemption_requests"),
    ownershipCheck: GIFT_REDEEM_SQL.indexOf("v_cached.user_id <> p_user_id"),
    userLock: GIFT_REDEEM_SQL.indexOf("SELECT * INTO v_user FROM public.users WHERE user_id::text = p_user_id FOR UPDATE"),
    giftLock: GIFT_REDEEM_SQL.indexOf("FOR UPDATE;\n\n    IF NOT FOUND OR v_gift.enabled")
  };

  assert.ok(idx.idempotencyLookup > -1, "idempotency lookup not found");
  assert.ok(idx.ownershipCheck > -1, "ownership check not found");
  assert.ok(idx.idempotencyLookup < idx.ownershipCheck, "ownership check must immediately follow the idempotency lookup");
  assert.ok(idx.userLock > -1, "user row lock not found");
  assert.match(GIFT_REDEEM_SQL, /SELECT id, name, points_cost, tickets_cost, coins_cost, stock, enabled INTO v_gift\s*\n\s*FROM public\.gifts\s*\n\s*WHERE id = p_gift_id\s*\n\s*FOR UPDATE/);
});

test("redeem_gift_transaction: cost/name are ALWAYS resolved from public.gifts, never accepted as parameters", () => {
  assert.doesNotMatch(GIFT_REDEEM_SQL, /p_points_cost|p_tickets_cost|p_coins_cost|p_gift_name/i);
});

test("redeem_gift_transaction: verifies stock and all three balances BEFORE any mutation", () => {
  const idx = {
    stockCheck: GIFT_REDEEM_SQL.indexOf("is out of stock"),
    pointsCheck: GIFT_REDEEM_SQL.indexOf("insufficient points"),
    ticketsCheck: GIFT_REDEEM_SQL.indexOf("insufficient tickets"),
    coinsCheck: GIFT_REDEEM_SQL.indexOf("insufficient coins"),
    firstLedgerCall: GIFT_REDEEM_SQL.indexOf("PERFORM public.apply_point_transaction"),
    stockUpdate: GIFT_REDEEM_SQL.indexOf("UPDATE public.gifts")
  };

  for (const [name, value] of Object.entries(idx)) {
    assert.ok(value > -1, `${name} not found`);
  }

  assert.ok(idx.stockCheck < idx.firstLedgerCall, "stock check must happen before any ledger mutation");
  assert.ok(idx.pointsCheck < idx.firstLedgerCall, "points check must happen before any ledger mutation");
  assert.ok(idx.ticketsCheck < idx.firstLedgerCall, "tickets check must happen before any ledger mutation");
  assert.ok(idx.coinsCheck < idx.firstLedgerCall, "coins check must happen before any ledger mutation");
  assert.ok(idx.firstLedgerCall < idx.stockUpdate, "ledger deductions must happen before stock is decremented");
});

test("redeem_gift_transaction: writes redeem_history with status='completed' (atomic, not the old two-step 'pending' status)", () => {
  assert.match(GIFT_REDEEM_SQL, /INSERT INTO public\.redeem_history[\s\S]{0,600}?'completed'/);
});

test("redeem_gift_transaction: SECURITY DEFINER hardened, granted only to service_role", () => {
  assert.match(GIFT_REDEEM_SQL, /CREATE OR REPLACE FUNCTION public\.redeem_gift_transaction[\s\S]{0,600}?SECURITY DEFINER/);
  assert.match(GIFT_REDEEM_SQL, /SET search_path = public, pg_temp/);
  assert.match(GIFT_REDEEM_SQL, /REVOKE ALL ON FUNCTION public\.redeem_gift_transaction\(TEXT, TEXT, TEXT\) FROM PUBLIC/);
  assert.match(GIFT_REDEEM_SQL, /REVOKE ALL ON FUNCTION public\.redeem_gift_transaction\(TEXT, TEXT, TEXT\) FROM anon/);
  assert.match(GIFT_REDEEM_SQL, /REVOKE ALL ON FUNCTION public\.redeem_gift_transaction\(TEXT, TEXT, TEXT\) FROM authenticated/);
  assert.match(GIFT_REDEEM_SQL, /GRANT EXECUTE ON FUNCTION public\.redeem_gift_transaction\(TEXT, TEXT, TEXT\) TO service_role/);
});

test("gift_redemption_requests: RLS enabled, owner-only SELECT, denies all authenticated writes", () => {
  assert.match(GIFT_REDEEM_SQL, /ALTER TABLE IF EXISTS public\.gift_redemption_requests ENABLE ROW LEVEL SECURITY/);
  assert.match(GIFT_REDEEM_SQL, /CREATE POLICY p_gift_redemption_requests_select_owner[\s\S]{0,300}?public\.request_user_key\(\)/);
  assert.match(GIFT_REDEEM_SQL, /CREATE POLICY p_gift_redemption_requests_deny_write_authenticated[\s\S]{0,200}?AS RESTRICTIVE/);
});

test("gift redeem migration: never uses a fully-permissive USING/WITH CHECK (true) policy", () => {
  assert.doesNotMatch(GIFT_REDEEM_SQL, /USING\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(GIFT_REDEEM_SQL, /WITH CHECK\s*\(\s*true\s*\)/i);
});
