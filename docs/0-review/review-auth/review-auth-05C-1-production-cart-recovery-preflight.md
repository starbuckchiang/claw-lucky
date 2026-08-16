# review-auth-05C-1-production-cart-recovery-preflight.md — shop-ops Production Recovery Preflight

> **FOLLOW-UP: P-AUTH-05C.2** (`review-auth-05C.2-production-cart-recovery.md`)
> deployed `shop-ops` per this doc's `SAFE_TO_DEPLOY_SHOP_OPS` conclusion —
> CORS/JWT/`order_no` findings here all held up correctly live. However,
> the live Cart smoke test (out of scope for this read-only-only preflight)
> found a NEW, separate bug: `add_cart_item` inserts a bare TEXT
> `product_id` into `shop_cart.product_id`, which is actually `uuid` — a
> `502` on every add-to-cart attempt. Gate there:
> `FUNCTION_DEPLOYED_SMOKE_BLOCKED`. This preflight's own conclusions are
> NOT invalidated by this (it never claimed to have live-tested
> `add_cart_item` itself) — see the 05C.2 doc for the new bug and
> recommended follow-up fix.

**Task:** P-AUTH-05C.1 Production Cart Recovery Preflight (read-only DB
checks + local-only code fixes; **no migration, `db push`, deploy, or
data deletion performed**).
**Date:** 2026-08-17 (repo session date)
**Context:** `umtqpstacjdwxcvcirbl` confirmed PRODUCTION
(`review-auth-05C.0-deployment-scope-audit.md`); 14 migrations already
applied; `shop_cart`/`orders`/`order_items` RLS-locked; `shop-ops` not yet
deployed → Cart/Checkout currently broken in production. This task
prepares (but does not execute) the forward-fix.

---

## 一、order_no 查核結果 (read-only SELECT only — no test order created)

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='orders'
ORDER BY ordinal_position;
```

Relevant columns:

| column | type | nullable | default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `user_id` | text | NO | — |
| `order_no` | text | **YES** | — (no column default) |
| `total_amount` | numeric | NO | `0` |
| `total_items` | integer | NO | `0` |
| `status` | text | NO | `'pending'` |

```sql
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers ...
```
→ `trigger_set_order_no` — `BEFORE INSERT` — `EXECUTE FUNCTION set_order_no()`.

`set_order_no()` body (read-only `pg_proc.prosrc`):
```plpgsql
begin
  if new.order_no is null or trim(new.order_no) = '' then
    new.order_no := public.generate_order_no();
  end if;
  return new;
end;
```

`generate_order_no()` body (read-only):
```plpgsql
declare
  date_part_text text;
  next_sequence integer;
  new_order_no text;
begin
  date_part_text := to_char(now() at time zone 'Asia/Taipei', 'YYMMDD');
  perform pg_advisory_xact_lock(hashtext('orders-' || date_part_text));
  select coalesce(max(nullif(split_part(order_no, '-', 3), '')::integer), 0) + 1
    into next_sequence
    from public.orders
   where order_no like 'LUCK-' || date_part_text || '-%';
  new_order_no := 'LUCK-' || date_part_text || '-' || lpad(next_sequence::text, 6, '0');
  return new_order_no;
end;
```

```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.orders'::regclass;
```
→ `orders_pkey` PRIMARY KEY (id); **`orders_order_no_key` UNIQUE (order_no)**;
`orders_merchant_trade_no_key` UNIQUE (merchant_trade_no).

**Conclusions (this fully resolves the `order_no` staging blocker documented
in `review-auth-05B-2B.md`/`review-auth-05B-2B.1-hotfix.md`):**
- `order_no` is **nullable** at the column level, but a `BEFORE INSERT`
  trigger auto-populates it whenever the inserted value is `NULL`/empty —
  `checkout_cart`'s current `INSERT INTO public.orders (...)` (which never
  sets `order_no`) will **always** get a real, non-null value from this
  trigger before the row is written.
- `generate_order_no()` guarantees uniqueness via a per-calendar-day
  (Asia/Taipei) `pg_advisory_xact_lock` serializing the "read max sequence,
  add 1" computation — combined with the `UNIQUE (order_no)` constraint,
  two concurrent checkouts on the same day cannot receive the same
  `order_no` (the second waits for the lock, held for the REST of the
  first transaction — see §四 for the throughput implication).
- **`checkout_cart` can legally `INSERT` without providing `order_no` —
  confirmed, not merely assumed.** No code change is needed in
  `checkout_cart` for this.

---

## 二、shop-ops CORS 檢查結果

### Findings (before this task's fix)

- `handleCorsPreflight(req)` in `supabase/functions/shop-ops/index.ts`
  already ran **first**, before route/body parsing and
  `resolveAuthenticatedUser()` — ✅ already compliant.
- **BUG FOUND:** none of `shop-ops/index.ts`'s 5 `jsonResponse(...)` calls
  passed `req` as the 4th argument — every actual POST response (success
  AND every error path) would have echoed the WRONG
  `Access-Control-Allow-Origin` (the code's internal fallback,
  `http://localhost:5500`, regardless of whether the real caller was
  `http://localhost:5588` or anything else) — only the **OPTIONS
  preflight** (via `handleCorsPreflight`, which DID already pass
  `req.headers.get("Origin")`) would have gotten the correct header. A
  real browser at `http://localhost:5588` would have passed its preflight
  but then had its ACTUAL request blocked by the browser's own CORS check
  on the mismatched response header — the exact same class of user-facing
  failure this whole 05C chain started with, just one layer deeper.
- **BUG FOUND (in the shared `cors.ts`, affecting shop-ops too):** a
  disallowed `Origin` fell back to the first allowlisted origin
  (`http://localhost:5500`) instead of being rejected — meaning a
  response to an arbitrary, non-allowlisted site would have LOOKED like it
  came from an allowed origin (though ownership/JWT verification inside
  every handler is unaffected either way — this was a CORS-header
  correctness issue, not an authorization bypass).

### Local-only fixes applied (per instruction: minimal, no business-logic
change, not deployed)

1. `supabase/functions/shop-ops/index.ts` — all 5 `jsonResponse(...)`
   calls now pass `req` (identical fix already applied to `wallet-ops/
   index.ts` in the prior 05C task).
2. `supabase/functions/_shared/cors.ts` — `resolveAllowOrigin()` now
   returns `null` for a disallowed Origin (header omitted from the
   response) instead of falling back to `http://localhost:5500`. A
   request with NO `Origin` header at all (non-browser caller) still
   falls back to the first allowed origin (harmless — CORS is
   irrelevant to non-browser callers).
3. **New:** `supabase/functions/_shared/cors.js` — a Node.js-testable CJS
   twin of `cors.ts` (this file previously had NO twin at all, unlike
   every other `_shared/**` module, since CORS was "not a Business Rule"
   — added here specifically so this fix could be covered by an
   automated test; the Edge Runtime still loads `cors.ts`, never this
   file).
4. **New:** `supabase/functions/_shared/__tests__/cors.test.js` — 13
   tests, all passing (see §四 "測試結果").

### Post-fix behavior (local, verified via the new tests — NOT deployed)

| Caller Origin | OPTIONS | POST success/error response |
|---|---|---|
| `http://localhost:5588` | `200`, `Access-Control-Allow-Origin: http://localhost:5588` | Same header, matching exactly |
| `http://localhost:5500` | `200`, `Access-Control-Allow-Origin: http://localhost:5500` | Same header, matching exactly |
| Disallowed (e.g. `https://evil.example.com`) | `200`, header **absent** | Header **absent** — browser's own CORS check rejects it; JWT/ownership checks inside every handler remain the actual authorization boundary regardless |

---

## 三、離線／靜態部署準備檢查 (prepared, NOT executed)

- `shop-ops` will be deployed with **default `verify_jwt: true`** (no
  `--no-verify-jwt`) — matching `wallet-ops`'s already-deployed
  configuration and this repo's established convention.
- JWT-derived `user.id` (via `resolveAuthenticatedUser(req)`, unchanged)
  remains the ONLY owner-identity source for every route — never the
  request body (unchanged, already covered by
  `supabase/functions/_shared/__tests__/shop-ops-handler.test.js`'s
  owner-id-forgery tests).
- `service_role` (used to construct the RPC-calling client) exists ONLY
  inside the Edge Function's own server-side execution environment —
  never sent to or reachable from the browser (unchanged; confirmed
  structurally by `shop-ops-repository.js`'s design and re-confirmed live
  for the analogous `wallet-ops` RPCs in the 05C.0 audit's
  `has_function_privilege` check).
- **Migrations `20260817000400`/`20260817000500` are CONFIRMED already
  applied** to `umtqpstacjdwxcvcirbl` (`supabase migration list`, remote
  timestamps present for both — re-confirmed in the 05C.0 audit). **No
  `db push` is needed or will be performed** as part of any future
  recovery deploy.
- **Exact recovery command (prepared, NOT run):**
  ```
  supabase functions deploy shop-ops
  ```
  (single command, no flags — default `verify_jwt`, matching `wallet-ops`'s
  own deploy).
- **Files that command will upload** (derived from `shop-ops/index.ts`'s
  own `import` statements — `shop-ops-handler.ts` and `shop-ops-
  repository.ts` have no further imports of their own):
  ```
  supabase/functions/shop-ops/index.ts
  supabase/functions/_shared/lib/shop-ops-repository.ts
  supabase/functions/_shared/shop-ops-handler.ts
  supabase/functions/_shared/supabase-clients.ts
  supabase/functions/_shared/cors.ts   <- includes this task's CORS fix
  ```
- **Predicted function version:** `1` (this function does not currently
  exist on the project at all — `supabase functions list` confirms only
  `wallpaper-generate`/`wallpaper-status`/`wallet-ops` exist today — a
  brand-new function's first deploy is always version 1, matching
  `wallet-ops`'s own first deploy in the prior 05C task).

---

## 四、既有風險 (documented only — no migration/function change made)

### Lock-ordering / deadlock risk between `checkout_cart` and `add_cart_item`

Confirmed via static code review of the ALREADY-APPLIED
`20260817000400`/`20260817000500`/(gacha/gift fixes don't apply here)
migrations:

- `checkout_cart`: locks ALL of the caller's `shop_cart` rows FIRST
  (`SELECT EXISTS (... FOR UPDATE)`), THEN locks each referenced
  `shop_products` row inside its per-item loop (cart → product order).
- `update_cart_item_quantity`: locks the specific `shop_cart` row FIRST,
  THEN the `shop_products` row (cart → product order — **consistent**
  with `checkout_cart`, no deadlock risk between these two).
- `add_cart_item`: locks the `shop_products` row FIRST, THEN checks for an
  existing `shop_cart` row (product → cart order — **INVERTED** relative
  to `checkout_cart`).

**Real (though narrow) deadlock risk:** if the SAME user concurrently (a)
checks out a cart that already contains product P (holding that user's
`shop_cart` rows, waiting on product P's row) and (b) adds MORE of product
P to their cart in a second tab/request (holding product P's row, waiting
on that user's existing `shop_cart` row for P) — this is a genuine
lock-order inversion that Postgres's deadlock detector can catch, aborting
ONE of the two transactions with `40P01`.

**40P01 → `retryable: true`?** Confirmed via static review of
`shop-ops-handler.js`'s `classifyCartAddFailureReason`/
`classifyCheckoutFailureReason`: neither recognizes a "deadlock detected"
message pattern — it falls through to the generic `"UNKNOWN"` branch,
which both `handleCartAddRequest`/`handleCheckoutRequest` map to a `502`
with **`retryable: true`** explicitly set. **Yes — a 40P01 would
currently be treated as safely retryable**, which is the correct behavior
for a transient deadlock abort (no data corruption; Postgres guarantees
the aborted transaction's writes are fully rolled back).

**Idempotency key retention on retry:** confirmed via
`js/shop/shop_cart.js`'s existing retry logic —
`if (!error?.retryable) { pendingCheckoutIdempotencyKey = null; }` — since
a 40P01-derived error would have `retryable: true`, the SAME idempotency
key is preserved and reused on the user's next retry attempt (correct;
unchanged by this task).

**Not fixed in this task** (explicitly out of scope: "不得在本階段修改
migration 或 production function"). Recommended (not applied): align
`add_cart_item`'s lock order to `shop_products` → `shop_cart` being
changed to `shop_cart` → `shop_products` (matching `checkout_cart`/
`update_cart_item_quantity`), in a future, separately-reviewed migration.

---

## 測試結果 (test results)

New: `supabase/functions/_shared/__tests__/cors.test.js` — **13/13
passing**, covering exactly the required scenarios (allowed origins
`localhost:5500`/`5588` on both OPTIONS and POST/error responses;
disallowed origin gets no header at all, never a fake fallback).

Full regression: `.\scripts\verify-local.ps1` — **634/634 passing**
(621 prior + 13 new `cors.test.js`). No existing test changed or broken.

---

## 本機修改檔案 (local files changed — none deployed)

- `supabase/functions/_shared/cors.ts` — disallowed-origin header omission
  fix (see §二).
- `supabase/functions/_shared/cors.js` — **new**, Node-testable twin.
- `supabase/functions/_shared/__tests__/cors.test.js` — **new**, 13 tests.
- `supabase/functions/shop-ops/index.ts` — `req` threaded through every
  `jsonResponse(...)` call.
- `scripts/verify-local.ps1` — added `node --check
  supabase/functions/_shared/cors.js`.

**No migration file changed. No `db push` run. No `supabase functions
deploy` run.**

---

## 精確部署命令 (prepared, NOT executed)

```
supabase functions deploy shop-ops
```

See §三 for the exact file list and predicted version (1).

---

## 預估影響 (estimated impact of running the above, if/when approved)

- Restores Cart/Checkout to working order on production (currently
  broken — RLS blocks the old direct-write path; `shop-ops` doesn't
  exist yet).
- No migration/schema change (both required migrations already applied).
- No data risk (function deploy only; `checkout_cart`/`add_cart_item`/etc.
  RPCs are unchanged by this task, only their HTTP-layer CORS wrapper is).
- `verify_jwt` stays `true` — no authentication weakening.

## Rollback 方式 (if this deploy is ever approved and needs to be undone)

```
supabase functions delete shop-ops
```
(removes the deployed function only; does not touch any migration, table,
or row — `shop_cart`/`orders`/`order_items` RLS lockdown would remain in
place, so Cart/Checkout would return to its CURRENT broken state, not to
some worse state.)

---

## 尚存風險 (residual risks after a hypothetical shop-ops deploy)

1. The `add_cart_item`/`checkout_cart` lock-ordering deadlock risk (§四) —
   narrow, same-user-only, and already safely classified as retryable —
   not fixed in this task.
2. `checkout_cart`'s `claim_gacha_draw`-class idempotency race (see
   `review-auth-05B-2B.1-hotfix.md`) was ALREADY fixed for `checkout_cart`
   itself (`20260817000500`) — this is not a residual risk for Cart/
   Checkout specifically, only for Gacha/Gift (tracked separately, see
   `review-auth-05C.0-deployment-scope-audit.md` §6).
3. `generate_order_no()`'s per-day advisory lock serializes ALL concurrent
   checkouts globally (not just per-user) for the duration of each
   checkout's ENTIRE remaining transaction (the lock is `xact`-scoped, held
   until commit/rollback, not released right after the trigger runs) — a
   throughput bottleneck under real concurrent load, not a correctness bug
   (out of scope for this preflight; flagged for awareness only).
4. This preflight did not re-verify `wallet-ops`'s live behavior (already
   verified end-to-end in the prior 05C task) — only `shop-ops`'s
   readiness was assessed here.

---

## Gate 結論

**SAFE_TO_DEPLOY_SHOP_OPS**

Rationale: the `order_no` schema question is now definitively resolved
(non-blocking — a working trigger + unique constraint already handles
it correctly). The shop-ops CORS bug (missing `req` passthrough) and the
shared CORS allowlist bug (fake fallback origin for disallowed callers)
have been found and fixed LOCALLY, with 13 new passing tests and no
regression (634/634 total). No unverified/public write path exists
(re-confirmed structurally; the RPCs themselves are unchanged). The one
residual risk (a narrow deadlock possibility between `add_cart_item` and
`checkout_cart`) is real but already safely handled by the existing
retryable-error classification and idempotency-key-retention logic — it
does not block deployment, only recommends a future follow-up.

**No deployment, `db push`, migration repair, rollback, or data deletion
was performed by this task.** Awaiting explicit human approval to run
`supabase functions deploy shop-ops`.
