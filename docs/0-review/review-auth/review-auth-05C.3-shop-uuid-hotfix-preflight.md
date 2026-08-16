# review-auth-05C.3-shop-uuid-hotfix-preflight.md — Shop UUID Type Hotfix Preparation

**Task:** P-AUTH-05C.3 Shop UUID Type Hotfix Preparation.
**Scope:** local preparation ONLY — **no `db push`, no deploy, no
production checkout, no data deletion.** Everything below was produced
and verified locally; nothing was applied to `umtqpstacjdwxcvcirbl`.
**Trigger:** the `42804: column "product_id" is of type uuid but
expression is of type text` failure hit live during the P-AUTH-05C.2
Cart smoke test (see
[review-auth-05C.2-production-cart-recovery.md](review-auth-05C.2-production-cart-recovery.md)).

> **Follow-up:** a completeness review of the `orders.id`(uuid) <->
> `shop_checkout_requests.order_id`(text) boundary was performed in
> [review-auth-05C.3.1-shop-uuid-hotfix-completeness.md](review-auth-05C.3.1-shop-uuid-hotfix-completeness.md)
> — confirmed already correctly handled (no gap found), 6 additional
> regression tests added, Gate `SAFE_TO_APPLY_UUID_HOTFIX` reconfirmed.
>
> **Further follow-up:** this migration was subsequently APPLIED to
> production in
> [review-auth-05C.4-production-shop-uuid-hotfix.md](review-auth-05C.4-production-shop-uuid-hotfix.md)
> and verified correct via a rollback-only SQL checkout smoke test.

---

## 一、Checkpoint

- Git state recorded before any edit: commit `18986a6`, working tree had
  uncommitted changes from 05C.1/05C.2 (cors.ts/js, wallet-ops/index.ts,
  shop-ops implementation + tests) — none of those files were touched by
  this task.
- No already-applied migration was edited. Only one new file was added:
  `supabase/migrations/20260817000900_shop_uuid_type_hotfix.sql`.
- `20260817000400_shop_cart_checkout_secure_rpc.sql` and
  `20260817000500_shop_checkout_atomic_claim_fix.sql` are untouched
  (verified by a structural test — see §五).
- No refactor of `shop-ops`, its repository/handler, or any frontend file.

---

## 二、根因 (Root Cause)

`add_cart_item(p_user_id TEXT, p_product_id TEXT, p_quantity INTEGER)`
was originally written assuming `shop_cart.product_id` and
`shop_products.id` were `TEXT`. A live, read-only
`information_schema.columns` query against `umtqpstacjdwxcvcirbl`
confirmed they are actually `uuid`. The original INSERT wrote the raw
`p_product_id` (TEXT parameter) directly into the `uuid` column, causing
Postgres error `42804` on every real add-to-cart call. The same
TEXT-assumed-instead-of-uuid bug class was also present, unfixed, in
`checkout_cart`'s `order_items.product_id` INSERT (would have failed the
first time an order was actually placed, not yet exercised live because
the Cart smoke test failed first).

A second, independent issue was found during the RPC audit (§ Task
instruction Part 四): `add_cart_item` locked `shop_products` before
`shop_cart`, while `checkout_cart` locks `shop_cart` before
`shop_products` — an inverted lock order between two RPCs that can both
run concurrently for the same user, a classic ingredient for a Postgres
deadlock (`40P01`) under concurrent add + checkout traffic.

---

## 三、Production 型別矩陣 (confirmed live, read-only)

| Table | Column | Type |
|---|---|---|
| `shop_products` | `id` | `uuid` |
| `shop_products` | `price` | `integer` |
| `shop_products` | `stock` | `integer` |
| `shop_products` | `required_mascot_id` | `text` |
| `shop_cart` | `id` | `uuid` |
| `shop_cart` | `user_id` | `text` |
| `shop_cart` | `product_id` | **`uuid`** (originally assumed `text`) |
| `orders` | `id` | `uuid` |
| `orders` | `user_id` | `text` |
| `order_items` | `id` | `uuid` |
| `order_items` | `order_id` | `uuid` |
| `order_items` | `product_id` | **`uuid`** (originally assumed `text`) |
| `shop_checkout_requests` | `idempotency_key` | `text` |
| `shop_checkout_requests` | `user_id` | `text` |
| `shop_checkout_requests` | `order_id` | `text` |

Also confirmed: `shop_cart` has an existing
`shop_cart_user_id_product_id_key UNIQUE (user_id, product_id)`
constraint — this enabled the safe lock-order fix in §四 below.

### RPC audit result (all 5 cart/checkout RPCs)

| RPC | Bug found? |
|---|---|
| `add_cart_item` | ✅ yes — `product_id` uuid/text mismatch on fresh INSERT; lock-order inversion |
| `update_cart_item_quantity` | no — only ever compares `column::text = p_param`, never inserts into a uuid column |
| `remove_cart_item` | no — same as above |
| `clear_cart` | no — no uuid columns touched |
| `checkout_cart` | ✅ yes — `order_items.product_id` uuid/text mismatch on INSERT |

---

## 四、新 Migration 內容摘要

New file:
`supabase/migrations/20260817000900_shop_uuid_type_hotfix.sql`

Uses `CREATE OR REPLACE FUNCTION` to supersede `add_cart_item` and
`checkout_cart` (same public signatures — no overload, no repository
call-site change needed). Does not touch
`update_cart_item_quantity`/`remove_cart_item`/`clear_cart` (audited, no
bug).

### 每個修正的 cast 位置

1. **`add_cart_item`**, fresh-INSERT branch: INSERT now uses `v_product.id`
   (the native `uuid` already fetched/locked by the earlier
   `shop_products` lookup) instead of re-casting the raw `p_product_id`
   TEXT parameter. No `::uuid` cast of caller input is needed here
   because `v_product.id` is provably a valid, existing uuid by the time
   this line runs (the lookup already succeeded, i.e. `FOUND`).
2. **`checkout_cart`**, `order_items` INSERT: `(elem->>'product_id')::uuid`
   replaces the previous bare `elem->>'product_id'` text extraction.
   Safe because that jsonb value was itself populated (earlier in the
   *same* function call) from `v_product.id`, a real uuid — never from
   raw caller input, so this cast can never fail on malformed input.
3. `order_items.order_id` continues to be written from `v_order.id`
   (native uuid) — unchanged, was already correct.
4. `user_id` columns are untouched TEXT everywhere in both functions —
   confirmed no `::uuid` cast was introduced on any `user_id`/`p_user_id`
   reference.

### 無效 UUID 處理 (requirement 8)

No caller-supplied string is ever cast directly to `uuid` in either
function. All `WHERE ... = p_product_id` / `WHERE ... = p_user_id`
comparisons use `column::text = p_param` (casting the *column* to text,
not the parameter to uuid), so a malformed "UUID" string simply yields
zero matching rows (`NOT FOUND`) and surfaces as the existing, already
non-retryable `PRODUCT_NOT_FOUND` / `CART_ITEM_NOT_FOUND` business
error — never a raw Postgres `invalid input syntax for type uuid`
error. The only two `::uuid` casts added are on values *proven* to
already be valid uuids by construction within the same function call
(see cast positions 1–2 above), so they cannot raise either.

The one new exception this migration introduces —
`'add_cart_item: concurrent add detected for product %, please retry'`
(§ four) — is a plain message, unrecognized by the existing
`classifyCartAddFailureReason` regexes, and therefore already falls
through to the existing `retryable: true` generic-failure default with
no handler change required.

---

## 五、Lock-order 處理結果

**Resolved (not deferred).** `add_cart_item` now locks `shop_cart` (its
own existing row for this `user_id`+`product_id`, a no-op lock if zero
rows exist yet) **before** locking `shop_products` — matching
`checkout_cart`'s existing `shop_cart` → `shop_products` order. This
closes the inversion.

Concurrency safety for the "brand-new cart row" path (where the
`shop_cart` lock is a no-op because no row exists yet, so two concurrent
first-time `add_cart_item` calls for the same `user_id`+`product_id`
could both reach the INSERT) is handled by:

- `shop_cart`'s pre-existing `UNIQUE (user_id, product_id)` constraint
  (`shop_cart_user_id_product_id_key`, confirmed live) — the DB itself
  prevents a duplicate row.
- The INSERT is wrapped in `EXCEPTION WHEN unique_violation THEN RAISE
  EXCEPTION 'add_cart_item: concurrent add detected for product %,
  please retry'` — turning the raw constraint violation into a plain,
  classifiable message rather than leaking a raw Postgres error. As
  noted above, it safely defaults to `retryable: true`, so a client
  retry lands on the `UPDATE` (quantity-merge) branch and succeeds.

No blocker remains for this hotfix on the lock-ordering question.

---

## 六、測試結果

New file:
`supabase/migrations/__tests__/shop-uuid-type-hotfix-shape.test.js` — 15
static structural tests covering all 10 required scenarios from the task
prompt (UUID conversion at both INSERT sites, `user_id` remaining TEXT,
lock-order fix, `SECURITY DEFINER`/grant-revoke preserved, no
business-authority parameter added, idempotency ordering unchanged,
`order_no`/RLS untouched, and that the two already-applied migrations
were not modified).

Full local suite:

```
.\scripts\verify-local.ps1
tests 649
pass 649
fail 0
```

(634 pre-existing + 15 new, all green.) Requirements 4–7 from the task's
test list (invalid id non-retryable, owner-forgery rejection,
price/stock not caller-controlled, idempotency-key single-order
guarantee) are unaffected by this migration and remain covered by the
existing `shop-ops-handler` test suite, which continues to pass
unchanged.

---

## 七、預計 db push 影響

If/when applied (NOT done in this task): `supabase db push` would apply
exactly one new migration,
`20260817000900_shop_uuid_type_hotfix.sql`, which runs two
`CREATE OR REPLACE FUNCTION` statements plus their `REVOKE`/`GRANT`
statements. No table/column/index/RLS DDL. No data migration/backfill
needed (no existing rows are affected — the bug only ever prevented
writes from succeeding, so no `shop_cart`/`order_items` row currently
contains bad data). Expected to be a fast, low-risk, DDL-only apply with
no lock contention beyond the brief `ACCESS EXCLUSIVE` a
`CREATE OR REPLACE FUNCTION` normally takes on the function definition
itself (not on the tables).

---

## 八、Rollback 方案

Because this migration only replaces function bodies (same signatures),
rollback is a follow-up migration that `CREATE OR REPLACE FUNCTION`s
`add_cart_item`/`checkout_cart` back to the `20260817000500`-era bodies
(the last known-applied state), OR — if `shop-ops` has already been
exercised successfully after this hotfix — simply leave it in place,
since the fix is strictly additive-correct (no behavior removed, only a
previously-impossible-to-succeed write path fixed). No data rollback is
needed under any scenario: the bug always failed the write cleanly
before any row was persisted, so there is nothing to undo in
`shop_cart`/`orders`/`order_items`.

---

## 九、Production 驗證計畫（僅規劃，本階段不得執行）

### A. Cart HTTP smoke

1. Use the existing test account (`5a706db8-3814-4687-a36a-0d9cd9ebb940`).
2. Call `cart-add` once via the deployed `shop-ops` endpoint.
3. Read-only verify: exactly one new `shop_cart` row exists for that
   account+product (no other account/row affected).
4. Call `cart-remove` for that same row.
5. Read-only verify: `shop_cart` count for that account is back to its
   pre-test value (0, per the 05C.2 baseline).

### B. Checkout rollback-only SQL smoke（只能規劃，不得本階段執行）

A transaction-wrapped SQL session, run only in a future,
explicitly-authorized task, that can never persist to production:

```sql
BEGIN;
-- (create/reuse a test cart row for the test account)
SELECT public.checkout_cart('<test_user_id>', '<throwaway_idempotency_key>');
-- verify: one new `orders` row, matching `order_items` row(s),
-- `shop_products.stock` decremented correctly, `order_no` populated by
-- the existing trigger, `shop_checkout_requests` row status='completed'
ROLLBACK;
```

`ROLLBACK` guarantees zero persisted change regardless of outcome. **不得
透過 HTTP 建立持久化 production 訂單** — Stage B must only ever be run as
a direct, rollback-wrapped SQL session, never via the `shop-ops` HTTP
endpoint (which has no rollback capability from the caller's side).

---

## Gate 結論

**SAFE_TO_APPLY_UUID_HOTFIX**

Both bugs (uuid/text mismatch, lock-order inversion) have clean,
low-risk fixes fully contained in one new, non-destructive
`CREATE OR REPLACE FUNCTION` migration. No blocker remains. No schema
change. No RLS change. No business-authority weakening. All 649 local
tests pass. This gate authorizes only the *preparation* being complete
and reviewed — it does **not** itself authorize `db push`, deploy, or
any production verification step; those each require their own explicit
future authorization per the task's stop condition below.

---

**完成後停止。本任務未執行 `db push`、未部署、未呼叫 production
checkout、未刪除任何資料。**
