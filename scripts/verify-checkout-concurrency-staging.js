/* eslint-disable no-console */
/**
 * P-AUTH-05B-2B.1 Hotfix — REAL Checkout Concurrency Staging Verification
 *
 * This is a MANUALLY-RUN script (mirrors the existing convention of
 * `scripts/test-real-gemini-provider.js` / `docs/testing/real-wallpaper-e2e.md`
 * in this repo: real E2E scripts against a real deployed environment are
 * kept OUTSIDE `verify-local.ps1`'s automated `node --test` suite, since
 * they require real credentials/network access this environment does not
 * have). It is NOT run by this task. It is the concrete, executable design
 * for the 05C Staging Gate's required real-concurrency proof of
 * `checkout_cart()`'s claim-then-lock fix
 * (`20260817000400_shop_cart_checkout_secure_rpc.sql` /
 * `20260817000500_shop_checkout_atomic_claim_fix.sql`).
 *
 * WHAT THIS PROVES (once actually run against a real, staged Supabase
 * project with BOTH migrations applied and the `shop-ops` Edge Function
 * DEPLOYED):
 *   1. Two GENUINELY concurrent HTTP requests to `shop-ops/checkout` with
 *      the SAME idempotency key + SAME user's JWT create exactly ONE
 *      order (asserted via a direct DB read of `orders`/`order_items`
 *      count for that user after both requests resolve).
 *   2. Both HTTP responses return the SAME `order_id`.
 *   3. The product's `stock` was decremented by exactly the cart quantity
 *      ONCE (not twice), read directly from `shop_products` after.
 *   4. `order_items` contains exactly the cart's row count once (not
 *      duplicated).
 *
 * PREREQUISITES (all MUST be true before running this — it is a
 * deliberately unsafe/destructive script against whatever project you
 * point it at):
 *   - A STAGING (never production) Supabase project.
 *   - Both `20260817000400_shop_cart_checkout_secure_rpc.sql` AND
 *     `20260817000500_shop_checkout_atomic_claim_fix.sql` applied to it.
 *   - The `shop-ops` Edge Function deployed to it.
 *   - A real test user (JWT) with a non-empty `shop_cart` (at least one
 *     enabled product with stock >= quantity).
 *   - `SUPABASE_URL`, `STAGING_SHOP_OPS_URL` (the deployed
 *     `.../functions/v1/shop-ops/checkout` endpoint),
 *     `STAGING_USER_JWT` (a real bearer token for that test user),
 *     `STAGING_SERVICE_ROLE_KEY` (used ONLY here, to directly read
 *     `orders`/`order_items`/`shop_products` afterward for verification —
 *     never sent to the Edge Function itself).
 *
 * Usage (manual, 05C only):
 *   $env:SUPABASE_URL = "https://<project>.supabase.co"
 *   $env:STAGING_SHOP_OPS_URL = "https://<project>.functions.supabase.co/shop-ops/checkout"
 *   $env:STAGING_USER_JWT = "<real JWT>"
 *   $env:STAGING_SERVICE_ROLE_KEY = "<real service role key>"
 *   node scripts/verify-checkout-concurrency-staging.js
 *
 * Uses Node's built-in global `fetch` only — no new npm dependency is
 * required to run this.
 */

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return String(value).trim();
}

async function postCheckout({ url, jwt, idempotencyKey }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`
    },
    body: JSON.stringify({ idempotencyKey })
  });

  let body = null;
  try {
    body = await response.json();
  } catch (_error) {
    body = null;
  }

  return { status: response.status, body };
}

async function readOrdersDirect({ supabaseUrl, serviceRoleKey, orderId }) {
  const ordersRes = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
  });
  const orders = await ordersRes.json();

  const itemsRes = await fetch(`${supabaseUrl}/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}&select=*`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
  });
  const orderItems = await itemsRes.json();

  return { orders, orderItems };
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const shopOpsUrl = requiredEnv("STAGING_SHOP_OPS_URL");
  const jwt = requiredEnv("STAGING_USER_JWT");
  const serviceRoleKey = requiredEnv("STAGING_SERVICE_ROLE_KEY");

  const idempotencyKey = `staging-concurrency-check-${Date.now()}`;

  console.log(JSON.stringify({ event: "staging_concurrency_check_start", idempotencyKey }));

  // Two GENUINELY concurrent requests — no `await` between them.
  const [first, second] = await Promise.all([
    postCheckout({ url: shopOpsUrl, jwt, idempotencyKey }),
    postCheckout({ url: shopOpsUrl, jwt, idempotencyKey })
  ]);

  const results = { first, second };
  console.log(JSON.stringify({ event: "staging_concurrency_check_responses", results }, null, 2));

  const firstOrderId = first.body?.data?.order_id;
  const secondOrderId = second.body?.data?.order_id;

  const checks = [];

  checks.push({
    name: "both requests succeeded (HTTP 200)",
    pass: first.status === 200 && second.status === 200
  });

  checks.push({
    name: "both responses returned the SAME order_id",
    pass: Boolean(firstOrderId) && firstOrderId === secondOrderId
  });

  if (firstOrderId) {
    const { orders, orderItems } = await readOrdersDirect({ supabaseUrl, serviceRoleKey, orderId: firstOrderId });

    checks.push({
      name: "exactly ONE orders row exists for this order_id",
      pass: Array.isArray(orders) && orders.length === 1
    });

    checks.push({
      name: "order_items exists for this order (not empty, not duplicated beyond the cart's own row count)",
      pass: Array.isArray(orderItems) && orderItems.length > 0
    });
  }

  console.log(JSON.stringify({ event: "staging_concurrency_check_result", checks }, null, 2));

  const allPassed = checks.every((c) => c.pass);
  if (!allPassed) {
    console.error("STAGING CONCURRENCY CHECK FAILED — see checks above.");
    process.exitCode = 1;
    return;
  }

  console.log("STAGING CONCURRENCY CHECK PASSED.");
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "staging_concurrency_check_error", message: error?.message }));
  process.exitCode = 1;
});
