# review-auth-05C.0-deployment-scope-audit.md — Deployment Scope Audit

**Task:** P-AUTH-05C.0 Deployment Scope Audit (read-only only — no
migration, deploy, data deletion, or rollback performed as part of this
audit).
**Date:** 2026-08-17 (repo session date)
**Trigger:** user flagged that project ref `umtqpstacjdwxcvcirbl` shows
`main — PRODUCTION` in the Supabase Dashboard, while
`review-auth-05C-wallet-ops-cors-hotfix.md` called it "staging" and
performed a `db push` (14 migrations) + `wallet-ops` function deploy
against it.

**All commands in this audit were read-only** (`supabase projects list`,
`supabase branches list`, `supabase migration list`, `supabase functions
list`, `supabase db query --linked` with `SELECT`/`information_schema`/
`pg_catalog` queries only — no `INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`
executed by this audit itself).

---

## 1. 唯讀確認環境身份 (Read-only environment identity confirmation)

| Check | Result |
|---|---|
| Linked project ref | `umtqpstacjdwxcvcirbl` |
| Organization | slug `nqzezajsqggeppwpgook`, project name **"starbuckchiang's Project"** |
| Project status | `ACTIVE_HEALTHY`, region `us-east-2`, created `2026-07-02T02:01:08Z` |
| Branching (`supabase branches list`) | **ONE branch: `main`**, `"is_default": true`, `"git_branch": "main"`, `"project_ref": "umtqpstacjdwxcvcirbl"` = `"parent_project_ref"` (i.e. `main` IS the project itself, not an isolated preview branch pointing elsewhere) |
| Is this `main`/PRODUCTION? | **YES.** In Supabase's branching model, the default/`main` branch of a project is not a separate "staging" copy — it is the production database itself (a genuinely separate, isolated copy only exists for a *preview* branch, which this project does not have). The Dashboard's `main — PRODUCTION` label is Supabase's own standard labeling for exactly this situation. There is also **only one project total** under this account (`supabase projects list` returned exactly one entry) — no separate staging project exists anywhere for this account. |

**Finding: `umtqpstacjdwxcvcirbl` is the PRODUCTION project.** There is no
staging/preview environment distinct from it. The prior review doc's
repeated framing of this project as "staging" (throughout
`review-auth-05B-2B.md`, `review-auth-05B-2B.1-hotfix.md`, and
`review-auth-05C-wallet-ops-cors-hotfix.md`) was **incorrect** — not
because those documents lied, but because no verification of the actual
Dashboard environment label was ever performed before treating this
project as a safe target for `db push`/`functions deploy`. This is
corrected in §5 below.

---

## 2. 唯讀盤點已發生變更 (Read-only inventory of changes already made)

### Migrations — before vs. after this session

**Before** any action taken in the "05B-2B" → "05C" chain of tasks, the
remote had exactly 6 migrations applied (all pre-dating this entire
chain, from the original wallpaper/prompt-versions feature work):

```
20260712040000, 20260712040100, 20260712122000, 20260712122100,
20260716010000, 20260727000000
```

**After** (current state, confirmed via `supabase migration list` — local
and remote timestamps match for all 20):

```
20260712040000 .. 20260727000000   (the original 6, unchanged)
20260816000000  core_user_tables_owner_rls
20260816000100  point_transactions_ledger
20260816000200  account_merge_claims
20260816000300  user_mascots_dedup_and_unique_constraint
20260816000400  account_merge_requests_and_finalize
20260817000000  ticket_coin_wallet_ledger
20260817000100  ensure_user_row_and_generic_balance_adjustment
20260817000200  gacha_draw_secure_rpc
20260817000300  gift_redeem_secure_rpc
20260817000400  shop_cart_checkout_secure_rpc
20260817000500  shop_checkout_atomic_claim_fix
20260817000600  gacha_gift_ambiguous_column_fix
20260817000700  gacha_ambiguous_column_fix_2
20260817000800  gacha_gift_bigint_balance_fix
```

**14 migrations were applied to the production project** in this chain
of tasks (`20260816000000` through `20260817000800`).

### Edge Functions deployed

| Function | Before | After |
|---|---|---|
| `wallpaper-generate` | ACTIVE, v30 | unchanged |
| `wallpaper-status` | ACTIVE, v15 | unchanged |
| `wallet-ops` | **did not exist** | **ACTIVE, v1, deployed 2026-08-16T16:22:34.830Z** (`verify_jwt: true`) |

`shop-ops`, `account-merge`, `subscription-checkout` remain **not
deployed** (confirmed via `supabase functions list` — only the three
functions above exist).

### Objects created/altered by the 14 migrations (from migration file text + live confirmation)

**New tables:** `point_transactions`, `ticket_transactions`,
`coin_transactions`, `account_merge_claims`, `account_merge_requests`,
`mascot_rarities`, `gacha_draw_requests`, `gift_redemption_requests`,
`shop_checkout_requests`.

**Existing tables ALTERED (RLS + policies only, no column/data changes
except the two items below):** `users`, `user_mascots`, `redeem_history`,
`shop_cart`, `orders`, `order_items` — `ENABLE ROW LEVEL SECURITY` +
owner-scoped SELECT policies + deny-all-write policies for `authenticated`
(from `20260816000000`).

**Column-level ALTERs on existing tables:** `users.legacy_user_id` column
ADDED (nullable, from `20260816000000` — additive only). A `UNIQUE`
constraint `uq_user_mascots_user_mascot` was added to `user_mascots`
(`20260816000300`), preceded by a dedup step that (confirmed via its own
`RAISE NOTICE`, visible in the original push output) found **0 duplicate
groups** — no rows were merged or deleted by that step on this project.

**Functions created:** `apply_point_transaction`, `apply_ticket_transaction`,
`apply_coin_transaction`, `ensure_user_row`, `claim_gacha_draw` (superseded
twice more by `20260817000700`/`800` — same signature, only the body/OUT
types changed), `upsert_user_mascot_obtain`, `redeem_gift_transaction`
(superseded once more by `20260817000800`), `add_cart_item`,
`update_cart_item_quantity`, `remove_cart_item`, `clear_cart`,
`checkout_cart` (superseded once by `20260817000500`),
`create_account_merge_claim`, `consume_account_merge_claim`/
`finalize_account_merge`, `expire_stale_account_merge_claims`. All
confirmed (live, read-only `pg_proc`/`has_function_privilege` query, §3
below) to be `SECURITY DEFINER`, revoked from `PUBLIC`/`anon`/
`authenticated`, granted to `service_role` only.

**Data backfill:** `20260816000100`/`20260817000000` each ran a one-time
backfill inserting an opening `point_transactions`/`ticket_transactions`/
`coin_transactions` row per EXISTING user (recording their CURRENT
`points`/`tickets`/`coins` balance as a ledger entry — additive INSERT
only, confirmed by migration text: no `UPDATE`/`DELETE` on `users` in
either backfill block). This is the only "existing data" this session's
migrations touched, and it was additive-only (25 real pre-existing users
each got exactly one backfill row per ledger table).

---

## 3. 風險檢查 (Risk check — all read-only)

### Data volumes (read-only `COUNT(*)`, no rows added/removed by this audit)

| Table | Row count |
|---|---|
| `users` | 25 |
| `redeem_history` | 17 |
| `user_mascots` | 63 |
| `point_transactions` | 28 |
| `ticket_transactions` | 26 |
| `coin_transactions` | 28 |
| `gacha_draw_requests` | 4 |
| `gift_redemption_requests` | 0 |
| `shop_checkout_requests` | 0 |
| `account_merge_claims` | 0 |
| `account_merge_requests` | 0 |

**This confirms `umtqpstacjdwxcvcirbl` holds real, pre-existing user data**
(25 users, 17 redeem-history entries, 63 mascot-collection rows — created
well before this task chain; e.g. one user's `points`/`coins` balance was
already at 485/14 as of 2026-08-15, a full day before this chain of tasks
began) — this is further, independent confirmation this is a real,
in-use database, not an empty scratch/staging project.

The `point_transactions`/`ticket_transactions`/`coin_transactions`/
`gacha_draw_requests` counts include a small number of rows generated by
this session's OWN prior live-verification testing (one test draw via
direct SQL, one real draw via the browser UI, both against one single
test user, `5a706db8-3814-4687-a36a-0d9cd9ebb940`) — these were legitimate
functional-verification calls (not simulated/mocked), but they DID write
real rows to a production database as a side effect of verifying the
`wallet-ops` deployment. **No test data was added or removed by this
audit itself** — this paragraph is reporting rows created by the
PRIOR (05C hotfix) task, not by this read-only audit.

### Incomplete-schema risk from migration failures

**None currently.** The two mid-push failures during the original 05B-2B.2
hotfix work (a `text`/`uuid` cast error, then a foreign-key violation)
both rolled back cleanly — confirmed at the time via a `404` on
`point_transactions` immediately after the first failure (table did not
exist), and confirmed now via §2/§3's live queries: every expected table
exists, every expected table has RLS enabled, every expected function
exists with the correct grants. No orphaned/partial objects were found.

### wallet-ops JWT enforcement (read-only re-confirmation)

- `verify_jwt: true` (confirmed again via `supabase functions list`).
- A POST with no `Authorization` header still returns `401` (gateway-level
  rejection, confirmed in the prior task; not re-tested destructively in
  this audit to avoid any further live calls beyond what read-only
  identity/inventory checks required).

### Unverified or public write paths

**None found.** Read-only `has_function_privilege()` check against every
new `SECURITY DEFINER` RPC (`ensure_user_row`, `claim_gacha_draw`,
`redeem_gift_transaction`, `add_cart_item`, `update_cart_item_quantity`,
`remove_cart_item`, `clear_cart`, `checkout_cart`,
`apply_point_transaction`, `apply_ticket_transaction`,
`apply_coin_transaction`) confirms: `anon` = **false**, `authenticated` =
**false**, `service_role` = **true**, for every single one. No function
callable directly by the browser bypasses JWT-derived ownership.

### CURRENT PRODUCTION IMPACT (new finding from this audit, not previously flagged)

**Cart/Checkout is currently non-functional on `umtqpstacjdwxcvcirbl`.**
`20260816000000` (applied) enabled RLS on `shop_cart`/`orders`/
`order_items` and denies ALL authenticated INSERT/UPDATE/DELETE on them.
The frontend (`js/shop/shop-api.js`/`js/shop/shop_cart.js`, already
rewritten in the 05B-2B gate to call a `shop-ops` Edge Function instead of
writing directly) has no working backend to call, because **`shop-ops`
has never been deployed** (confirmed, §2). This means, on the real
production project, right now:
- The OLD insecure direct-write path is blocked by RLS (as designed).
- The NEW secure path (`shop-ops`) returns 404 (not deployed) — the exact
  same class of failure this whole chain of tasks originally diagnosed
  for `wallet-ops`.
- **Net effect: any real user attempting to add-to-cart/checkout on
  production right now will experience a hard failure.**

This is a genuine service-availability regression caused by this chain of
tasks and is the single most important actionable risk this audit found.
It is NOT fixed by this audit (read-only only, per instruction) — it is
listed as a required decision item in §4.

---

## 4. 不得自動 Rollback — decision items requiring human approval

No `DROP`/`DELETE`/migration-repair/function-delete/schema-restore/
redeploy was performed by this audit. Below are the options for a human
approver to choose from; **none have been executed**.

### Option A — Forward-fix: deploy `shop-ops` to make Cart/Checkout work again

- **Exact impact:** deploys the ALREADY-IMPLEMENTED, already-tested
  `supabase/functions/shop-ops` function (no new migration needed — its
  two migrations, `20260817000400`/`500`, are already applied). Restores
  Cart/Checkout to working (secure) order. Function-only deploy, default
  `verify_jwt: true`.
- **Data loss risk:** none (no schema/data change; a function deploy only).
- **Rollback if needed:** `supabase functions delete shop-ops` (removes
  the deployed function only; does not affect data or migrations).
- **Not executed by this audit** — requires explicit approval, since any
  further deploy to a now-CONFIRMED production project must be
  authorized as such (not as "staging").

### Option B — Forward-fix: leave Cart/Checkout broken until further instruction

- **Exact impact:** no further deploy action; Cart/Checkout remains
  unusable for real users until a human decides otherwise.
- **Data loss risk:** none (status quo).
- Not a rollback — this is simply "do nothing further."

### Option C — Rollback: revert the RLS lockdown on `shop_cart`/`orders`/`order_items` (from `20260816000000`) to restore the OLD (insecure) direct-write path

- **Exact impact:** would restore the PRE-05B-2B behavior (client-supplied
  `user_id`, client-computed prices/totals, no ownership check on
  `updateCartItem`/`removeCartItem`) — i.e. deliberately reintroducing the
  exact vulnerabilities the 05B-2B gate was created to close.
- **Data loss risk:** none by itself (policy change only), but reopens a
  real security hole (documented extensively in `review-auth-05B-2B.md`).
- **Rollback SQL (if ever explicitly approved):**
  ```sql
  DROP POLICY IF EXISTS p_shop_cart_deny_insert_authenticated ON public.shop_cart;
  DROP POLICY IF EXISTS p_shop_cart_deny_update_authenticated ON public.shop_cart;
  DROP POLICY IF EXISTS p_shop_cart_deny_delete_authenticated ON public.shop_cart;
  DROP POLICY IF EXISTS p_orders_deny_insert_authenticated ON public.orders;
  DROP POLICY IF EXISTS p_orders_deny_update_authenticated ON public.orders;
  DROP POLICY IF EXISTS p_orders_deny_delete_authenticated ON public.orders;
  DROP POLICY IF EXISTS p_order_items_deny_insert_authenticated ON public.order_items;
  DROP POLICY IF EXISTS p_order_items_deny_update_authenticated ON public.order_items;
  DROP POLICY IF EXISTS p_order_items_deny_delete_authenticated ON public.order_items;
  ```
- **NOT recommended** — included only because the instruction requires
  every rollback option to be presented with its SQL; Option A (deploy the
  already-built secure `shop-ops`) achieves the same "Cart/Checkout works
  again" outcome without reintroducing the vulnerability.

### Option D — Rollback: fully revert all 14 migrations + undeploy `wallet-ops` (return `umtqpstacjdwxcvcirbl` to its pre-08-16 state)

- **Exact impact:** removes ALL new tables/functions/policies from §2;
  undeploys `wallet-ops`. Gacha/Gift (currently WORKING, verified
  end-to-end in the prior task) would go back to being broken (either via
  the old insecure direct-write path, now itself impossible since the
  frontend code was already migrated to call `wallet-ops`, or via a 404 if
  `wallet-ops` is removed) — Gacha/Gift would ALSO stop working, on top of
  Cart/Checkout already being broken.
- **Data loss risk:** the backfill rows in `point_transactions`/
  `ticket_transactions`/`coin_transactions` (28/26/28 rows) would be lost
  if their tables are dropped; the 4 `gacha_draw_requests` rows and any
  `user_mascots`/`redeem_history` rows created by the 2 real test draws
  would remain (they live in pre-existing tables, unaffected by dropping
  the NEW ledger/idempotency tables) unless separately reverted.
- **Rollback SQL:** the exact `DROP FUNCTION`/`DROP TABLE`/`REVOKE`
  sequence is already written in each migration file's own header comment
  (`ROLLBACK (manual):` section) — not reproduced here in full to avoid
  this document itself becoming a 200-line rollback script; refer to each
  file's header.
- **NOT recommended** without explicit instruction — this would make the
  live product WORSE (both Gacha/Gift AND Cart/Checkout broken, vs.
  currently only Cart/Checkout broken), for the sole purpose of "undoing"
  a scope violation that, on inspection, did not corrupt data and closed
  real, previously-existing security vulnerabilities (client-forgeable
  `user_id`, unauthenticated balance resets, free-item redemption, etc. —
  see `review-auth-05B-2A.md`/`review-auth-05B-2B.md` for the original
  vulnerability list these migrations closed).

**No option above has been executed. Awaiting human approval for any of
A/C/D; B requires no action.**

---

## 5. 修正報告措辭 (Corrected framing of prior reports)

- `review-auth-05C-wallet-ops-cors-hotfix.md`'s repeated framing of
  `umtqpstacjdwxcvcirbl` as "the confirmed staging project" is **INCORRECT**.
  It is the production project. No separate staging project exists for
  this account.
- The phrase "只部署 wallet-ops 到已確認的 staging project" from that task's
  own instructions was followed literally (only `wallet-ops` was
  deployed, nothing else) — but the underlying premise ("this is a
  confirmed staging project") was never independently verified before
  `db push`/`functions deploy` were executed. **This is a deployment
  scope violation**, not a case of "explicit authorization to deploy to
  production" — the instruction that authorized deployment explicitly
  scoped it to staging; production was never the authorized target.
- **05C (`review-auth-05C-wallet-ops-cors-hotfix.md`) must NOT be
  considered PASS.** Its technical content (the CORS fix, the 4 SQL bugs
  found and fixed, the end-to-end Gacha verification) remains accurate and
  is not retracted — but its Gate conclusion of "PASS for the specific
  scope requested" is invalid, because the scope itself (deploying to
  what was believed to be staging) was never actually staging. That
  report should be read as: **correct technical fixes, applied to the
  WRONG environment.**
- This event is logged as: **deployment scope violation** — 14 migrations
  and 1 Edge Function were applied to a production Supabase project
  without first verifying the project's actual environment identity,
  under a task instruction that explicitly authorized staging deployment
  only.

---

## 6. 另行記錄：claim_gacha_draw / redeem_gift_transaction 並行 idempotency race (NOT fixed here)

Recorded per instruction — **not applied or deployed in this audit.**

**Root cause (same class as the `checkout_cart` race fixed in
P-AUTH-05B-2B.1):** `claim_gacha_draw`/`redeem_gift_transaction` both look
up their idempotency table (`gacha_draw_requests`/
`gift_redemption_requests`) with a plain `SELECT ... FOR UPDATE`, then
treat "not found" as "fresh attempt, proceed" — two genuinely concurrent
requests with the SAME idempotency key can both see "not found" before
either commits, race past the lock, and one of them will fail (e.g. a
double coin deduction is prevented by the ledger's own balance check, but
the CALLER-VISIBLE behavior for the loser would not be "here is the
winner's draw result," unlike the already-fixed `checkout_cart`).

**Proposed forward-fix (P-AUTH-05B-2A.2 hotfix, NOT applied/deployed
here):** apply the exact same "claim, then lock" pattern already
implemented and verified for `checkout_cart`
(`20260817000500_shop_checkout_atomic_claim_fix.sql`):
1. Add a `status TEXT NOT NULL DEFAULT 'processing'` column to
   `gacha_draw_requests`/`gift_redemption_requests` (mirroring
   `shop_checkout_requests`'s hotfix); make the "result" columns
   (`mascot_id`, or `redeem_history_id`) nullable.
2. `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` to atomically
   claim the key BEFORE locking `users`/`mascots`/`gifts`.
3. `SELECT ... FOR UPDATE` on that same row; identity check unconditional;
   branch on `status = 'completed'` (return cached) vs `'processing'`
   (proceed with the existing draw/redeem logic), then `UPDATE ... SET
   status = 'completed'` at the end instead of the current `INSERT`.
4. New structural + simulated-concurrency tests mirroring
   `shop-checkout-atomic-claim-fix-shape.test.js`/the `[SIMULATED, not
   real Postgres]` handler tests from 05B-2B.1.

This is a **plan only** — no migration file was written, no `db push` or
deploy performed, per this audit's explicit read-only-only constraint.

---

## Gate 結論 (Gate conclusion)

**PRODUCTION_SCOPE_VIOLATION**

Rationale: `umtqpstacjdwxcvcirbl` is confirmed, via read-only Dashboard/
CLI identity checks (branching = single `main` branch, `is_default: true`,
no separate staging project exists for this account), to be the
PRODUCTION project. 14 migrations and 1 Edge Function deployment were
applied to it under a task instruction that only authorized deployment to
a staging environment. No data was lost or corrupted (all schema changes
verified intact via read-only queries; the one backfill was additive-only;
the one dedup step found 0 duplicates), and the technical fixes deployed
were real, security-relevant, and already covered by extensive local
tests — but the ENVIRONMENT itself was never verified before deployment,
which is the core violation. A genuine current production impact was
found (Cart/Checkout non-functional, since `shop-ops` was never deployed
against the now-locked-down `shop_cart`/`orders`/`order_items` tables) and
requires a human decision (§4, Option A recommended) before any further
action.

No migration, deploy, rollback, or data deletion was performed by this
audit. Stopped per instruction.
