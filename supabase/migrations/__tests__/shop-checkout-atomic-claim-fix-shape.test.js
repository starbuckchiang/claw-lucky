"use strict";

/**
 * P-AUTH-05B-2B.1 Hotfix: Static structural tests for the Checkout atomic
 * claim-then-lock fix (`20260817000500_shop_checkout_atomic_claim_fix.sql`).
 *
 * SAME LIMITATION as every prior migration-shape test in this repo (see
 * `shop-cart-checkout-secure-rpc-shape.test.js`'s header): no local
 * Postgres/pg-mem harness and no live Supabase project access from this
 * environment. These are STATIC assertions on the migration SQL TEXT
 * itself — proving the CLAIM/LOCK/IDENTITY-CHECK/STATUS-BRANCH ordering is
 * textually correct, and that no exception-catching shortcut exists — NOT
 * proof of real Postgres concurrency behavior.
 *
 * STATIC PASS vs RUNTIME NOT RUN (P-AUTH-05B-2B.1 requirement 3):
 * every test in this file is a STATIC PASS. The corresponding REAL
 * concurrency proof (two actual concurrent `checkout_cart` calls against a
 * real Postgres/Supabase project) is designed in
 * `scripts/verify-checkout-concurrency-staging.js` but has NOT been run —
 * that is an explicit 05C Staging Gate blocker, not something this test
 * file can close.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "..");
const FIX_SQL = fs.readFileSync(path.join(MIGRATIONS_DIR, "20260817000500_shop_checkout_atomic_claim_fix.sql"), "utf8");

function extractFunctionBody(sql, functionName) {
  // Anchored to the START of a line (multiline `^`) so a header comment
  // that merely MENTIONS `CREATE OR REPLACE FUNCTION public.foo(` in
  // backticks (as this migration's own header does, to describe what it
  // does) is never mistaken for the real definition — only a line that
  // ACTUALLY begins with `CREATE OR REPLACE FUNCTION` qualifies.
  const regex = new RegExp(`^CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?END;\\r?\\n\\$\\$;`, "m");
  const match = sql.match(regex);
  assert.ok(match, `${functionName} function body not found`);
  return match[0];
}

// --- Schema ALTER disclosure (requirement 4: this migration DOES alter
// existing schema — the 05B-2B table — and that must be explicit, not
// hidden behind a "no existing schema touched" claim). ---

test("this migration explicitly ALTERs the EXISTING shop_checkout_requests table (adds status, drops NOT NULL on order_id) — it is not purely additive", () => {
  assert.match(FIX_SQL, /ALTER TABLE IF EXISTS public\.shop_checkout_requests\s*\n\s*ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processing'/);
  assert.match(FIX_SQL, /ALTER COLUMN order_id DROP NOT NULL/);
  assert.match(FIX_SQL, /ADD CONSTRAINT shop_checkout_requests_status_check\s*\n\s*CHECK \(status IN \('processing', 'completed'\)\)/);
});

test("checkout_cart: SECURITY DEFINER hardened, revoked from PUBLIC/anon/authenticated, granted only to service_role (same signature as the 05B-2B original)", () => {
  const fnBody = extractFunctionBody(FIX_SQL, "checkout_cart");
  assert.match(fnBody, /SECURITY DEFINER/);
  assert.match(fnBody, /SET search_path = public, pg_temp/);

  assert.match(FIX_SQL, /REVOKE ALL ON FUNCTION public\.checkout_cart\(TEXT, TEXT\) FROM PUBLIC/);
  assert.match(FIX_SQL, /REVOKE ALL ON FUNCTION public\.checkout_cart\(TEXT, TEXT\) FROM anon/);
  assert.match(FIX_SQL, /REVOKE ALL ON FUNCTION public\.checkout_cart\(TEXT, TEXT\) FROM authenticated/);
  assert.match(FIX_SQL, /GRANT EXECUTE ON FUNCTION public\.checkout_cart\(TEXT, TEXT\) TO service_role/);
});

// --- The actual race fix: claim (INSERT ... ON CONFLICT DO NOTHING) BEFORE
// lock (SELECT ... FOR UPDATE) BEFORE identity check BEFORE the
// completed/processing branch BEFORE the cart-empty check. ---

test("checkout_cart: claims the idempotency key via INSERT ... ON CONFLICT (idempotency_key) DO NOTHING — never via a caught unique-violation exception", () => {
  const fnBody = extractFunctionBody(FIX_SQL, "checkout_cart");
  assert.match(fnBody, /INSERT INTO public\.shop_checkout_requests \(idempotency_key, user_id, order_id, status\)\s*\n\s*VALUES \(p_idempotency_key, p_user_id, NULL, 'processing'\)\s*\n\s*ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.doesNotMatch(fnBody, /EXCEPTION\s+WHEN\s+unique_violation/i);
});

test("checkout_cart: ordering is claim-insert < lock-select < identity-check < completed-branch < cart-empty-check", () => {
  const fnBody = extractFunctionBody(FIX_SQL, "checkout_cart");

  const claimInsertIdx = fnBody.indexOf("INSERT INTO public.shop_checkout_requests (idempotency_key, user_id, order_id, status)");
  const lockSelectIdx = fnBody.indexOf("SELECT * INTO v_claim");
  const identityCheckIdx = fnBody.indexOf("v_claim.user_id <> p_user_id");
  const completedBranchIdx = fnBody.indexOf("IF v_claim.status = 'completed' THEN");
  const cartEmptyCheckIdx = fnBody.indexOf("RAISE EXCEPTION 'checkout_cart: cart is empty");

  assert.ok(claimInsertIdx > -1, "claim INSERT not found");
  assert.ok(lockSelectIdx > -1, "lock SELECT not found");
  assert.ok(identityCheckIdx > -1, "identity check not found");
  assert.ok(completedBranchIdx > -1, "completed branch not found");
  assert.ok(cartEmptyCheckIdx > -1, "cart-empty check not found");

  assert.ok(claimInsertIdx < lockSelectIdx, "claim must be attempted before locking/reading the row");
  assert.ok(lockSelectIdx < identityCheckIdx, "the row must be locked before the identity check runs");
  assert.ok(identityCheckIdx < completedBranchIdx, "identity must be verified before branching on status");
  assert.ok(completedBranchIdx < cartEmptyCheckIdx, "an already-completed claim must return BEFORE the cart-empty check ever runs — CART_EMPTY must never mask a completed result");
});

test("checkout_cart: the completed-claim branch returns EARLY (via RETURN) before any cart/product lock or mutation", () => {
  const fnBody = extractFunctionBody(FIX_SQL, "checkout_cart");
  const completedBranchIdx = fnBody.indexOf("IF v_claim.status = 'completed' THEN");
  const completedReturnIdx = fnBody.indexOf("RETURN v_cached_result;");
  const cartLockIdx = fnBody.indexOf("FROM public.shop_cart WHERE user_id::text = p_user_id FOR UPDATE");

  assert.ok(completedBranchIdx > -1 && completedReturnIdx > -1 && cartLockIdx > -1);
  assert.ok(completedBranchIdx < completedReturnIdx, "completed branch must contain its own RETURN");
  assert.ok(completedReturnIdx < cartLockIdx, "the completed-claim RETURN must happen before the cart is ever locked for a fresh checkout");
});

test("checkout_cart: on a FRESH claim, marks its OWN row completed via UPDATE (not a second INSERT) after the order/order_items are created", () => {
  const fnBody = extractFunctionBody(FIX_SQL, "checkout_cart");
  const orderInsertIdx = fnBody.indexOf("INSERT INTO public.orders");
  const markCompletedIdx = fnBody.indexOf("SET status = 'completed'");

  assert.ok(orderInsertIdx > -1, "order insert not found");
  assert.ok(markCompletedIdx > -1, "mark-completed UPDATE not found");
  assert.ok(orderInsertIdx < markCompletedIdx, "the order must exist before the claim is marked completed");

  // The OLD 05B-2B design inserted a brand-new shop_checkout_requests row
  // here; the fix must not still do that (it would violate the PK against
  // the claim row from Step 1).
  assert.doesNotMatch(fnBody, /INSERT INTO public\.shop_checkout_requests \(idempotency_key, user_id, order_id\)\s*\n\s*VALUES \(p_idempotency_key, p_user_id, v_order\.id::text\)/);
});

test("checkout_cart: identity check happens for EVERY claim (completed or still-processing) — a cross-user replay is rejected regardless of the claim's status", () => {
  const fnBody = extractFunctionBody(FIX_SQL, "checkout_cart");
  const identityCheckIdx = fnBody.indexOf("v_claim.user_id <> p_user_id");
  const completedBranchIdx = fnBody.indexOf("IF v_claim.status = 'completed' THEN");
  assert.ok(identityCheckIdx > -1 && completedBranchIdx > -1);
  assert.ok(identityCheckIdx < completedBranchIdx, "identity check must be unconditional, evaluated before ANY status branch exists");
});

test("checkout_cart: still never sets orders.status to a payment-success value", () => {
  const fnBody = extractFunctionBody(FIX_SQL, "checkout_cart");
  const orderInsertMatch = fnBody.match(/INSERT INTO public\.orders \([\s\S]*?RETURNING \* INTO v_order;/);
  assert.ok(orderInsertMatch, "orders INSERT statement not found");
  // The claim-tracking `shop_checkout_requests.status` legitimately uses
  // the literal 'completed' elsewhere in this function — that is a
  // DIFFERENT field from orders.status, so this assertion is scoped to
  // the orders INSERT statement itself, not the whole function body.
  assert.match(orderInsertMatch[0], /'pending'/);
  assert.doesNotMatch(orderInsertMatch[0], /'paid'|'completed'|'success'/i);
});

// --- order_no staging blocker: confirm NO migration in this repo defines
// public.orders or its order_no column/default/trigger. If a future
// migration adds one, this test will start failing — a forcing function to
// update the blocker documentation instead of silently going stale. ---

test("order_no staging blocker: no migration file in this repo defines public.orders or an order_no column/default/trigger — this repo cannot prove how order_no is generated", () => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"));
  assert.ok(files.length > 0, "no migration files found");

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    assert.doesNotMatch(sql, /CREATE TABLE\s+(IF NOT EXISTS\s+)?public\.orders\b/i, `${file} unexpectedly defines public.orders`);
    assert.doesNotMatch(sql, /order_no\s+TEXT/i, `${file} unexpectedly defines an order_no column`);
    assert.doesNotMatch(sql, /CREATE\s+(OR\s+REPLACE\s+)?TRIGGER[\s\S]{0,300}order_no/i, `${file} unexpectedly defines a trigger touching order_no`);
  }
});

test("checkout_cart: the INSERT INTO orders statement does not set order_no explicitly (unchanged from 05B-2B — this fix does not invent an unverified generation scheme)", () => {
  const fnBody = extractFunctionBody(FIX_SQL, "checkout_cart");
  const insertMatch = fnBody.match(/INSERT INTO public\.orders \(([^)]*)\)/);
  assert.ok(insertMatch, "orders INSERT column list not found");
  assert.doesNotMatch(insertMatch[1], /order_no/i);
});
