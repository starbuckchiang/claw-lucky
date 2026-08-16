"use strict";

/**
 * P-AUTH-05B-2B: Static structural tests for the Cart/Checkout Secure Write
 * RPC migration (`20260817000400_shop_cart_checkout_secure_rpc.sql`).
 *
 * SAME LIMITATION as `wallet-secure-write-rpcs-shape.test.js` (see that
 * file's header): no local Postgres/pg-mem harness and no live Supabase
 * project access from this environment — these are STATIC assertions on
 * the migration SQL TEXT itself (hardening pattern present, dangerous
 * patterns absent, validation/locking ORDER via string position), NOT
 * proof of real Postgres runtime behavior. A real Supabase project run is
 * still required before this is considered verified (see
 * review-auth-05B-2B.md's 05C Staging Gate plan).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "..");
const SHOP_CART_SQL = fs.readFileSync(path.join(MIGRATIONS_DIR, "20260817000400_shop_cart_checkout_secure_rpc.sql"), "utf8");

function extractFunctionBody(sql, functionName) {
  const regex = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?END;\\r?\\n\\$\\$;`);
  const match = sql.match(regex);
  assert.ok(match, `${functionName} function body not found`);
  return match[0];
}

test("shop_checkout_requests: table has RLS enabled, owner-only SELECT, and denies all authenticated writes", () => {
  assert.match(SHOP_CART_SQL, /ALTER TABLE IF EXISTS public\.shop_checkout_requests ENABLE ROW LEVEL SECURITY/);
  assert.match(SHOP_CART_SQL, /CREATE POLICY p_shop_checkout_requests_select_owner[\s\S]{0,300}?public\.request_user_key\(\)/);
  assert.match(SHOP_CART_SQL, /CREATE POLICY p_shop_checkout_requests_deny_write_authenticated/);
});

test("migration never uses a fully-permissive USING/WITH CHECK (true) policy", () => {
  assert.doesNotMatch(SHOP_CART_SQL, /USING\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(SHOP_CART_SQL, /WITH CHECK\s*\(\s*true\s*\)/i);
});

for (const [fnName, paramTypes] of [
  ["add_cart_item", "TEXT, TEXT, INTEGER"],
  ["update_cart_item_quantity", "TEXT, TEXT, INTEGER"],
  ["remove_cart_item", "TEXT, TEXT"],
  ["clear_cart", "TEXT"],
  ["checkout_cart", "TEXT, TEXT"]
]) {
  test(`${fnName}: SECURITY DEFINER hardened (search_path pinned, revoked from PUBLIC/anon/authenticated, granted only to service_role)`, () => {
    const fnBody = extractFunctionBody(SHOP_CART_SQL, fnName);

    assert.match(fnBody, /SECURITY DEFINER/);
    assert.match(fnBody, /SET search_path = public, pg_temp/);

    const escapedParamTypes = paramTypes.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(SHOP_CART_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fnName}\\(${escapedParamTypes}\\) FROM PUBLIC`));
    assert.match(SHOP_CART_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fnName}\\(${escapedParamTypes}\\) FROM anon`));
    assert.match(SHOP_CART_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fnName}\\(${escapedParamTypes}\\) FROM authenticated`));
    assert.match(SHOP_CART_SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fnName}\\(${escapedParamTypes}\\) TO service_role`));
  });
}

// --- Business-authority: NONE of the five functions accept a price/
// subtotal/total/name/image/stock/owner-role parameter — the caller's
// business authority is structurally absent, not merely re-validated. ---

test("no function signature in this migration accepts a price/subtotal/total/name/image parameter from the caller", () => {
  for (const fnName of ["add_cart_item", "update_cart_item_quantity", "remove_cart_item", "clear_cart", "checkout_cart"]) {
    const signatureRegex = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fnName}\\(([\\s\\S]*?)\\)\\s*RETURNS`);
    const match = SHOP_CART_SQL.match(signatureRegex);
    assert.ok(match, `${fnName} signature not found`);
    const paramList = match[1];
    assert.doesNotMatch(paramList, /p_price|p_subtotal|p_total|p_product_name|p_product_image|p_stock/i, `${fnName} must not accept a business-authoritative parameter`);
  }
});

test("add_cart_item / update_cart_item_quantity / checkout_cart: all re-read price/stock/enabled from public.shop_products themselves (never from a parameter)", () => {
  for (const fnName of ["add_cart_item", "update_cart_item_quantity", "checkout_cart"]) {
    const fnBody = extractFunctionBody(SHOP_CART_SQL, fnName);
    assert.match(fnBody, /FROM public\.shop_products/);
    assert.match(fnBody, /FOR UPDATE/);
  }
});

test("checkout_cart: locks the caller's cart rows and each referenced product row FOR UPDATE before computing totals", () => {
  const fnBody = extractFunctionBody(SHOP_CART_SQL, "checkout_cart");
  const cartLockIdx = fnBody.indexOf("FROM public.shop_cart WHERE user_id::text = p_user_id FOR UPDATE");
  const productLockIdx = fnBody.indexOf("FROM public.shop_products");
  const insertOrderIdx = fnBody.indexOf("INSERT INTO public.orders");

  assert.ok(cartLockIdx > -1, "cart FOR UPDATE lock not found");
  assert.ok(productLockIdx > -1, "product lookup not found");
  assert.ok(insertOrderIdx > -1, "order insert not found");
  assert.ok(cartLockIdx < productLockIdx, "cart rows must be locked before iterating products");
  assert.ok(productLockIdx < insertOrderIdx, "products must be locked/validated before the order is created");
});

test("checkout_cart: idempotency lookup happens BEFORE any cart/product lock or mutation, but the cached row's user_id is ALWAYS compared before returning (P-AUTH-05A.1 pattern)", () => {
  const fnBody = extractFunctionBody(SHOP_CART_SQL, "checkout_cart");
  const idempotencyLookupIdx = fnBody.indexOf("FROM public.shop_checkout_requests");
  const identityCheckIdx = fnBody.indexOf("v_cached.user_id <> p_user_id");
  const cartLockIdx = fnBody.indexOf("FROM public.shop_cart WHERE user_id::text = p_user_id FOR UPDATE");

  assert.ok(idempotencyLookupIdx > -1);
  assert.ok(identityCheckIdx > -1);
  assert.ok(cartLockIdx > -1);
  assert.ok(idempotencyLookupIdx < identityCheckIdx, "identity check must immediately follow the idempotency cache lookup");
  assert.ok(identityCheckIdx < cartLockIdx, "identity check must happen before locking cart rows for a fresh checkout");
});

test("checkout_cart: rejects (raises) whenever a locked product's stock is less than the requested quantity — stock can never go negative", () => {
  const fnBody = extractFunctionBody(SHOP_CART_SQL, "checkout_cart");
  assert.match(fnBody, /IF COALESCE\(v_product\.stock, 0\) < v_cart_row\.quantity THEN\s*\n\s*RAISE EXCEPTION 'checkout_cart: insufficient stock/);
});

test("checkout_cart: stock decrement (UPDATE shop_products SET stock = stock - quantity) happens INSIDE the same per-item validation loop, after the stock check", () => {
  const fnBody = extractFunctionBody(SHOP_CART_SQL, "checkout_cart");
  const stockCheckIdx = fnBody.indexOf("RAISE EXCEPTION 'checkout_cart: insufficient stock");
  const decrementIdx = fnBody.indexOf("SET stock = stock - v_cart_row.quantity");
  assert.ok(stockCheckIdx > -1);
  assert.ok(decrementIdx > -1);
  assert.ok(stockCheckIdx < decrementIdx, "stock must be validated before it is decremented");
});

test("checkout_cart: never sets orders.status to a payment-success value — only 'pending' is ever inserted (no payment integration exists yet)", () => {
  const fnBody = extractFunctionBody(SHOP_CART_SQL, "checkout_cart");
  assert.match(fnBody, /'pending', NOW\(\), NOW\(\)\)/);
  assert.doesNotMatch(fnBody, /'paid'|'completed'|'success'/i);
});

test("update_cart_item_quantity / remove_cart_item: ownership is enforced structurally in the SAME query that looks up the row (id AND user_id together), not a separate check afterward", () => {
  const updateFnBody = extractFunctionBody(SHOP_CART_SQL, "update_cart_item_quantity");
  assert.match(updateFnBody, /WHERE id::text = p_cart_id\s*\n\s*AND user_id::text = p_user_id\s*\n\s*FOR UPDATE/);

  const removeFnBody = extractFunctionBody(SHOP_CART_SQL, "remove_cart_item");
  assert.match(removeFnBody, /WHERE id::text = p_cart_id\s*\n\s*AND user_id::text = p_user_id/);
});

test("add_cart_item: verifies required_mascot unlock eligibility from public.user_mascots before allowing the add (existing business rule preserved, not silently dropped)", () => {
  const fnBody = extractFunctionBody(SHOP_CART_SQL, "add_cart_item");
  assert.match(fnBody, /FROM public\.user_mascots/);
  assert.match(fnBody, /RAISE EXCEPTION 'add_cart_item: required mascot not unlocked/);
});
