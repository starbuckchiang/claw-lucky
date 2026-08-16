# review-auth-05B-2B.md — Cart & Orders Secure Write APIs

> **CORRECTED by P-AUTH-05B-2B.1 hotfix** (`review-auth-05B-2B.1-hotfix.md`):
> a real concurrency bug was found in `checkout_cart()`'s idempotency
> handling (two genuinely concurrent same-key requests could return
> `CART_EMPTY` to the loser instead of the winner's order) and fixed via a
> NEW additive migration
> (`20260817000500_shop_checkout_atomic_claim_fix.sql`). §5/§7/§9/§11
> below describe the PRE-hotfix design and are superseded where they
> discuss checkout idempotency/concurrency — read the hotfix doc for the
> current state. This doc's claim "no existing table/column/row/policy is
> modified" (§8) was true of the 05B-2B migration file alone but is no
> longer true of the overall migration set once the hotfix (which DOES
> `ALTER TABLE shop_checkout_requests`) is included — see the hotfix doc's
> §5 for the corrected, explicit disclosure.
>
> **FURTHER CORRECTED by P-AUTH-05C.0 Deployment Scope Audit**
> (`review-auth-05C.0-deployment-scope-audit.md`): this doc's "Migration &
> deployment status" section (below) saying the migrations are "NOT
> applied"/"NOT deployed" is now STALE — a LATER task (P-AUTH-05C)
> applied these migrations (and deployed `wallet-ops`, though NOT
> `shop-ops`) to `umtqpstacjdwxcvcirbl`, which was mistakenly believed to
> be a staging project at the time. It is actually PRODUCTION. See the
> audit doc for the full, corrected deployment status and current
> production impact (Cart/Checkout is currently non-functional in
> production as a direct result).

**Gate:** P-AUTH-05B-2B (Auth / Security Gate 05B-2B: Cart 與 Orders 安全化)
**Date:** 2026-08-16 (repo session date)
**Scope:** `js/shop/shop-api.js`, `js/shop/shop_cart.js` — Cart add/update/
remove/clear and Checkout (order creation) made server-authoritative.
**NOT in scope / unchanged:** `js/api.js` (Wallet/Gacha/Gift, P-AUTH-05B-2A),
`js/shop/orders.js` / `js/shop/luck_complete.js` (read-only SELECT, already
protected by 05A's owner-read RLS), payment provider integration (none
exists), `20260816000000_core_user_tables_owner_rls.sql` (not modified).

---

## 1. Git checkpoint


Local commit created before any 05B-2B change (includes all outstanding
uncommitted 05B-1/05B-2A work as a snapshot, per instruction #8):

```
18986a6 checkpoint: pre-05B-2B (snapshot of P-AUTH-05B-1/05B-2A work before Cart/Orders security gate)
```

No push performed. Rollback: `git reset --hard 18986a6` reverts every file
this gate touched (and nothing from before it).

---

## 2. 盤點 (Inventory) — caller → API → DB write table (BEFORE this gate)

| Caller (page/JS) | Function | DB write | Ownership check | Business-value trust |
|---|---|---|---|---|
| `product.html` → `js/shop/shop-api.js` | `addToCart(productId)` | `INSERT`/`UPDATE shop_cart` (anon key) | `.eq("user_id", userId)` where `userId` is a **client-supplied** localStorage/JWT value — no DB-side lock, race between the initial `SELECT existing` and the later `UPDATE`/`INSERT` | Product price/stock/enabled were read once client-side and never re-verified at write time |
| `shop_cart.html` → `shop-api.js` | `updateCartItem(cartId, {quantity})` | `UPDATE shop_cart` | **NONE** — `.eq("id", cartId)` only, no `user_id` filter at all | quantity clamped to `≥1` client-side only, no upper bound, no stock re-check |
| `shop_cart.html` → `shop-api.js` | `removeCartItem(cartId)` | `DELETE shop_cart` | **NONE** — `.eq("id", cartId)` only | n/a |
| `shop_cart.html` → `shop-api.js` | `clearCart()` | `DELETE shop_cart` | `.eq("user_id", userId)` (client-supplied) | n/a |
| `shop_cart.html` → `js/shop/shop_cart.js` | `handleCheckout()` | `INSERT orders` (client-computed `total_amount`/`total_items`) → `INSERT order_items` (client-supplied `price`/`subtotal`/`product_name`/`product_image`) → `DELETE shop_cart` | `user_id` from client; **no idempotency at all** — a lost response/double-click could create two orders from the same cart | **Every price/subtotal/total/snapshot field was 100% client-supplied**, taken from the browser's own possibly-stale `cartItems` array; stock was **never** decremented anywhere |
| `orders.html` → `js/shop/orders.js` | `loadOrders()`/`loadOrderItems()` | `SELECT orders`/`order_items` | `.eq("user_id", userId)` (client-supplied, but **read-only**) | n/a (read-only, unaffected by this gate) |
| `luck_complete.html` → `js/shop/luck_complete.js` | `loadCompletePage()` | `SELECT orders`/`order_items` | client-supplied `user_id`, read-only | n/a (unaffected) |

**Existing RLS context (found, not modified):**
`20260816000000_core_user_tables_owner_rls.sql` already enables RLS on
`shop_cart`/`orders`/`order_items` with **owner-only SELECT** and **DENY ALL
authenticated INSERT/UPDATE/DELETE** — its own header comment explicitly
flags "Order creation (Checkout) moves to an Edge Function/RPC" and "the
follow-up Edge Function/RPC replacing these call sites MUST re-verify
ownership itself" as required follow-up. This gate is that follow-up. No
existing policy in that migration was touched.

**Auth/session context (found, not modified):** identical to 05B-2A — the
Edge Function derives identity SOLELY from `resolveAuthenticatedUser(req)`
(anon-client JWT verification), never from the request body.

---

## 3. Cart ownership & price security boundary

New Edge Function `shop-ops` (NOT deployed) with 5 routes, backed by 5
`SECURITY DEFINER` RPCs in
[20260817000400_shop_cart_checkout_secure_rpc.sql](../../../supabase/migrations/20260817000400_shop_cart_checkout_secure_rpc.sql)
(granted to `service_role` ONLY):

| Route | RPC | What the RPC re-verifies server-side |
|---|---|---|
| `cart-add` | `add_cart_item(p_user_id, p_product_id, p_quantity)` | product exists/enabled (`FOR UPDATE`), required-mascot unlock eligibility (`user_mascots`), quantity 1-99, existing-row `FOR UPDATE` merge, stock (both existing-row-merge and fresh-insert paths) |
| `cart-update` | `update_cart_item_quantity(p_user_id, p_cart_id, p_quantity)` | cart row ownership (`id AND user_id` in ONE query), quantity 1-99, product enabled/stock |
| `cart-remove` | `remove_cart_item(p_user_id, p_cart_id)` | ownership via `DELETE ... WHERE id AND user_id`; tolerant of "already removed"/"not owned" (returns `false`, never leaks which case it was) |
| `cart-clear` | `clear_cart(p_user_id)` | owner-scoped delete only |
| `checkout` | `checkout_cart(p_user_id, p_idempotency_key)` | see §4 |

**Structural guarantee (not just "validated"):** none of the five RPC
signatures — and none of the five HTTP route allowlists in
`shop-ops-handler.js`/`.ts` — accept a `price`/`unitPrice`/`subtotal`/
`total`/`productName`/`productImage`/`stock` parameter at all. The
allowlist additionally rejects `userId`/`user_id`/`ownerId`/`owner_id` on
every route (same convention as `wallet-ops-handler.js`). Verified by a
parametrized structural test (`shop-ops-handler.test.js`) that iterates
every route × every forbidden field and asserts a 400 with **zero**
repository calls.

If cart UI ever displays a price, it now always comes back from the
server's own re-read of `shop_products` (the RPC's returned row / the
`items[].price` in a checkout result) — the browser's own price is never
trusted as ground truth.

**Stock at add-to-cart time:** validated (rejects if requested quantity
would exceed current stock) but **not reserved** — two concurrent adds by
different users could both pass this check before either one's
Checkout runs. This is documented explicitly (matches the task's own
"若目前產品模型不在加入購物車時保留庫存，需清楚記錄並在 checkout 再次驗證"
instruction) — the authoritative, un-bypassable check is inside
`checkout_cart`'s locked-row loop (§4), which is where an actual purchase
commitment happens.

---

## 4. Checkout / order creation transaction flow

`checkout_cart(p_user_id, p_idempotency_key)` — one PL/pgSQL function, one
transaction:

1. **Idempotency lookup FIRST** (`shop_checkout_requests`, `FOR UPDATE`).
2. If a cached row is found: compare its `user_id` to `p_user_id` — reject
   (raise) on mismatch, **before** returning anything (P-AUTH-05A.1
   pattern). Otherwise re-select the existing `orders`/`order_items` and
   return the IDENTICAL result; nothing below this point re-executes.
3. **Fresh checkout:** `SELECT ... FROM shop_cart WHERE user_id = ... FOR
   UPDATE` — locks every one of the caller's own cart rows for the rest of
   the transaction (blocks a concurrent second checkout/cart-mutation on
   the same rows until commit/rollback). Empty cart → raise (`CART_EMPTY`).
4. For each cart row: lock the referenced `shop_products` row `FOR UPDATE`,
   re-verify `enabled`, re-verify `stock >= quantity` (raise
   `insufficient stock` otherwise — **the whole transaction rolls back**,
   no partial order), compute `subtotal` from the **locked row's own
   price**, accumulate `total_amount`/`total_items`, and decrement
   `shop_products.stock` immediately (guarded by the check one line
   above it — stock can never go negative).
5. `INSERT INTO orders (..., status='pending', ...)` — **no payment
   integration exists**, so every order is created `pending`; this
   function has no code path that ever writes a payment-success-looking
   status (statically asserted: `'paid'|'completed'|'success'` never
   appear as an inserted value).
6. `INSERT INTO order_items` from the server-computed snapshot
   (`product_name`/`product_image`/`price`/`quantity`/`subtotal` — all
   read from the locked `shop_products` row, never from the caller).
7. `DELETE FROM shop_cart WHERE user_id = ...` — cart cleared only after
   every prior step succeeded.
8. Record the result under `shop_checkout_requests (idempotency_key,
   user_id, order_id)`.
9. Return the order + items as a single `jsonb` value.

Any `RAISE EXCEPTION` at any step rolls back the ENTIRE transaction
(including the stock decrements and any earlier `order`/`order_items`
insert in the same call) — there is no code path that leaves a
half-committed order.

---

## 5. Idempotency design

- One `shop_checkout_requests` row per **checkout intent**, keyed by a
  caller-generated `idempotencyKey` (`UNIQUE`, mirrors
  `gift_redemption_requests`'s exact pattern).
- `js/shop/shop_cart.js`: `getOrCreateCheckoutIdempotencyKey()` generates
  the key ONCE per checkout attempt (page-scoped variable, created right
  before the network call, same shape as `js/pages/gacha.js`'s
  `getOrCreateDrawIdempotencyKey()`).
- Cleared (`pendingCheckoutIdempotencyKey = null`) on: (a) success, or
  (b) a **definitive non-retryable business rejection** (`error.retryable
  === false` — e.g. cart empty, product unavailable, out of stock — the
  user must change something before a retry could ever succeed).
- **Kept alive** across a retry for any other outcome (no HTTP response,
  non-JSON body, unrecognized error shape, missing/non-boolean
  `retryable`) — so a manual retry after a lost response reuses the exact
  same key and resolves to step 2 above (returns the already-created
  order, never double-charges stock or double-creates an order).
- Cart `add`/`update`/`remove`/`clear` deliberately do **NOT** get an
  idempotency key. Reasoning (per the task's own conditional wording,
  "若已有重試機制…"): there is no pre-existing client-side retry mechanism
  for these four operations today, and each is either naturally idempotent
  (`remove`/`clear` — repeating them is harmless) or preserves its exact
  pre-existing UI semantics (`add` — each explicit click still adds
  exactly one more unit, unchanged from before this gate). This is an
  explicit, documented scope decision, not an oversight.

---

## 6. Retryable / non-retryable classification

`js/shop/shop-api.js`'s `invokeShopOpsFunction()` is a byte-for-byte port of
`js/api.js`'s `invokeWalletOpsFunction()` (P-AUTH-05B-2A.1 hotfix logic):

- `retryable:false` **only** when the response is a successfully-parsed
  `{ok:false, error:{retryable:false}}` from `shop-ops-handler`'s own JSON
  shape.
- **Every** other outcome defaults to `retryable:true`: no HTTP response at
  all (network/DNS/timeout), a non-JSON body (e.g. a raw 502/503 gateway
  page), a JSON body without a recognized `error` field, or a parsed
  `error.retryable` that is missing/non-boolean.
- `error.context` presence is **never** treated as sufficient for
  `retryable:false` on its own (the exact P-AUTH-05B-2A.1 lesson) — the
  same 6-case test matrix from `js/__tests__/api.test.js` was ported to
  `js/shop/__tests__/shop-api.test.js`.

---

## 7. Tests added & full test results

New files:

- `supabase/migrations/20260817000400_shop_cart_checkout_secure_rpc.sql`
- `supabase/migrations/__tests__/shop-cart-checkout-secure-rpc-shape.test.js`
  (18 static-structural assertions — SECURITY DEFINER hardening ×5
  functions, no business-authority parameter in any signature, lock
  ordering, idempotency-check-then-identity-check-then-lock ordering,
  stock-check-before-decrement ordering, `'pending'`-only status, RLS on
  the new idempotency table)
- `js/services/shop/shop-ops-repository.js` (+ `.ts` twin) and its test
  (`js/services/shop/__tests__/shop-ops-repository.test.js` — exact RPC
  param names/counts, raw-error passthrough)
- `supabase/functions/_shared/shop-ops-handler.js` (+ `.ts` twin) and its
  test (`supabase/functions/_shared/__tests__/shop-ops-handler.test.js` —
  see requirement mapping below)
- `js/shop/__tests__/shop-api.test.js` (frontend adapter — retryable
  classification, call-shape/business-authority contract, quantity
  clamping, idempotency-key local guard)

Mapping to the task's required scenarios (§7):

**Cart**
1. Owner forgery (`userId`/`user_id`/`ownerId`/`owner_id`) on every one of
   the 5 routes → 400, zero repository calls. ✅ (`shop-ops-handler.test.js`)
2. Forged `price`/`unitPrice`/`subtotal`/`total`/`totalAmount`/`stock`/
   `productName` → 400 allowlist violation (structurally impossible to
   even parse), on every route. ✅
3. Invalid product / disabled product / quantity 0 / negative / non-integer
   / over-limit (100) all rejected. ✅ (`validateCartAddRequestShape`,
   `validateCartUpdateRequestShape`, `add_cart_item`/`update_cart_item_quantity`
   migration-level `IF p_quantity < 1 OR > 99` checks)
4. Cannot modify/delete another user's cart item — `update`/`remove` both
   scope the SAME query by `id AND user_id`; a non-owned id is
   indistinguishable from "not found". ✅
5. Backend failure never falls back to a direct DB write — structurally
   true (the adapter's only write path is `invokeShopOpsFunction`; no
   `.from("shop_cart")` write call exists anywhere in `shop-api.js`
   anymore — confirmed by reading the rewritten file). ✅

**Checkout**
6. Same idempotency key resend → exactly ONE order (stateful fake
   repository, sequential). ✅
7. First DB commit success + lost response, same key resend → identical
   cached order returned. ✅ (same stateful-fake test covers both framings)
8. Stock decremented exactly once across the above. ✅ (migration test:
   stock decrement is inside the per-item loop that only runs on a FRESH
   checkout — the cached-return path never re-enters that loop, statically
   verifiable by the idempotency-lookup-returns-early control flow)
9. Different idempotency keys → two independent checkout intents. ✅
10. Price changed since add-to-cart → checkout uses the CURRENT
    `shop_products.price` (re-read inside the locked-row loop, never the
    cart snapshot). ✅ (migration: `v_unit_price := COALESCE(v_product.price, 0)`
    reads the just-locked `v_product`, not any cart-stored price — `shop_cart`
    has no price column to begin with)
11. Insufficient stock → whole checkout fails, no partial order (single
    transaction, `RAISE EXCEPTION` rolls back everything prior). ✅
    (`handleCheckoutRequest` test + migration ordering test)
12. `orders`/`order_items` never use a request-body-forged owner/price/
    total — structurally true (`checkout_cart` has no such parameters;
    `handleCheckoutRequest`'s allowlist is `["idempotencyKey"]` only). ✅
13. Concurrent checkout cannot make stock negative — the stock check
    (`IF stock < quantity THEN RAISE`) happens INSIDE the same `FOR UPDATE`
    lock as the decrement, serializing concurrent checkouts on the same
    product row. **Caveat:** this is proven only as a STATIC ordering
    assertion in this environment (no live Postgres) — real concurrent-
    transaction behavior requires a 05C staging run (see §9/§11). ✅ (static)
14. Unauthenticated / invalid JWT → fail closed (401, zero repository
    calls) on every route including checkout. ✅
15. Never declares payment success — `status` is always whatever the RPC
    returned (`'pending'`), the handler layer never rewrites it, and the
    migration statically never inserts `'paid'/'completed'/'success'`. ✅

**Regression**

16/17/18. Full `verify-local.ps1` run after all 05B-2B changes:

```
tests 601
suites 0
pass 601
fail 0
cancelled 0
skipped 0
todo 0
```

All prior Wallet/Gacha/Gift (P-AUTH-05B-2A/2A.1) tests, all Wallpaper/AI
generation tests, all Account-Merge (05A/05A.1/05B-1) tests, and all
Subscription-checkout tests remain green — no regression.

---

## 8. Files changed

**New:**
- `supabase/migrations/20260817000400_shop_cart_checkout_secure_rpc.sql`
- `supabase/migrations/__tests__/shop-cart-checkout-secure-rpc-shape.test.js`
- `js/services/shop/shop-ops-repository.js`
- `js/services/shop/__tests__/shop-ops-repository.test.js`
- `supabase/functions/_shared/lib/shop-ops-repository.ts`
- `supabase/functions/_shared/shop-ops-handler.js`
- `supabase/functions/_shared/shop-ops-handler.ts`
- `supabase/functions/_shared/__tests__/shop-ops-handler.test.js`
- `supabase/functions/shop-ops/index.ts`
- `js/shop/__tests__/shop-api.test.js`

**Modified:**
- `js/shop/shop-api.js` — `addToCart`/`updateCartItem`/`removeCartItem`/
  `clearCart` now call `shop-ops` via a new `invokeShopOpsFunction()`
  instead of writing to `shop_cart` directly; added `checkoutCart()`.
  Public function names/signatures on `window.ShopApi` unchanged (only
  `checkoutCart` added); `getProducts`/`getProduct`/`checkProductUnlocked`/
  `getCart` unchanged (read-only, still direct Supabase reads under
  existing owner-read RLS).
- `js/shop/shop_cart.js` — `handleCheckout()` rewritten to call
  `ShopApi.checkoutCart({idempotencyKey})` instead of three direct
  `orders`/`order_items`/`shop_cart` writes; added
  `getOrCreateCheckoutIdempotencyKey()`. Removed now-dead
  `getCheckoutSummary()` (client-side total computation, no longer used
  since totals are server-computed).
- `good.html`, `luck_complete.html`, `orders.html`, `product.html`,
  `shop_cart.html` — bumped `shop-api.js`/`shop_cart.js` cache-busting
  query strings to `?v=20260817-1`.
- `scripts/verify-local.ps1` — added `node --check` lines for the 4 new/
  changed JS files + two new test globs
  (`js/services/shop/__tests__/*.test.js`, `js/shop/__tests__/*.test.js`).

**Untouched (verified, not modified):**
- `20260816000000_core_user_tables_owner_rls.sql` (existing RLS — per
  instruction #4, not touched)
- `js/shop/orders.js`, `js/shop/luck_complete.js` (read-only)
- `js/api.js`, `js/pages/gacha.js`, `js/gift.js` (Wallet/Gacha/Gift —
  regression-verified unchanged and passing)

---

## 9. Remaining / not done

- **Cart-add stock is validated, not reserved** — documented in §3; the
  authoritative check is Checkout's own locked-row re-verification.
- **No live Postgres/Supabase project available in this environment** (same
  limitation as every prior P-AUTH-05B migration in this repo) — all RPC/
  transaction/locking claims are verified by STATIC SQL-text structural
  tests only, never executed against a real database. Real concurrent-
  transaction behavior (item 13, and the `FOR UPDATE` row-lock semantics
  generally) requires an actual 05C Staging Gate run.
- **`order_no` generation** is unchanged/unaddressed — the new `orders`
  insert (like the old one) does not set `order_no` explicitly, relying on
  whatever existing DB default/trigger currently populates it (not
  reverse-engineered from a migration, since `orders` itself was never
  defined by a migration in this repo).
- Cart `add`/`update`/`remove`/`clear` do not have their own idempotency
  keys (explicit scope decision, §5) — if a future task adds client-side
  automatic retry logic for these four operations, that decision should be
  revisited.
- No UI-visible change to the Checkout success page/flow beyond using the
  new `order_id` field name from the RPC's `jsonb` result (previously
  `order.id` from a raw insert `.select()`) — `luck_complete.html`'s own
  `js/shop/luck_complete.js` reads `orders`/`order_items` by `order_id`
  query param unchanged, so no further edit was needed there.

---

## 10. Migration & deployment status

- **Migration:** `20260817000400_shop_cart_checkout_secure_rpc.sql` is a
  NEW file, authored only — **NOT applied** to any Supabase project (no
  `supabase db push` / `supabase migration up` run). It does not modify
  any existing table, column, policy, or migration file.
- **Deployment:** `supabase/functions/shop-ops/index.ts` is a NEW Edge
  Function, implemented only — **NOT deployed** (no `supabase functions
  deploy` run). No production system was touched.
- **Rollback (if ever partially applied):** see the migration file's own
  header comment for the exact `REVOKE`/`DROP FUNCTION`/`DROP TABLE`
  sequence (additive-only change, fully reversible, no existing row/
  column/policy is affected).

---

## 11. Gate conclusion

**PARTIAL.**

Rationale: all in-scope code (RPCs, Edge Function, repository, handler,
frontend adapters) is implemented, ownership/business-authority is
structurally enforced (not just re-validated), idempotency and retry-
safety mirror the already-hardened 05B-2A/2A.1 wallet-ops pattern exactly,
and all 601 automated tests (including full Wallet/Gacha/Gift regression)
pass. It is marked PARTIAL rather than PASS strictly because — consistent
with every prior P-AUTH-05B gate in this repo — none of this has been
verified against a real running Postgres/Supabase project: the
transaction/locking/concurrency claims (especially requirement 13, no
negative stock under real concurrent checkouts) are proven only as static
SQL-text assertions, not executed behavior. A 05C Staging Gate run (real
Deno + real Postgres + two real concurrent checkout requests against a
staging project) is required before this can be called PASS.

No deployment performed. Not proceeding to 05C per instructions.
