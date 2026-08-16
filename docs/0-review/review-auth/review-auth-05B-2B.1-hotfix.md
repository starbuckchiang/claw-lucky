# review-auth-05B-2B.1-hotfix.md — Checkout Idempotency Race Fix

> **CORRECTED by P-AUTH-05C.0 Deployment Scope Audit**
> (`review-auth-05C.0-deployment-scope-audit.md`): this doc's "Migration &
> deployment status" section (below) saying the migration is "NOT applied
> and NOT deployed" is now STALE — a LATER task (P-AUTH-05C) applied it
> to `umtqpstacjdwxcvcirbl`, mistakenly believed at the time to be a
> staging project. It is actually PRODUCTION. See the audit doc for the
> corrected deployment status.

**Gate:** P-AUTH-05B-2B.1 (hotfix on top of P-AUTH-05B-2B)
**Date:** 2026-08-16 (repo session date)
**Scope:** `checkout_cart()` RPC only — Cart add/update/remove/clear and
every other 05B-2B security boundary are UNCHANGED by this hotfix.
**Constraints honored:** no refactor, no deployment, no modification of
`20260817000400_shop_cart_checkout_secure_rpc.sql` (or any other existing
migration) — only a NEW migration + NEW tests were added.

---

## 1. 根因 (Root cause)

The original `checkout_cart()` (05B-2B) looked up the idempotency ledger
with a plain read:

```sql
SELECT * INTO v_cached FROM shop_checkout_requests
WHERE idempotency_key = p_idempotency_key FOR UPDATE;
IF FOUND THEN ... return cached ...; END IF;
-- else: treat as a FRESH checkout, lock cart, proceed
```

Two genuinely concurrent requests carrying the **same** idempotency key
can both execute this `SELECT` before **either** has committed anything —
under Postgres MVCC, neither transaction can see the other's not-yet-
committed row, so **both** conclude "not found" and **both** proceed to
lock `shop_cart`. Whichever one runs second (after the first has already
run `DELETE FROM shop_cart`) then hits `RAISE EXCEPTION 'cart is empty'`
and returns `CART_EMPTY` — instead of waiting for the winner and returning
the winner's order. This is a genuine correctness bug, not merely a
theoretical race: the whole point of the idempotency key is "a resend of
the SAME intent must return the SAME result," and the original design only
achieved that for **sequential** resends (a lost HTTP response, retried
later), never for two requests that are **actually concurrent** (e.g. a
literal double-click firing two fetches back-to-back with no meaningful
gap between them).

---

## 2. 修正前後 transaction 時序 (Before/after transaction sequencing)

**Before (05B-2B, buggy):**

```
Request A                          Request B (same key, concurrent)
--------------------------------   --------------------------------
SELECT ... FOR UPDATE  -> NOT FOUND
                                    SELECT ... FOR UPDATE  -> NOT FOUND (A hasn't committed yet)
lock shop_cart FOR UPDATE (wins)
... process, DELETE shop_cart ...
INSERT shop_checkout_requests
COMMIT (order created)
                                    lock shop_cart FOR UPDATE (now empty)
                                    RAISE EXCEPTION 'cart is empty'   <-- WRONG: should return A's order
```

**After (05B-2B.1 hotfix):**

```
Request A                          Request B (same key, concurrent)
--------------------------------   --------------------------------
INSERT ... ON CONFLICT DO NOTHING  INSERT ... ON CONFLICT DO NOTHING
  (wins: row created, 'processing')  (BLOCKS here — Postgres's own
SELECT ... FOR UPDATE -> ours        conflict resolution waits for A)
identity check OK
status = 'processing' -> proceed
lock shop_cart, process, ...
INSERT orders/order_items
DELETE shop_cart
UPDATE shop_checkout_requests
  SET status='completed', order_id=...
COMMIT
                                    (A committed -> B's INSERT resolves:
                                     conflict exists, ON CONFLICT DO
                                     NOTHING -> 0 rows)
                                    SELECT ... FOR UPDATE -> A's row
                                    identity check OK (same user)
                                    status = 'completed' -> RETURN A's
                                      order directly. No cart-empty
                                      check ever runs for B.
```

If A instead **rolls back** (e.g. `insufficient stock`), A's `INSERT`
(step 1) is undone by the rollback along with everything else — B's
blocked `INSERT ... ON CONFLICT DO NOTHING` then sees **no** conflict at
all (the row is gone) and actually performs the insert, becoming the new,
legitimate claimant and running a full fresh checkout attempt with the
same key.

---

## 3. Idempotency claim/lock 設計

Chosen design: **"claim, then lock"** via `INSERT ... ON CONFLICT DO
NOTHING` followed by `SELECT ... FOR UPDATE`, over an advisory lock,
because:
- It needs no new lock-key hashing scheme (`pg_advisory_xact_lock` would
  need e.g. `hashtext(idempotency_key)`, an extra moving part).
- It reuses Postgres's own well-defined `INSERT ... ON CONFLICT`
  conflict-resolution semantics (documented, standard "upsert race safety"
  behavior) instead of a hand-rolled retry loop.
- The SAME row that already exists for idempotency-result storage is also
  the lock/claim primitive — no second table.

Schema change (new migration, **does ALTER the existing
`shop_checkout_requests` table** — see §6 for full disclosure):
- `status TEXT NOT NULL DEFAULT 'processing'` (`CHECK (status IN
  ('processing', 'completed'))`) — a row now represents either an
  in-flight claim or a completed result.
- `order_id` — `NOT NULL` dropped (a claim row is inserted **before** the
  order exists).

Function change (`CREATE OR REPLACE FUNCTION public.checkout_cart(...)`,
same signature, in the NEW migration file — the original file's text is
untouched):
1. `INSERT ... VALUES (key, user, NULL, 'processing') ON CONFLICT
   (idempotency_key) DO NOTHING` — the actual serialization point.
2. `SELECT * FROM shop_checkout_requests WHERE idempotency_key = ... FOR
   UPDATE` — locks whichever row now exists.
3. Identity check (`v_claim.user_id <> p_user_id`) — **unconditional**,
   runs before any branch on `status` (same P-AUTH-05A.1 ordering
   convention used everywhere else in this repo).
4. `status = 'completed'` → return the cached order **immediately** — this
   branch is positioned in the source **before** the empty-cart check, so
   a resend of an already-completed key can never have its result masked
   by a stale `CART_EMPTY`.
5. Otherwise (`status = 'processing'`, and by construction this can only
   be **our own** just-created claim) → proceed with the **unchanged**
   cart-lock / product-lock / total computation / order + order_items
   creation / stock decrement / cart-clear logic from 05B-2B, then `UPDATE
   shop_checkout_requests SET status='completed', order_id=...` (an
   UPDATE of the existing claim row, not a second INSERT).

**No exception-catching shortcut exists.** There is no `EXCEPTION WHEN
unique_violation` anywhere in this function — statically verified (see
§7) — so the caller-visible outcome of a conflict is never a hand-rolled
`CART_EMPTY`, only the natural "wait, then read the real state" path
above.

**Lock ordering / deadlock avoidance:** every call now locks rows in the
same fixed order — `shop_checkout_requests` claim row → `shop_cart` rows
→ `shop_products` rows — for every caller, so two concurrent transactions
can never each hold a lock the other is waiting for.

---

## 4. order_no 查核結果

**Confirmed (again, via a targeted grep — not a full-repo scan): no
migration file anywhere in `supabase/migrations/**` defines `public.orders`
or its `order_no` column, default, or a trigger that populates it.** The
`orders` table itself was created outside any committed migration (e.g.
directly in the Supabase dashboard at some point), so this repo has **no
record** of whether `order_no`:
- is `NOT NULL`,
- has a `DEFAULT` (sequence, `gen_random_uuid()`-style, formatted string,
  etc.), or
- is populated by an `AFTER INSERT` trigger.

**This hotfix does NOT invent an unverified generation scheme.** The
`INSERT INTO public.orders (...)` statement is byte-for-byte unchanged
from the 05B-2B original (still does not set `order_no` explicitly) — this
was a deliberate choice, not an oversight: guessing a generation scheme
(e.g. adding our own `order_no := 'ORD-' || to_char(now(),...)` default)
without knowing the real column's actual constraints/defaults/triggers
risks a real conflict (e.g. two different generation schemes racing, or
violating a real trigger's own assumptions) that would be worse than the
current, honestly-disclosed unknown.

**STAGING BLOCKER (explicit, not resolved by this hotfix):** before this
gate can be considered deployment-ready, someone with real project access
must run, against the real staging project:

```sql
SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'order_no';

SELECT trigger_name, event_manipulation, action_statement
  FROM information_schema.triggers
 WHERE event_object_schema = 'public' AND event_object_table = 'orders';
```

and confirm either (a) a `DEFAULT`/trigger reliably produces a non-null,
unique `order_no` on every insert this function performs, or (b) `order_no`
is nullable and a null value is acceptable to the rest of the application
(`js/shop/orders.js`/`js/shop/luck_complete.js` already tolerate a missing
`order_no` via `String(order?.order_no || "").trim()` fallback text, so a
null value would not crash the UI — but this has never been verified
against the real column's actual `NOT NULL` status). **A regression test
(§7) asserts this repo-wide unknown remains true and will fail loudly the
moment any future migration defines `public.orders`/`order_no`, forcing
this blocker note to be revisited.**

---

## 5. Migration & deployment status (explicit, per requirement 4)

| Item | Status |
|---|---|
| `20260817000400_shop_cart_checkout_secure_rpc.sql` | Pre-existing (05B-2B). **NOT modified by this hotfix.** Still not applied to any project. |
| `20260817000500_shop_checkout_atomic_claim_fix.sql` | **NEW file.** **DOES `ALTER TABLE public.shop_checkout_requests`** (adds `status`, drops `NOT NULL` on `order_id`, adds a `CHECK` constraint) — this is a genuine schema ALTER of a table defined by an earlier migration, explicitly disclosed here (correcting the prior gate's report, which said "no existing table/column/row/policy is modified" — that statement was true of the 05B-2B migration file itself, but is no longer the state of the overall migration SET once this hotfix is included). Also `CREATE OR REPLACE FUNCTION public.checkout_cart(...)`, superseding (not editing) the 05B-2B version. |
| Applied to any real Postgres/Supabase project | **NO.** Neither migration has been applied anywhere. |
| `shop-ops` Edge Function deployed | **NO.** Unchanged from 05B-2B (implemented, never deployed). |
| Any other existing migration/RLS policy touched | **NO.** |

---

## 6. 測試結果 (Test results) — STATIC PASS vs RUNTIME NOT RUN

Per requirement 3, every claim below is explicitly labeled.

### STATIC PASS (SQL-text structural assertions — proven now)

`supabase/migrations/__tests__/shop-checkout-atomic-claim-fix-shape.test.js`
(10 tests, all passing):
- The migration DOES alter existing schema (`status` column, dropped
  `NOT NULL`, new `CHECK` constraint) — disclosed, not hidden.
- `checkout_cart` remains `SECURITY DEFINER`, hardened, `service_role`-only.
- The claim is made via `INSERT ... ON CONFLICT (idempotency_key) DO
  NOTHING` — **and there is no `EXCEPTION WHEN unique_violation` anywhere
  in the function** (structurally impossible to "catch a unique violation
  and return CART_EMPTY").
- Ordering: claim-insert < lock-select < identity-check < completed-branch
  < cart-empty-check (textual position assertions).
- The completed-claim branch contains its own `RETURN` **before** any
  cart/product lock line appears in the function text.
- A fresh claim is marked completed via `UPDATE` (not a second `INSERT`,
  which would violate the claim row's own primary key).
- The identity check is unconditional (positioned before the
  `status = 'completed'` branch even exists).
- `orders.status` is still only ever `'pending'` in the `INSERT INTO
  orders` statement (never `'paid'/'completed'/'success'`; the LEGITIMATE
  literal `'completed'` used for the claim-tracking `status` column is a
  different field and is scoped out of this specific assertion).
- **order_no staging blocker regression guard:** no migration file defines
  `public.orders` or an `order_no` column/trigger (this test will start
  failing the moment that ever changes, forcing this blocker to be
  revisited).
- The `orders` INSERT's column list still does not include `order_no`.

`supabase/functions/_shared/__tests__/shop-ops-handler.test.js` (63 tests,
all passing, includes 5 NEW tests explicitly prefixed `[SIMULATED, not
real Postgres]`):
- A JS promise-based mutex fake (`createClaimLockCheckoutRepository`)
  models the CONTRACT the real SQL must satisfy — a second concurrent
  same-key call **waits** for the first to settle, then either reads the
  committed result or safely takes over after a simulated rollback. This
  proves the HANDLER layer correctly passes through whatever the
  repository/RPC returns without adding its own (buggy) double-execution
  logic on top — it does **not** execute any SQL and is **not** proof of
  real `INSERT ... ON CONFLICT` / `FOR UPDATE` behavior.
- Covered scenarios: true `Promise.all` concurrency (2-way and 3-way, same
  UID + same key) → exactly one order, identical `order_id` in both
  responses; first attempt rollback (`CART_EMPTY`) → second attempt with
  the same key safely takes over and succeeds; a resend of an
  already-completed key never re-runs the cart-empty check (proves
  `CART_EMPTY` cannot mask a completed result); a **different UID** reusing
  the same key never receives the first user's `order_id` (asserted via a
  direct string-search on the response body) and gets only a generic
  `CHECKOUT_FAILED`, never a distinguishing message.

Full regression (`.\scripts\verify-local.ps1`):

```
tests 616
suites 0
pass 616
fail 0
cancelled 0
skipped 0
todo 0
```

(601 prior + 15 new: 10 migration-shape + 5 handler-simulation.) All prior
Wallet/Gacha/Gift/Account-Merge/Subscription/Wallpaper tests, and all
05B-2B Cart/Checkout tests, remain green — no regression.

### RUNTIME NOT RUN (explicit blocker — requires real Postgres/Supabase)

- **Real concurrent transaction behavior** of `INSERT ... ON CONFLICT DO
  NOTHING` blocking on an uncommitted conflicting row, and `SELECT ... FOR
  UPDATE` row-lock semantics generally, have **NOT** been executed against
  any real Postgres instance in this environment (no local Postgres/pg-mem
  harness, no live Supabase project access — same limitation as every
  prior P-AUTH-05B gate in this repo).
- `scripts/verify-checkout-concurrency-staging.js` — a NEW, standalone,
  manually-run script (mirrors this repo's existing
  `scripts/test-real-gemini-provider.js` convention: real E2E scripts
  require real credentials and are deliberately kept OUTSIDE
  `verify-local.ps1`'s automated suite) — is the concrete, executable
  design for this proof: it fires two genuinely concurrent HTTP requests
  at a deployed `shop-ops/checkout` endpoint with the same idempotency key,
  then directly reads `orders`/`order_items` via the REST API (service
  role) to assert exactly one order was created and both responses agree.
  **This script has NOT been run** (requires a deployed staging project —
  none exists yet). Running it, along with the `information_schema` query
  in §4, is the concrete 05C Staging Gate checklist for this hotfix.

---

## 7. Files changed

**New:**
- `supabase/migrations/20260817000500_shop_checkout_atomic_claim_fix.sql`
- `supabase/migrations/__tests__/shop-checkout-atomic-claim-fix-shape.test.js`
- `scripts/verify-checkout-concurrency-staging.js`

**Modified:**
- `supabase/functions/_shared/__tests__/shop-ops-handler.test.js` — 5 new
  `[SIMULATED, not real Postgres]`-labeled tests appended (no existing
  test changed).

**Untouched (verified, not modified):**
- `20260817000400_shop_cart_checkout_secure_rpc.sql` (per instruction —
  the original 05B-2B migration file's text is byte-for-byte unchanged;
  its `checkout_cart` definition is only superseded at apply-time by the
  new migration's `CREATE OR REPLACE`).
- `supabase/migrations/__tests__/shop-cart-checkout-secure-rpc-shape.test.js`
  (still tests the OLD 05B-2B file's text, which is unchanged — those
  assertions remain literally true of that file and continue to pass;
  they do not describe the function that actually runs once both
  migrations are applied in order).
- `js/shop/shop-api.js`, `js/shop/shop_cart.js`, `js/api.js`, all
  Cart/Wallet/Gacha/Gift frontend code — this hotfix is entirely
  server-side (one new migration); no frontend call shape changed.
- `scripts/verify-local.ps1` — no changes needed (new test files already
  match existing glob patterns; the new staging script is intentionally
  excluded, matching the repo's established convention for manual/real-
  credential E2E scripts).

---

## 8. Staging blockers (explicit list for 05C)

1. **Real concurrency proof not run.** Run
   `scripts/verify-checkout-concurrency-staging.js` against a real staging
   project (both migrations applied, `shop-ops` deployed, a real test
   user with a non-empty cart) and confirm it prints `STAGING CONCURRENCY
   CHECK PASSED`.
2. **`order_no` schema unknown.** Run the two `information_schema` queries
   in §4 against the real project and confirm `order_no` will always be
   populated with a valid, unique value by the `INSERT INTO orders`
   statement in `checkout_cart()` — or explicitly decide (with product/eng
   sign-off) that a null `order_no` is acceptable, given the frontend's
   existing fallback display text.
3. Everything already listed as a blocker in `review-auth-05B-2B.md`
   (cart-add stock reservation, no live Postgres available generally)
   still applies unchanged.

---

## 9. Gate 結論 (Gate conclusion)

**PARTIAL** (unchanged classification from 05B-2B; this hotfix closes the
specific correctness bug it was asked to close, but does not newly
introduce a real-Postgres verification capability that did not exist
before).

Rationale: the concurrency-safety root cause is now fixed with a minimal,
targeted, additive migration (no refactor, no existing migration edited),
using a well-understood Postgres pattern (`INSERT ... ON CONFLICT DO
NOTHING` + `SELECT ... FOR UPDATE`) rather than an exception-catching
shortcut. All 616 automated tests pass, including 15 new tests directly
covering the required scenarios (true concurrent same-key/same-UID →
one order, rollback → safe takeover, completed-result never masked by
CART_EMPTY, cross-UID key reuse rejected, and a repo-wide static guard
confirming the `order_no` generation mechanism genuinely cannot be proven
from this repo alone). It remains PARTIAL, not PASS, because: (a) the
real-Postgres concurrency behavior this fix depends on has not been
executed anywhere (STATIC PASS only, RUNTIME NOT RUN — see §6), and (b)
`order_no`'s actual schema constraints are an explicit, unresolved staging
blocker (§4/§8) that could theoretically cause a real INSERT failure this
repo cannot detect ahead of time.

No deployment performed. Not proceeding to 05C per instructions.
