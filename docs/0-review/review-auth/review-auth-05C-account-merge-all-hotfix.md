# review-auth-05C-account-merge-all-hotfix.md — Points BIGINT/Overflow Hotfix

**Task:** 修正 `20260817001000_account_merge_wallet_assets.sql` 中最後一
個型別問題 (Points block still declared `v_anon_points INTEGER` with no
overflow guard, inconsistent with the Coins/Tickets blocks added by
P-AUTH-05A.2).
**Scope:** fix ONLY the Points merge block, in-place, in the same
(not-yet-applied) migration file. **No `db push`, no deploy, no
Production operation, no refactor, no new migration file.**

---

## 一、根因

`20260817001000_account_merge_wallet_assets.sql` (created in P-AUTH-05A.2,
still local-only, never applied) copied the Points block **verbatim**
from the already-applied `20260816000400`, which predates the discovery
that `users.points`/`coins`/`tickets` are all `bigint` in production.
The NEW Coins/Tickets blocks (added by the same task) correctly used
`BIGINT` local variables plus an explicit `> 2147483647` range guard
before casting to `apply_coin_transaction`/`apply_ticket_transaction`'s
`INTEGER` parameter — but the Points block was left with the OLD,
un-guarded `v_anon_points INTEGER` pattern, an inconsistency flagged (but
not fixed, as explicitly out of scope at the time) in
`review-auth-05A.2-account-merge-wallet-assets.md`'s own §四. Since
`20260817001000` has never been applied to any database, it was safe and
correct to fix this in place rather than create a third migration file.

---

## 二、修正內容 (Points block only)

**1. `v_anon_points` declaration** — changed from `INTEGER` to `BIGINT`,
matching `users.points`'s real column type (and now identical in shape to
`v_anon_coins`/`v_anon_tickets`):
```sql
v_anon_points BIGINT := 0;
```

**2. Range guard added**, immediately after the existing
`IF v_anon_points IS NOT NULL AND v_anon_points > 0 THEN` zero-balance
skip, mirroring Coins/Tickets exactly:
```sql
IF v_anon_points > 2147483647 THEN
    RAISE EXCEPTION 'finalize_account_merge: anonymous account points balance % exceeds the ledger''s INTEGER range, cannot merge safely', v_anon_points;
END IF;
```

**3. Transfer-out cast:**
```sql
PERFORM public.apply_point_transaction(v_claim.anonymous_user_id, (-v_anon_points)::INTEGER, 'account_merge_transfer_out', v_claim.id);
```

**4. Transfer-in cast:**
```sql
PERFORM public.apply_point_transaction(p_existing_user_id, v_anon_points::INTEGER, 'account_merge_transfer_in', v_claim.id);
```

**5. Zero points skip** — unchanged, still `IF v_anon_points IS NOT NULL
AND v_anon_points > 0 THEN` (a zero/`NULL` balance still does nothing).

**6. No raw `UPDATE users SET points`** — confirmed absent (never existed
in this block; only `apply_point_transaction` touches the column).

**7. Same transaction as coins/tickets/mascot** — unchanged: everything
still lives inside the ONE `finalize_account_merge` PL/pgSQL function
body (a single implicit transaction).

**8. Rollback on any failure** — unchanged: the claim-`used` UPDATE and
`account_merge_requests` INSERT remain the LAST two statements,
structurally after ALL of cart/mascot/redeem/points/coins/tickets.

**9. Resend does not re-credit** — unchanged: the canonical-idempotency
lookup + early `RETURN v_existing_request` (Step 3) still runs before
reaching the Points block (or any other merge block) at all.

**Also updated:** the migration file's own header comment now accurately
describes this hotfix and explicitly retracts the now-stale claim that
"the Points block is left exactly as-is" (from the original P-AUTH-05A.2
version) — the Points block is **no longer byte-identical** to
`20260816000400`'s original (only Cart/Mascot/RedeemHistory remain
byte-verbatim), which is now stated plainly rather than left
contradicted by an outdated comment.

**`20260817000900` and `20260816000400` remain completely untouched** —
this hotfix only edited `20260817001000` (itself still unapplied), per
the explicit constraint.

---

## 三、新增測試

Extended
`supabase/migrations/__tests__/account-merge-wallet-assets-shape.test.js`
(19 → 23 tests; several existing tests were also widened to cover Points
alongside Coins/Tickets rather than being left coins/tickets-only):

| Requested check | Test |
|---|---|
| `v_anon_points` 宣告為 BIGINT | `finalize_account_merge (hotfix): v_anon_points is declared BIGINT ...` |
| range guard 在 cast 之前 | `finalize_account_merge (hotfix): the points range guard runs BEFORE the ::INTEGER casts ...` |
| 不存在 `INTEGER v_anon_points` | Same test above also asserts `assert.doesNotMatch(WALLET_ASSETS_SQL, /v_anon_points INTEGER/)` |
| points out/in 順序正確 | `finalize_account_merge: points/coins/tickets are each deducted from the anonymous account BEFORE being added ...` (widened from a coins/tickets-only test to include points) |
| 超過 INTEGER 範圍時整筆 merge 失敗 | `[SIMULATED] points balance exceeding INTEGER range raises BEFORE any ledger call for that asset ...` + `[SIMULATED] a coins/tickets overflow behaves identically ...` (both explicitly note, per this repo's established simulated-test-limitation convention, that a JS simulation cannot itself prove a real Postgres transaction rolls back — it proves the guard fires before ANY mutation for that asset, matching where the real SQL's `RAISE EXCEPTION` sits) |
| 完整 verify-local 通過 | See below |

Also widened (to include Points, not just Coins/Tickets):
- The stable-`v_claim.id`-reference-id test (now checks
  `apply_point_transaction` too — exactly 2 calls, both referencing
  `v_claim.id`).
- The zero-balance-skip test (now checks
  `IF v_anon_points IS NOT NULL AND v_anon_points > 0 THEN` too).
- The "no raw `UPDATE users SET <asset>`" test (now checks `points` too).
- The BIGINT+range-check+explicit-cast test (now checks all three assets
  symmetrically instead of only coins/tickets).

**Full local suite:**
```
.\scripts\verify-local.ps1
tests 683
pass 683
fail 0
```
(660 pre-P-AUTH-05A.2 baseline + 23 total in this test file, all green.)

---

## 四、輸出範圍確認

- **No `db push` was executed.**
- **No Edge Function was deployed.**
- **No Production data was read, written, or operated on** — this task
  involved zero Supabase CLI/API calls at all, purely local file edits
  and `node --test`/PowerShell script runs.
- **No new migration file was created** — `20260817001000` was edited
  in place (still unapplied, so this was explicitly permitted).
- **`20260817000900` (applied) and `20260816000400` (applied) remain
  untouched.**
- **Account Merge's overall design was not refactored** — only the
  Points block's variable type/cast/guard changed; the claim lifecycle,
  email-binding check, idempotency computation, and Cart/Mascot/
  RedeemHistory logic are all unchanged.

---

## Gate 結論

**SAFE_TO_APPLY**

The last remaining type inconsistency in the not-yet-applied
`20260817001000_account_merge_wallet_assets.sql` (Points using the
old, un-guarded `INTEGER` pattern while Coins/Tickets already used the
safer `BIGINT`+range-guard pattern) has been fixed in place. All three
wallet assets (points/coins/tickets) now share byte-for-byte identical
overflow handling, idempotency-reference, ordering, and rollback
guarantees. 4 new tests plus 5 widened existing tests (23 total in the
file) cover every requested check; the full local suite passes
(683/683). No `db push`, deploy, or Production operation was performed,
per this task's explicit scope.

---

**完成後停止，未執行 `db push` 或 deploy。**
