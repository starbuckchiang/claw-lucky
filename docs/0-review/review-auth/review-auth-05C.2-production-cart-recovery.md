# review-auth-05C.2-production-cart-recovery.md — shop-ops Production Deployment

**Task:** P-AUTH-05C.2 Production Cart Recovery (explicitly authorized by
the user for `umtqpstacjdwxcvcirbl`, scoped to deploying `shop-ops` only).
**Date:** 2026-08-16/17 (repo session date)
**Authorization scope:** deploy `shop-ops` Edge Function to
`umtqpstacjdwxcvcirbl` ONLY. No `db push`, no migration changes, no other
Edge Function deploy, no RLS change, no data deletion, no real order/
checkout — all honored (see below).

> **Follow-up:** the `42804` uuid/text bug found live in this task's Cart
> smoke test (§三) was root-caused and a local-only hotfix prepared in
> [review-auth-05C.3-shop-uuid-hotfix-preflight.md](review-auth-05C.3-shop-uuid-hotfix-preflight.md)
> (Gate: `SAFE_TO_APPLY_UUID_HOTFIX`, not yet applied/deployed).

---

## 一、部署前最後確認 (pre-deploy confirmation — all PASS)

| Check | Result |
|---|---|
| Linked project ref | `umtqpstacjdwxcvcirbl` (read from `supabase/.temp/project-ref`) ✅ |
| `git diff` scope | Only contains the 05C/05C.1-reviewed changes: `cors.ts`/`cors.js` (new)/`wallet-ops/index.ts` (req passthrough), the 3 already-applied migration bugfixes (`20260816000100`/`20260817000000`/`20260817000100`), shop-ops implementation files, shop-cart migrations, and their tests. No unreviewed change present. ✅ |
| `supabase migration list` | 20 migrations, local timestamp == remote timestamp for every one — **no new pending migration** ✅ |
| `supabase functions list` (before deploy) | Only `wallpaper-generate`/`wallpaper-status`/`wallet-ops` exist — **`shop-ops` confirmed NOT present** ✅ |
| `.\scripts\verify-local.ps1` | **634/634 passing** ✅ |

All 5 checks passed — proceeded to deploy.

---

## 二、唯一允許的部署命令 (executed exactly once, no other flags)

```
supabase functions deploy shop-ops
```

Output:
```
Uploading asset (shop-ops): supabase/functions/shop-ops/index.ts
Uploading asset (shop-ops): supabase/functions/_shared/lib/shop-ops-repository.ts
Uploading asset (shop-ops): supabase/functions/_shared/shop-ops-handler.ts
Uploading asset (shop-ops): supabase/functions/_shared/supabase-clients.ts
Uploading asset (shop-ops): supabase/functions/_shared/cors.ts
{"project_ref":"umtqpstacjdwxcvcirbl","functions":["shop-ops"],"message":"Deployed Functions."}
```

Exactly the 5 files predicted in `review-auth-05C-1-production-cart-recovery-preflight.md`. No
`--no-verify-jwt` flag used. No other `deploy`/`db` command was run at
any point in this task.

---

## 三、部署後唯讀／無訂單驗證

### 1. `supabase functions list`

`shop-ops`: **`status: "ACTIVE"`, `version: 1`, `verify_jwt: true`** — all
three exactly as required.

### 2. OPTIONS from `http://localhost:5588`

```
curl -X OPTIONS https://umtqpstacjdwxcvcirbl.supabase.co/functions/v1/shop-ops/cart-add -H "Origin: http://localhost:5588"
```
→ **`HTTP/1.1 200 OK`**, **`Access-Control-Allow-Origin: http://localhost:5588`** (exact match).

### 3. POST with no `Authorization` header

```
curl -X POST .../shop-ops/cart-add -H "Origin: http://localhost:5588" -d '{"productId":"x"}'
```
→ **`401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}`**
(gateway-level rejection, before any function code runs — confirmed **no
data written**, matches `wallet-ops`'s identical, already-verified
behavior).

### 4. Disallowed Origin (`https://evil.example.com`)

```
curl -X OPTIONS .../shop-ops/cart-add -H "Origin: https://evil.example.com"
```
→ `HTTP/1.1 200 OK`, **`Access-Control-Allow-Origin` header ABSENT** (not
present anywhere in the response headers — confirmed by full header
dump). JWT/ownership enforcement is unaffected either way (separate,
unchanged mechanism inside every handler).

**All four §三 checks PASS.**

---

## 四、受控 Cart Smoke Test — **BLOCKED (real bug found)**

**Test account used:** `5a706db8-3814-4687-a36a-0d9cd9ebb940` — the SAME
anonymous test session already established and documented in
`review-auth-05C-wallet-ops-cors-hotfix.md` for the prior `wallet-ops`
live verification (created purely for this task chain's own testing;
never a real end user). This is treated as the "已標記的測試帳號" per
instruction.

**Pre-test state (read-only):** `shop_cart` row count for this account =
**0**.

**Action:** navigated the shared browser session to
`product.html?id=30f782ec-0227-491f-aeda-9a48e782da09` ("吉祥物徽章", a
real enabled product) and clicked "加入購物車" — this calls the REAL,
now-deployed `shop-ops/cart-add` endpoint with the account's real JWT.

**Result: FAILED with HTTP 502** (`"加入好運籃失敗，請稍後再試一次。"` shown
to the user). This is a genuine bug, NOT the expected/acceptable
`403 MASCOT_NOT_UNLOCKED` business rejection this product's mascot-gate
would normally produce.

**Root cause (diagnosed via a single read-only-style RPC call,
`SELECT * FROM public.add_cart_item(...)`, mirroring the diagnostic method
already established in the 05C wallet-ops hotfix task):**

```
ERROR: 42804: column "product_id" is of type uuid but expression is of type text
HINT: You will need to rewrite or cast the expression.
QUERY: INSERT INTO public.shop_cart (user_id, product_id, quantity, selected, unlock_verified, created_at, updated_at)
       VALUES (p_user_id, p_product_id, p_quantity, true, true, NOW(), NOW()) RETURNING *
CONTEXT: PL/pgSQL function add_cart_item(text,text,integer) line 70
```

**This is the SAME class of bug** already fixed once this session for
`point_transactions`/`ticket_transactions`/`coin_transactions` (text
param inserted into a column that is actually `uuid`, not `text`) —
`add_cart_item`'s migration (`20260817000400_shop_cart_checkout_secure_rpc.sql`)
assumed `shop_cart.product_id`/`shop_products.id` were `TEXT` (consistent
with `shop_cart.user_id` being `TEXT`, which it genuinely is), but never
verified this against the real schema (no live Postgres access existed
when that migration was authored).

**Scope confirmed via read-only `information_schema.columns`:**

| table | column | real type |
|---|---|---|
| `shop_cart` | `id` | uuid |
| `shop_cart` | `product_id` | **uuid** (assumed `text`) |
| `shop_cart` | `user_id` | text (correctly assumed) |
| `shop_products` | `id` | uuid |
| `order_items` | `id` | uuid |
| `order_items` | `order_id` | uuid |
| `order_items` | `product_id` | **uuid** (assumed `text`) |

This means:
- `add_cart_item`'s fresh-INSERT path is **broken for every product**
  (not product-specific) — confirmed structurally, not just for this one
  test.
- `checkout_cart`'s `INSERT INTO order_items (...)` (which extracts
  `product_id` as text from a `jsonb` array via `elem->>'product_id'`)
  would **likely fail the same way** — NOT tested (checkout is explicitly
  prohibited in this task), but flagged as a near-certain sibling bug
  requiring the same class of fix.
- `update_cart_item_quantity`/`remove_cart_item`/`clear_cart` only ever
  compare via `column::text = p_param` (cast on both sides) in their
  `WHERE` clauses — these do NOT insert anything and are **not** expected
  to be affected by this specific bug, but were **not exercised** in this
  smoke test (no existing cart row existed to update/remove, since the
  only add attempt failed) — genuinely UNTESTED, not confirmed either
  way.

**Post-failure state (read-only, confirms NO data pollution):**
`shop_cart` row count for the test account = **0** (unchanged from
before — the failed `INSERT` rolled back cleanly, exactly as Postgres
guarantees for a statement-level error inside a function; no orphaned or
partial row exists).

**Per instruction §四's explicit stop condition** ("若沒有可安全辨識的測試
帳號或商品：跳過寫入 smoke test") — this does not literally apply (a valid
test account and product WERE available), but the equivalent principle
applies once a genuine blocking bug was found: **the smoke test is
stopped here.** No further product was tried (the bug is structural/
column-type-level, not product-specific, so retrying with a different
product would only reproduce the identical failure). No migration/schema
fix was attempted (explicitly out of scope for 05C.2).

---

## Production 資料前後差異

| Table | Before this task | After this task |
|---|---|---|
| `shop_cart` (test account) | 0 rows | 0 rows (unchanged) |
| Any other table | Unchanged | Unchanged |

**No row was inserted, updated, or deleted in production by this task.**
The only production-visible change from this task is the NEW `shop-ops`
Edge Function itself (a deployment artifact, not a data change).

---

## 是否建立 order（必須為 NO）

**NO.** No `orders`/`order_items` row was created. `checkout_cart` /
`/functions/v1/shop-ops/checkout` was never called at any point in this
task.

## 是否執行 db push（必須為 NO）

**NO.** No `supabase db push` (or any other migration-applying command)
was run in this task. Migration count remains 20, identical to the
pre-task state confirmed in §一.

---

## Rollback 建議

**Deletion of `shop-ops` is NOT recommended at this time.** Per
instruction §五 ("只有在 function 本身造成明確新故障時，才提出
`delete`"): the 502 found in §四 is a pre-existing bug in the ALREADY-
APPLIED migration `20260817000400` (authored before any live-Postgres
verification was possible in this repo) — deploying `shop-ops` did not
CREATE this bug, it merely made it reachable via a real HTTP call for the
first time. Deleting the function would:
- Remove the parts that DO work correctly (CORS allowlist, JWT
  enforcement, 401-on-no-auth, and likely `update_cart_item_quantity`/
  `remove_cart_item`/`clear_cart` for any EXISTING cart row — untested
  but structurally sound, using safe `::text`-cast comparisons only).
- Not fix anything (the underlying bug lives in the database function,
  not in the Edge Function code) — re-deploying later would hit the exact
  same error again regardless.

**Recommended path instead (a separate, properly-scoped future task, NOT
executed here):** author a new migration (mirroring the exact "type-cast
fix via a superseding `CREATE OR REPLACE FUNCTION`" pattern already used
3 times this session for the gacha/gift/ledger bugs) that:
1. Casts `p_product_id::uuid`/`v_cart_row.product_id::uuid` (or the
   `%TYPE`-based PL/pgSQL-variable technique used for the point/ticket/
   coin ledger fix) wherever `product_id` is inserted into `shop_cart`/
   `order_items`.
2. Re-verifies (via the same `information_schema.columns` read-only
   method used here) whether ANY other assumed-`TEXT` column in the
   shop-ops migrations is actually a different real type, before writing
   the fix, rather than assuming only the one column found here is
   affected.
3. Re-runs this EXACT smoke test (cart-add → verify → remove → verify
   restored) end-to-end successfully before declaring Cart recovered.

If, in the future, a genuinely NEW failure is caused specifically BY the
`shop-ops` Edge Function code itself (not by an underlying RPC bug), THAT
would be the trigger for proposing `supabase functions delete shop-ops` —
not the case found here.

---

## Gate 結論

**FUNCTION_DEPLOYED_SMOKE_BLOCKED**

Rationale: `shop-ops` was deployed successfully to the correct,
explicitly-authorized production project, using the single authorized
command with default `verify_jwt`. Every CORS/authentication check
(OPTIONS from an allowed origin, no-JWT rejection, disallowed-origin
header omission) passed exactly as required. However, the controlled Cart
smoke test uncovered a genuine, pre-existing bug in the underlying
`add_cart_item` database function (a `text`/`uuid` column type mismatch,
the same class of bug already fixed 3 times elsewhere this session) that
prevents adding ANY product to the cart. No data was written, updated, or
lost during this discovery (the failed `INSERT` rolled back cleanly,
confirmed via a before/after row count on the test account). Cart/
Checkout therefore remains **not yet fully functional** in production —
the CORS/deployment layer is now correct, but a follow-up migration hotfix
(scoped, reviewed, and explicitly authorized separately — NOT this task)
is required before Cart can be declared recovered.

No `db push`, migration change, other Edge Function deploy, RLS change,
data deletion, real order, or checkout was performed. Stopped per
instruction — not proceeding to checkout, not starting the Gacha/Gift
concurrency hotfix.
