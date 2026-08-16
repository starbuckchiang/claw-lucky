"use strict";

/**
 * P-AUTH-05C.3: Static structural tests for the Shop UUID Type Hotfix
 * (`20260817000900_shop_uuid_type_hotfix.sql`) — fixes the
 * `column "product_id" is of type uuid but expression is of type text`
 * bug found live during the P-AUTH-05C.2 Cart smoke test, plus the
 * `add_cart_item` vs. `checkout_cart` lock-ordering deadlock risk.
 *
 * SAME LIMITATION as every prior migration-shape test in this repo: no
 * local Postgres/pg-mem harness — these are STATIC assertions on the
 * migration SQL TEXT itself. A real Supabase project run (§ "Production
 * 驗證計畫" in review-auth-05C.3-shop-uuid-hotfix-preflight.md) is
 * required before this can be considered runtime-verified — explicitly
 * NOT performed by this task (no db push/deploy/checkout).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "..");
const HOTFIX_SQL = fs.readFileSync(path.join(MIGRATIONS_DIR, "20260817000900_shop_uuid_type_hotfix.sql"), "utf8");
const ORIGINAL_SQL = fs.readFileSync(path.join(MIGRATIONS_DIR, "20260817000400_shop_cart_checkout_secure_rpc.sql"), "utf8");
const CLAIM_FIX_SQL = fs.readFileSync(path.join(MIGRATIONS_DIR, "20260817000500_shop_checkout_atomic_claim_fix.sql"), "utf8");

function extractFunctionBody(sql, functionName) {
  const regex = new RegExp(`^CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?END;\\r?\\n\\$\\$;`, "m");
  const match = sql.match(regex);
  assert.ok(match, `${functionName} function body not found`);
  return match[0];
}

// --- Requirement 1: previously-applied migrations are NOT modified ---

test("this hotfix does not modify 20260817000400 or 20260817000500 (their text is untouched, unrelated to this new file)", () => {
  // Sanity: both prior migration files still parse and still define the
  // OLD (buggy) bodies verbatim — proves this task only ADDED a new file.
  assert.match(ORIGINAL_SQL, /CREATE OR REPLACE FUNCTION public\.add_cart_item/);
  assert.match(ORIGINAL_SQL, /VALUES \(\s*p_user_id, p_product_id, p_quantity, true, true, NOW\(\), NOW\(\)\s*\)/);
  assert.match(CLAIM_FIX_SQL, /CREATE OR REPLACE FUNCTION public\.checkout_cart/);
});

// --- Requirement 2/3: add_cart_item uses the already-typed v_product.id, never a raw cast of p_product_id ---

test("add_cart_item: the fresh-INSERT uses v_product.id (already uuid), never re-casts the raw p_product_id parameter", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "add_cart_item");
  const insertMatch = fnBody.match(/INSERT INTO public\.shop_cart \([\s\S]*?\) RETURNING \* INTO v_row;/);
  assert.ok(insertMatch, "shop_cart INSERT not found");
  assert.match(insertMatch[0], /VALUES \(\s*p_user_id, v_product\.id, p_quantity/);
  assert.doesNotMatch(insertMatch[0], /p_product_id::uuid/);
  assert.doesNotMatch(insertMatch[0], /VALUES \(\s*p_user_id, p_product_id,/);
});

test("add_cart_item: never casts the raw p_product_id parameter to uuid anywhere in the function body (structurally impossible for an invalid UUID string to reach a ::uuid cast)", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "add_cart_item");
  assert.doesNotMatch(fnBody, /p_product_id::uuid/);
  assert.doesNotMatch(fnBody, /p_cart_id::uuid/);
});

// --- Lock ordering: add_cart_item now checks shop_cart BEFORE shop_products ---

test("add_cart_item: lock ordering is now shop_cart -> shop_products (matches checkout_cart, closes the deadlock risk)", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "add_cart_item");
  const cartLockIdx = fnBody.indexOf("FROM public.shop_cart");
  const productLockIdx = fnBody.indexOf("FROM public.shop_products");
  assert.ok(cartLockIdx > -1, "shop_cart lookup not found");
  assert.ok(productLockIdx > -1, "shop_products lookup not found");
  assert.ok(cartLockIdx < productLockIdx, "shop_cart must be checked/locked BEFORE shop_products");
});

test("add_cart_item: a unique_violation on the fresh-INSERT is caught and re-raised as a plain message — never a raw Postgres constraint-violation leak", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "add_cart_item");
  assert.match(fnBody, /EXCEPTION WHEN unique_violation THEN/);
  assert.doesNotMatch(fnBody, /shop_cart_user_id_product_id_key/); // never names the raw constraint in the re-raised message
});

// --- Requirement 5: checkout_cart casts order_items.product_id to uuid ---

test("checkout_cart: the order_items INSERT casts (elem->>'product_id')::uuid before writing to the uuid column", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "checkout_cart");
  const insertMatch = fnBody.match(/INSERT INTO public\.order_items \([\s\S]*?FROM jsonb_array_elements\(v_items\) elem;/);
  assert.ok(insertMatch, "order_items INSERT not found");
  assert.match(insertMatch[0], /\(elem->>'product_id'\)::uuid/);
  assert.doesNotMatch(insertMatch[0], /^\s*elem->>'product_id',/m);
});

// --- Requirement 6: order_id write uses the native v_order.id (already uuid), unchanged ---

test("checkout_cart: order_items.order_id is written from v_order.id (native uuid, no cast needed) — unchanged from the original", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "checkout_cart");
  const insertMatch = fnBody.match(/INSERT INTO public\.order_items \([\s\S]*?FROM jsonb_array_elements\(v_items\) elem;/);
  assert.match(insertMatch[0], /SELECT\s*\n\s*v_order\.id,/);
});

// --- Requirement 7: user_id columns are NOT changed to uuid anywhere ---

test("neither function ever casts p_user_id/user_id to uuid — user_id remains TEXT throughout, exactly as the real schema requires", () => {
  for (const fnName of ["add_cart_item", "checkout_cart"]) {
    const fnBody = extractFunctionBody(HOTFIX_SQL, fnName);
    assert.doesNotMatch(fnBody, /p_user_id::uuid/);
    assert.doesNotMatch(fnBody, /user_id::uuid/);
  }
});

// --- Requirement 6/9: business-authority + hardening preserved ---

test("both functions: same public signatures as the original (no overload created, repository call sites unaffected)", () => {
  assert.match(HOTFIX_SQL, /CREATE OR REPLACE FUNCTION public\.add_cart_item\(\s*\n\s*p_user_id TEXT,\s*\n\s*p_product_id TEXT,\s*\n\s*p_quantity INTEGER DEFAULT 1\s*\n\s*\) RETURNS public\.shop_cart/);
  assert.match(HOTFIX_SQL, /CREATE OR REPLACE FUNCTION public\.checkout_cart\(\s*\n\s*p_user_id TEXT,\s*\n\s*p_idempotency_key TEXT\s*\n\s*\) RETURNS jsonb/);
});

test("both functions: SECURITY DEFINER hardened, revoked from PUBLIC/anon/authenticated, granted only to service_role", () => {
  for (const [fnName, argTypes] of [["add_cart_item", "TEXT, TEXT, INTEGER"], ["checkout_cart", "TEXT, TEXT"]]) {
    const fnBody = extractFunctionBody(HOTFIX_SQL, fnName);
    assert.match(fnBody, /SECURITY DEFINER/);
    assert.match(fnBody, /SET search_path = public, pg_temp/);

    const escaped = argTypes.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(HOTFIX_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fnName}\\(${escaped}\\) FROM PUBLIC`));
    assert.match(HOTFIX_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fnName}\\(${escaped}\\) FROM anon`));
    assert.match(HOTFIX_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fnName}\\(${escaped}\\) FROM authenticated`));
    assert.match(HOTFIX_SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fnName}\\(${escaped}\\) TO service_role`));
  }
});

test("no business-authority parameter (price/subtotal/total/stock/owner) was added to either function's signature", () => {
  assert.doesNotMatch(HOTFIX_SQL, /p_price|p_subtotal|p_total|p_stock|p_owner/i);
});

test("checkout_cart: claim-then-lock idempotency ordering is UNCHANGED (claim-insert < lock-select < identity-check < completed-branch < cart-empty-check)", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "checkout_cart");
  const claimInsertIdx = fnBody.indexOf("INSERT INTO public.shop_checkout_requests (idempotency_key, user_id, order_id, status)");
  const lockSelectIdx = fnBody.indexOf("SELECT * INTO v_claim");
  const identityCheckIdx = fnBody.indexOf("v_claim.user_id <> p_user_id");
  const completedBranchIdx = fnBody.indexOf("IF v_claim.status = 'completed' THEN");
  const cartEmptyCheckIdx = fnBody.indexOf("RAISE EXCEPTION 'checkout_cart: cart is empty");

  assert.ok(claimInsertIdx < lockSelectIdx);
  assert.ok(lockSelectIdx < identityCheckIdx);
  assert.ok(identityCheckIdx < completedBranchIdx);
  assert.ok(completedBranchIdx < cartEmptyCheckIdx);
});

test("checkout_cart: orders.status is still only ever 'pending' — no payment-success claim introduced", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "checkout_cart");
  const orderInsertMatch = fnBody.match(/INSERT INTO public\.orders \([\s\S]*?RETURNING \* INTO v_order;/);
  assert.ok(orderInsertMatch);
  assert.match(orderInsertMatch[0], /'pending'/);
  assert.doesNotMatch(orderInsertMatch[0], /'paid'|'completed'|'success'/i);
});

test("checkout_cart: never sets order_no explicitly — still relies entirely on the existing trigger_set_order_no/generate_order_no() trigger", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "checkout_cart");
  const insertMatch = fnBody.match(/INSERT INTO public\.orders \(([^)]*)\)/);
  assert.ok(insertMatch);
  assert.doesNotMatch(insertMatch[1], /order_no/i);
});

test("no RLS policy statement appears anywhere in this migration (no schema/RLS change, pure function-body fix)", () => {
  assert.doesNotMatch(HOTFIX_SQL, /CREATE POLICY|ALTER TABLE.*ENABLE ROW LEVEL SECURITY|DROP POLICY/i);
});

// --- P-AUTH-05C.3.1: completeness review of the orders.id (uuid) <->
// shop_checkout_requests.order_id (text) boundary — confirms the gap
// described in the 05C.3.1 hotfix prompt does NOT exist in this file
// (it was already handled correctly, inherited unchanged from
// 20260817000500), and locks that correctness in with explicit tests. ---

test("checkout_cart: completing a checkout writes shop_checkout_requests.order_id with an explicit ::text cast of v_order.id (uuid -> text boundary), never a bare assignment", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "checkout_cart");
  const updateMatch = fnBody.match(/UPDATE public\.shop_checkout_requests\s+SET status = 'completed',\s+order_id = ([^\s]+)\s+WHERE idempotency_key = p_idempotency_key;/);
  assert.ok(updateMatch, "completion UPDATE of shop_checkout_requests not found");
  assert.equal(updateMatch[1], "v_order.id::text");
});

test("checkout_cart: never writes a bare, uncast `order_id = v_order.id` anywhere (would be an implicit/assignment cast, not an explicit safe conversion)", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "checkout_cart");
  assert.doesNotMatch(fnBody, /order_id = v_order\.id(?!::text)/);
});

test("checkout_cart: fresh idempotency claim allows order_id to start NULL (order not created yet)", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "checkout_cart");
  const claimInsertMatch = fnBody.match(/INSERT INTO public\.shop_checkout_requests \(idempotency_key, user_id, order_id, status\)\s+VALUES \(([^)]*)\)/);
  assert.ok(claimInsertMatch, "fresh claim INSERT not found");
  assert.match(claimInsertMatch[1], /\bNULL\b/);
});

test("checkout_cart: cached-result lookup compares o.id::text = v_claim.order_id (casts the trusted uuid column TO text; never casts the untrusted text claim value TO uuid)", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "checkout_cart");
  const cacheBlockMatch = fnBody.match(/IF v_claim\.status = 'completed' THEN[\s\S]*?RETURN v_cached_result;\s+END IF;/);
  assert.ok(cacheBlockMatch, "cached-result lookup block not found");
  const cacheBlock = cacheBlockMatch[0];
  assert.match(cacheBlock, /WHERE o\.id::text = v_claim\.order_id/);
  // The dangerous inverse (casting the caller/claim-derived TEXT value to
  // uuid) must never appear — an invalid/forged order_id string would
  // raise a raw Postgres error instead of a safe "not found" business
  // rejection.
  assert.doesNotMatch(cacheBlock, /v_claim\.order_id::uuid/);
  assert.doesNotMatch(cacheBlock, /o\.id = v_claim\.order_id(?!::)/); // no bare uuid = text comparison either
});

test("checkout_cart: order_items.order_id is populated from v_order.id with NO cast (uuid -> uuid, native match) — distinct from the uuid->text boundary above", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "checkout_cart");
  const insertMatch = fnBody.match(/INSERT INTO public\.order_items \([\s\S]*?FROM jsonb_array_elements\(v_items\) elem;/);
  assert.ok(insertMatch);
  assert.match(insertMatch[0], /SELECT\s*\n\s*v_order\.id,/);
  assert.doesNotMatch(insertMatch[0], /v_order\.id::/); // no cast needed/present for this uuid->uuid write
});

test("checkout_cart: p_user_id -> orders.user_id and p_user_id -> shop_checkout_requests.user_id are both native TEXT->TEXT writes (no cast present or needed)", () => {
  const fnBody = extractFunctionBody(HOTFIX_SQL, "checkout_cart");
  const orderInsertMatch = fnBody.match(/INSERT INTO public\.orders \([\s\S]*?RETURNING \* INTO v_order;/);
  assert.ok(orderInsertMatch);
  assert.match(orderInsertMatch[0], /VALUES \(p_user_id,/);

  const claimInsertMatch = fnBody.match(/INSERT INTO public\.shop_checkout_requests \(idempotency_key, user_id, order_id, status\)\s+VALUES \(([^)]*)\)/);
  assert.ok(claimInsertMatch);
  assert.match(claimInsertMatch[1], /p_idempotency_key, p_user_id,/);
});
