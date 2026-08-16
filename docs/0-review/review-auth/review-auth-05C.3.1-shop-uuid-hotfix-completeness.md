# review-auth-05C.3.1-shop-uuid-hotfix-completeness.md — Shop UUID Hotfix Completeness Review

**Task:** P-AUTH-05C.3.1 Shop UUID Hotfix Completeness Review.
**Scope:** local, read-only-plus-tests review of the NOT-YET-APPLIED
`20260817000900_shop_uuid_type_hotfix.sql` (from P-AUTH-05C.3). **No
`db push`, no deploy, no production data operation, no modification of
any already-applied migration.**

---

## 一、遺漏是否成立 (does the described gap exist?)

**NO — the gap does not exist in `20260817000900_shop_uuid_type_hotfix.sql`.**

The prompt asked to check whether `checkout_cart` writes
`shop_checkout_requests.order_id` (a real `TEXT` column) via a bare,
uncast assignment like:

```sql
UPDATE shop_checkout_requests SET order_id = v_order.id
```

Re-reading the current (unapplied) `checkout_cart` body in
`20260817000900_shop_uuid_type_hotfix.sql` line-by-line confirms this
was **already handled correctly**:

```sql
UPDATE public.shop_checkout_requests
   SET status = 'completed',
       order_id = v_order.id::text
 WHERE idempotency_key = p_idempotency_key;
```

and the cached-result lookup already compares compatibly (casts the
trusted `uuid` column to `text`, never the untrusted claim value to
`uuid`):

```sql
WHERE o.id::text = v_claim.order_id
```

Tracing this back: `checkout_cart`'s entire body in `20260817000900` was
carried over UNCHANGED from `20260817000500_shop_checkout_atomic_claim_fix.sql`
(the 05B-2B.1 idempotency hotfix) except for the one deliberate
`(elem->>'product_id')::uuid` cast added for the `order_items` fix (see
`review-auth-05C.3-shop-uuid-hotfix-preflight.md`). `20260817000500`
itself already used `order_id = v_order.id::text` and
`o.id::text = v_claim.order_id` from the moment it was written —
confirmed by re-reading that already-applied file directly. So this
correct handling has been in place since 05B-2B.1, predating the 05C.3
uuid hotfix entirely; it was never broken.

---

## 二、修正位置 (fix locations)

**None required.** No SQL text in `20260817000900_shop_uuid_type_hotfix.sql`
was changed by this task — the described gap was checked and found not
to exist. Only a NEW set of structural tests was added (see §四) to lock
this correctness in place permanently as a regression guard, since
nothing previously asserted on this specific boundary explicitly.

---

## 三、完整來源→目標型別表 (full source-type -> target-type audit)

| # | Source | Target | Direction | Handling |
|---|---|---|---|---|
| 1 | `p_product_id` (TEXT param) | `shop_cart.product_id` (uuid) | write | Explicit-safe: uses `v_product.id` (already-typed uuid from an earlier successful lookup), never re-casts `p_product_id` (see 05C.3 doc) |
| 2 | jsonb `product_id` (text, `elem->>'product_id'`) | `order_items.product_id` (uuid) | write | Explicit cast: `(elem->>'product_id')::uuid` — provably safe, value originated from `v_product.id` earlier in the same call |
| 3 | `v_order.id` (uuid) | `order_items.order_id` (uuid) | write | Native, no cast needed — uuid -> uuid |
| 4 | `v_order.id` (uuid) | `shop_checkout_requests.order_id` (TEXT) | write | **Explicit cast: `v_order.id::text`** (this task's focus — confirmed present) |
| 5 | `p_user_id` (TEXT) | `orders.user_id` (TEXT) | write | Native, no cast needed |
| 6 | `p_user_id` (TEXT) | `shop_checkout_requests.user_id` (TEXT) | write | Native, no cast needed |
| 7 | `shop_cart.id` (uuid) vs. `p_cart_id` (TEXT param, `update_cart_item_quantity`/`remove_cart_item`) | — | compare | `id::text = p_cart_id` — casts the trusted uuid column to text; never casts the caller's raw string to uuid. Unchanged, in `20260817000400`, untouched by this hotfix |
| 8 | `orders.id` (uuid) vs. `v_claim.order_id` (TEXT, from `shop_checkout_requests`) | — | compare (cached lookup) | **`o.id::text = v_claim.order_id`** — casts the trusted uuid column to text; never casts the claim's TEXT value to uuid. Confirmed present, see §一 |

Every write/compare across the two functions touched by
`20260817000900` (`add_cart_item`, `checkout_cart`) is accounted for
above; rows 7 is in the two untouched functions
(`update_cart_item_quantity`/`remove_cart_item`, from `20260817000400`,
confirmed still correct and unmodified) included for completeness since
it is part of the same cart-id UUID/TEXT boundary class.

---

## 四、Checkout Idempotency 型別流程 (type-safety through the full lifecycle)

1. **Fresh claim, `order_id` NULL:** `INSERT INTO shop_checkout_requests
   (idempotency_key, user_id, order_id, status) VALUES (p_idempotency_key,
   p_user_id, NULL, 'processing') ON CONFLICT (idempotency_key) DO
   NOTHING` — `order_id` is nullable (per the `20260817000500` `ALTER
   COLUMN order_id DROP NOT NULL`, already applied), so no type coercion
   is needed or attempted for the NULL case. ✅
2. **Completion writes a TEXT value:** `UPDATE ... SET status =
   'completed', order_id = v_order.id::text WHERE idempotency_key =
   p_idempotency_key` — explicit, safe uuid->text cast (uuid can always
   be represented as text; this direction can never fail). ✅
3. **Same-key resend finds the order via a compatible comparison:**
   `WHERE o.id::text = v_claim.order_id` — casts the *trusted* `orders.id`
   uuid to text and compares against the stored text value; never parses
   the stored text back into a uuid, so no invalid-UUID exception is
   possible on this path even in a hypothetical data-corruption scenario. ✅
4. **Cross-user protection unaffected:** `IF v_claim.user_id <> p_user_id
   THEN RAISE EXCEPTION ...` runs BEFORE the `status = 'completed'`
   branch is reached — a different UID's request for the same
   idempotency key is rejected before any order data (theirs or anyone
   else's) is ever read. Unchanged by this review. ✅
5. **Completed results are never overwritten by a later empty-cart path:**
   the `IF v_claim.status = 'completed' THEN ... RETURN v_cached_result;
   END IF;` branch structurally executes and `RETURN`s BEFORE the
   `cart is empty` check (`SELECT EXISTS (...) INTO v_has_cart_rows`) —
   confirmed still true via the existing ordering test (§四 hotfix test
   suite, `claim-then-lock idempotency ordering is UNCHANGED`). Since the
   real cart was already `DELETE`d on the first successful completion, a
   resend's cart being empty is expected and irrelevant — the completed
   branch never lets execution reach that check. ✅
6. **No dangling `processing` row on a type error:** because this is all
   a single `SECURITY DEFINER` PL/pgSQL function body, ANY exception
   raised anywhere after the claim INSERT (including a hypothetical cast
   failure) rolls back the ENTIRE transaction — the claim INSERT itself
   is rolled back too (it is not a separate, already-committed
   transaction), so no orphaned `'processing'` row can survive a mid-flight
   failure. This is standard Postgres function-transaction semantics, not
   something this task needed to add. ✅

No unresolved concern in the idempotency lifecycle.

---

## 五、測試結果 (test results)

Extended `supabase/migrations/__tests__/shop-uuid-type-hotfix-shape.test.js`
with 6 new tests specific to this review:

1. `shop_checkout_requests.order_id` completion write is exactly
   `v_order.id::text` (not a bare/uncast assignment).
2. No bare, uncast `order_id = v_order.id` appears anywhere in
   `checkout_cart`.
3. The fresh idempotency claim allows `order_id` to start `NULL`.
4. Cached-result lookup compares `o.id::text = v_claim.order_id` and
   never casts `v_claim.order_id` to `uuid` (nor uses a bare, type-unsafe
   `o.id = v_claim.order_id`).
5. `order_items.order_id` is populated from `v_order.id` with NO cast
   (uuid -> uuid native match) — distinct from and correctly NOT
   confused with the uuid->text boundary above.
6. `p_user_id` -> `orders.user_id` / `p_user_id` ->
   `shop_checkout_requests.user_id` are both native TEXT->TEXT writes.

All 6 pass. Full local suite:

```
.\scripts\verify-local.ps1
tests 655
pass 655
fail 0
```

(649 prior + 6 new, all green — 634 pre-05C.3 baseline + 15 (05C.3) + 6
(this review) = 655.)

---

## 六、是否修改 00900 (was `20260817000900` modified?)

**NO.** No SQL statement in `20260817000900_shop_uuid_type_hotfix.sql`
was changed. Only the test file
`supabase/migrations/__tests__/shop-uuid-type-hotfix-shape.test.js` was
extended.

---

## 七、是否執行 db push (was `db push` executed?)

**NO.**

---

## Gate 結論

**SAFE_TO_APPLY_UUID_HOTFIX**

The gap described in the task prompt does not exist in the current
(unapplied) `20260817000900_shop_uuid_type_hotfix.sql` — the
`orders.id` (uuid) <-> `shop_checkout_requests.order_id` (text)
boundary was already handled with an explicit, correct cast at every
write/compare site, inherited unchanged from the already-applied
`20260817000500`. This review adds 6 new regression tests that lock
that correctness in place going forward. No SQL change was needed or
made. This gate confirms the prior `SAFE_TO_APPLY_UUID_HOTFIX`
conclusion from `review-auth-05C.3-shop-uuid-hotfix-preflight.md` stands,
now with this additional boundary explicitly verified and tested.

---

**完成後停止。本任務未執行 `db push`、未部署、未執行 production smoke
test。**

> **Follow-up:** this migration was subsequently APPLIED to production in
> [review-auth-05C.4-production-shop-uuid-hotfix.md](review-auth-05C.4-production-shop-uuid-hotfix.md),
> verified via a rollback-only SQL checkout smoke test (Cart HTTP smoke
> was blocked for an environmental reason — see that doc for details).
