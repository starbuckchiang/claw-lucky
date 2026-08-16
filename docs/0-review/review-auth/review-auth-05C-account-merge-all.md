# review-auth-05A.2-account-merge-wallet-assets.md — Account Merge Coins/Tickets Minimal Reinforcement

**Task:** P-AUTH-05A.2 Account Merge Coins/Tickets 最小補強.
**Scope:** local migration + tests ONLY. **No `db push`, no deploy, no
Production data operation.** No refactor of Account Merge's overall
design; no Cart/Checkout/Gift/other-feature work.

> **Follow-up:** the Points block's own lingering `INTEGER`/no-guard
> inconsistency (flagged in this doc's §四) was fixed in place (migration
> still unapplied) in
> [review-auth-05C-account-merge-all-hotfix.md](review-auth-05C-account-merge-all-hotfix.md).
> Gate: `SAFE_TO_APPLY`.

---

## 一、根因 / 現況 (why this is needed)

`finalize_account_merge` (from the already-applied
`20260816000400_account_merge_requests_and_finalize.sql`) merges
`shop_cart`, `user_mascots`, `redeem_history`, and `points` (via the
existing points ledger) — but **`users.coins`/`users.tickets` were
explicitly out of the documented V1 scope** (see that migration's own
`excludedV1`-style framing; coins/tickets weren't even listed as
excluded, they were simply never included). This was confirmed live in
`review-auth-05C-account-merge-cors-final.md`'s successful E2E test:
`points` and mascots merged correctly, but `coins`/`tickets` correctly
stayed unchanged on the official account — expected V1 behavior, not a
bug, but an intentionally incomplete feature this task closes.

---

## 二、新 Migration

New file:
`supabase/migrations/20260817001000_account_merge_wallet_assets.sql`

Uses `CREATE OR REPLACE FUNCTION public.finalize_account_merge(...)`
(same 3-argument signature, same `public.account_merge_requests` return
type — no `DROP FUNCTION` needed) to supersede the already-applied
`20260816000400`'s function body. **`20260816000400`'s file itself is
untouched** — confirmed via a dedicated structural test.

**What changed:** the Cart/Mascot/RedeemHistory/Points blocks are copied
**byte-for-byte verbatim** from the original (confirmed via a dedicated
structural test comparing the exact block text) — only two NEW blocks
were inserted immediately after the existing Points block:

```sql
-- Coins: read as BIGINT (matches users.coins' real type), explicit
-- INTEGER-range guard before calling the (INTEGER-parameter)
-- apply_coin_transaction RPC — never an implicit/silent narrowing.
IF to_regclass('public.users') IS NOT NULL THEN
    SELECT COALESCE(coins, 0) INTO v_anon_coins
      FROM public.users
     WHERE user_id::text = v_claim.anonymous_user_id;

    IF v_anon_coins IS NOT NULL AND v_anon_coins > 0 THEN
        IF v_anon_coins > 2147483647 THEN
            RAISE EXCEPTION '... exceeds the ledger''s INTEGER range, cannot merge safely', v_anon_coins;
        END IF;

        PERFORM public.apply_coin_transaction(v_claim.anonymous_user_id, (-v_anon_coins)::INTEGER, 'account_merge_transfer_out', v_claim.id);
        PERFORM public.apply_coin_transaction(p_existing_user_id, v_anon_coins::INTEGER, 'account_merge_transfer_in', v_claim.id);
    END IF;
END IF;

-- Tickets: identical pattern to Coins above.
```

`result_json` now also includes `coinsTransferred`/`ticketsTransferred`
alongside the existing `pointsTransferred`/`cartMerged`/
`mascotsMerged`/`redeemHistoryReassigned`/`excludedV1`.

**No new table, column, policy, or RPC was created** — this migration
reuses the ALREADY-APPLIED, unmodified
`apply_coin_transaction`/`apply_ticket_transaction` ledger functions
(from `20260817000000_ticket_coin_wallet_ledger.sql`) exactly as they
already exist.

---

## 三、規則對照 (rules 1–14, each mapped to the actual implementation)

| # | Rule | Implementation |
|---|---|---|
| 1 | 讀取匿名帳號目前 points/coins/tickets | `SELECT COALESCE(coins/tickets, 0) INTO v_anon_coins/v_anon_tickets FROM public.users WHERE user_id::text = v_claim.anonymous_user_id` (points block unchanged) |
| 2 | 只能使用既有安全 ledger 函式 | Only `apply_coin_transaction`/`apply_ticket_transaction` (already-deployed, unmodified) are called — a structural test confirms NO raw `UPDATE public.users SET coins/tickets` exists anywhere in the function |
| 3 | 每種資產使用穩定唯一 idempotency key，衍生自 claim/merge request id | `v_claim.id` (the SAME existing claim row id, never freshly generated) is passed as `p_reference_id` for BOTH legs of EVERY asset (points/coins/tickets) — confirmed via a structural test asserting exactly 2 calls per ledger function, each referencing `v_claim.id` |
| 4 | 先扣匿名帳號，再加正式帳號 | Transfer-out call always precedes transfer-in call — confirmed via ordering assertion |
| 5 | 成功後匿名帳號三種餘額均為 0 | Guaranteed by construction: the transfer-out delta is always `-v_anon_<asset>` (the account's FULL current balance), so the resulting balance is always exactly `0` |
| 6 | 正式帳號得到三種餘額的精確總和 | The transfer-in delta is always `+v_anon_<asset>` (the same value just read) — `apply_*_transaction`'s own logic (`v_next = COALESCE(current,0) + delta`) computes the exact sum, never a caller-supplied/approximate value |
| 7 | user_mascots 維持既有 move/dedup 規則 | Copied verbatim, byte-identical (confirmed via structural test) — the `ON CONFLICT (user_id, mascot_id) DO UPDATE ... obtain_count = ... + EXCLUDED.obtain_count` dedup logic is completely unchanged |
| 8 | points/coins/tickets/mascot 與 account_merge_requests 同一交易 | All of it lives inside the ONE `finalize_account_merge` PL/pgSQL function body — Postgres functions execute as a single implicit transaction; nothing here opens/commits a sub-transaction |
| 9 | 任一步失敗全部 rollback | The claim-`used` UPDATE and `account_merge_requests` INSERT are the LAST two statements in the function, structurally AFTER every cart/mascot/redeem/points/coins/tickets step — any `RAISE EXCEPTION` anywhere above (including the ledger RPCs' own negative-balance guard) aborts the whole function, rolling back everything already done in it |
| 10 | 相同 claim/idempotency key 重送不得再次增加資產 | Unchanged: the canonical-idempotency-key lookup (Step 3, `SELECT * INTO v_existing_request ... IF FOUND THEN RETURN v_existing_request`) runs BEFORE reaching ANY of the merge blocks (cart/mascot/points/coins/tickets) — confirmed via ordering assertion; a resend can never re-execute a single ledger call |
| 11 | 不同 UID 不得使用他人 claim | Unchanged: the email-hash comparison (Step 2) runs for BOTH `pending` and `used` claims, BEFORE the idempotency lookup and every ledger call — confirmed via ordering assertion |
| 12 | 不修改已套用 migration，只能新增 superseding migration | `20260816000400` untouched (confirmed via structural test); only the new `20260817001000` file was created |
| 13 | 保留 SECURITY DEFINER、固定 search_path、service_role-only | All three confirmed unchanged via structural test (`SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ... FROM PUBLIC/anon/authenticated` + `GRANT ... TO service_role`) |
| 14 | 不得在前端/request body 接受資產數量 | Confirmed via structural test: the function's parameter list contains no `p_coins`/`p_tickets`/`p_points`/`p_amount`/`p_delta` — the ONLY inputs are `p_claim_token_hash`/`p_existing_user_id`/`p_existing_user_email_hash`, identical to before this change |

---

## 四、溢位與異常處理 (overflow & exception handling)

- **Confirmed live column types:** `users.points`/`users.coins`/
  `users.tickets` are all `bigint` on the real project (re-confirmed via
  read-only query this task).
- **`apply_coin_transaction`/`apply_ticket_transaction`** (already
  deployed, unmodified — changing their shared signature is out of scope
  for this "minimal reinforcement" task, since they're used by many OTHER
  callers too) declare `p_delta INTEGER`.
- **Design decision:** the two NEW blocks read the anonymous balance into
  a `BIGINT` local variable (`v_anon_coins`/`v_anon_tickets`) — never
  implicitly narrowed. Before casting to `INTEGER` for the RPC call, an
  **explicit range guard** (`IF v_anon_coins > 2147483647 THEN RAISE
  EXCEPTION ...`) runs first — an out-of-range balance raises a clear,
  named, business-level exception (rolling back the entire merge
  transaction) instead of ever silently truncating/wrapping a `bigint`
  value through an unchecked cast.
- **The pre-existing Points block's own `INTEGER`-typed `v_anon_points`
  variable is left exactly as-is** — fixing that (a pre-existing, latent,
  separate concern affecting only the ALREADY-DEPLOYED points path) is
  explicitly out of scope for this task ("不得重構 Account Merge") and is
  flagged here for awareness, not silently left undocumented.
- **No ledger error is ever swallowed:** every `apply_*_transaction` call
  uses `PERFORM` (propagates any exception unchanged); no
  `EXCEPTION WHEN ... THEN` block exists anywhere in this function that
  could catch and continue past a ledger failure.
- **No partial success is possible:** see rule 9 above — the
  claim-`used` update and request-insert are always last.

---

## 五、測試 (10 required scenarios, all covered)

New file:
`supabase/migrations/__tests__/account-merge-wallet-assets-shape.test.js`
— **19 tests**, split into two parts:

**Part A (static structural, on the migration SQL text):** unchanged
signature/hardening, ordering (claim-lock → email-check → idempotency
lookup → coins → tickets → claim-used → request-insert), transfer-out
before transfer-in, stable `v_claim.id` reference for every ledger call,
skip-when-zero guard, `BIGINT`+explicit-range-check+`::INTEGER` cast
pattern, no raw `UPDATE users SET coins/tickets`, no asset-amount
parameter on the signature, byte-verbatim Cart/Mascot/RedeemHistory
blocks, and the extended `result_json` shape.

**Part B ([SIMULATED], a plain-JS re-implementation of the documented
transfer algorithm — proves the ARITHMETIC given that algorithm, not
that the real SQL executes it; see file header for this explicit
limitation, consistent with every other simulated-test precedent in this
repo):**

| # | Required scenario | Test |
|---|---|---|
| 1 | anon coins=19, formal coins=20 → formal=39, anon=0 | `[SIMULATED] coins: anon=19, formal=20 -> formal=39, anon=0` |
| 2 | anon tickets=1, formal tickets=0 → formal=1, anon=0 | `[SIMULATED] tickets: anon=1, formal=0 -> formal=1, anon=0` |
| 3 | points 同樣正確轉移 | `[SIMULATED] points: anon=90, formal=0 -> formal=90, anon=0` + structural verbatim-copy test (unchanged, already-tested logic) |
| 4 | mascot 正確 move 與 dedup | Structural verbatim-copy test (byte-identical to the already-tested, already-applied Mascot block) |
| 5 | 同 merge request 重送，所有數值不再增加 | Structural ordering test: idempotency lookup + early `RETURN` happens BEFORE any coins/tickets/points block |
| 6 | 任一 ledger 步驟失敗，全部資產與 mascot 不變 | Structural ordering test (claim-used/request-insert always last) + `[SIMULATED]` negative-balance-guard test proving the ledger's own rejection is loud, not silent |
| 7 | 不同 UID 重用 claim 被拒絕 | Structural ordering test: email-hash check runs before the idempotency lookup and every ledger call (unchanged logic) |
| 8 | 零餘額可以正常合併 | Structural "skip when `<= 0`" guard test + `[SIMULATED] zero balance merges with no exception and no ledger entry` |
| 9 | bigint 邊界不溢位 | Structural `BIGINT` declaration + explicit `> 2147483647` range-check-before-cast test |
| 10 | 完整 verify-local 通過 | See below |

**Full local suite:**
```
.\scripts\verify-local.ps1
tests 679
pass 679
fail 0
```
(660 prior + 19 new, all green.)

---

## 六、輸出範圍確認

- **No `db push` was executed.** `20260817001000_account_merge_wallet_assets.sql`
  exists ONLY as a local file; `supabase migration list` was not even
  re-checked against remote for this task (not needed — no push was
  performed).
- **No Edge Function was deployed or modified** — `account-merge/index.ts`
  and its handler/`.ts` twins are untouched; the Edge Function already
  calls `finalize_account_merge(...)` generically and needs no code
  change to pick up the new coins/tickets behavior once this migration is
  eventually applied.
- **No Production data was read, written, or operated on** — this task's
  only Supabase interaction was a single read-only
  `information_schema.columns` query confirming `users.points`/`coins`/
  `tickets` are `bigint` (needed to design the overflow guard correctly).
- **Account Merge's overall design was not refactored** — the claim
  lifecycle, email-binding check, canonical idempotency key computation,
  and Cart/Mascot/RedeemHistory logic are all byte-identical to the
  already-applied version.

---

## Gate 結論

**SAFE_TO_APPLY**

The new migration adds Coins/Tickets to `finalize_account_merge`'s
existing atomic transaction using only the already-deployed, unmodified
ledger RPCs, preserves every existing security/idempotency/ownership
guarantee (verified structurally against the exact, unchanged ordering
and hardening of the already-applied function), adds an explicit
overflow guard for the real `bigint` column types, and is covered by 19
new tests (10 required scenarios, all satisfied) with the full local
suite passing (679/679). No `db push`/deploy/Production operation was
performed, per this task's explicit scope. A future task, if authorized,
would need to: (1) run `supabase migration list` immediately before any
push to reconfirm this is still the only pending migration, (2) apply
`db push`, (3) redeploy nothing (the Edge Function needs no change), (4)
run a real-Postgres verification (ideally reusing the exact rollback-only
`BEGIN; ...; ROLLBACK;` SQL-smoke pattern established in
`review-auth-05C.4-production-shop-uuid-hotfix.md`) before any real E2E
merge test is attempted against production.

---

**完成後停止，未執行 `db push`、deploy 或操作 Production 資料。**
