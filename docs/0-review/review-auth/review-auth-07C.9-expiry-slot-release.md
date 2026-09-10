# review-auth-07C.9-expiry-slot-release

Auth-07C.9：Cancelled Subscription Expiry and Slot Release Verification。

前置：07C.2／07C.2A／07C.6／07C.7F／07C.8 review docs（已閱）。

```text
Gate: PASS
```

```text
Real Sandbox Subscription Mutated: NO
Payment Attempted: NO
Database Push: NONE
Functions Deployed: NONE
Secrets Changed: NO
Commit/Push: NO
Clock Modified: NO
```

---

## 1. 測試方式與 rollback 證據

- **Harness**：linked remote PostgreSQL 之 `BEGIN … ROLLBACK` 單交易 fixture
  （`scripts/auth-07c9-expiry/fixture.sql`，經 `supabase db query --linked -f` 執行）＋
  純函式 view-model 單元測試（注入 `nowMs`，不動時鐘）。
- **隔離**：所有 fixture 列使用 `user_id LIKE '07c9-fx-%'`（不存在的假使用者），
  與真實使用者零交集；交易內含 `REAL_unchanged_in_txn` 斷言（真實列 EXCEPT 快照 = 0 差異，
  `identical=true`）。
- **Rollback 證明**：交易外唯讀複查 — fixture 殘留列 **0**、真實 subscription snapshot
  （CANCELLED／paid_through 2026-10-07T10:00:00Z／last_payment 2026-09-07T14:34:18Z／
  tx 1／slot OCCUPIED／release_after=paid_through／released_at null／access_blocked null）
  **與執行前完全相同**。
- 未以 UPDATE 修改真實 subscription 模擬到期；未偽造 webhook；未呼叫 PayPal。

## 2–5. 情境結果（rollback fixture 實測，真 RPC 於真 Postgres 執行）

| 情境 | release RPC 回傳 | 最終 slot | 備註 |
|---|---|---|---|
| S1 CANCELLED＋paid_through 未來 | **FALSE** | **OCCUPIED** | access allowed（paid_through > now）；到期前不釋放 |
| S2 CANCELLED＋release_after = now（邊界） | **TRUE** | **RELEASED** | 邊界規則固定：`release_after <= now()` 即 due（**含等於**；RPC 條件 `> NOW()` 才擋） |
| S3 CANCELLED＋paid_through 已過 | **TRUE** | **RELEASED**（released_at set） | access denied；subscription row 完全未被 release 修改（paid_through／updated_at／access_blocked 全同） |
| S4 release_after = NULL | **FALSE** | **OCCUPIED** | 安全行為：null 永不自動釋放 |
| S5 ACTIVE（即使 release_after 已過） | **FALSE** | **OCCUPIED** | ACTIVE 受保護，交由付款失敗／同步流程 |
| S6 SUSPENDED | **FALSE** | **OCCUPIED** | 依 07C.1A 維持 blocking |
| S7 EXPIRED＋已過 | **TRUE** | **RELEASED** | 允許狀態正確釋放 |

（同語句 slot_state 子查詢會讀到更新前 snapshot——已另以獨立語句 POSTREAD 重讀，
上表「最終 slot」以 POSTREAD 為準。）

## 6. 重複 release 冪等性（S8）

第二次 `release_subscription_slot_if_due` 回傳 **FALSE**、slot 仍 RELEASED、
`released_at` **未變**（`released_at_unchanged=true`）— 無重複 mutation、無重複 slot 列
（`user_id` 為 PK，結構上不可能重複）。

## 7. Release 後重新訂閱資格（S9／S9b）

- S9：釋放後 `acquire_subscription_slot('07c9-fx-s3','monthly',…)` 成功 —
  回傳新 `checkout_session_id`、建立新 `APPROVAL_PENDING` row、slot 重新 OCCUPIED；
  **舊 CANCELLED row 保留**（該 user 共 2 列，audit 不刪除）。
- S9b：對仍 OCCUPIED 的 user（S1）acquire → **RAISE `SUBSCRIPTION_SLOT_OCCUPIED`**，
  期限內不可建第二筆訂閱（防護與 07C.8 一致）。
- 未建立真實 PayPal subscription（fixture 已 rollback；Edge／PayPal 均未呼叫）。

## 8. UI mapping（scenario 10）

新增 `js/services/subscription/__tests__/paypal-subscription-expiry-view.test.js`（5 tests，
注入 `nowMs` 決定性驗證 `resolveSubscriptionUiState`）：

| 輸入 | 結果 |
|---|---|
| CANCELLED＋now < paid_through | `cancelled_with_access`：「已取消自動續訂」＋「可使用至 …」；Plan／Pay／Cancel 全隱藏；`allowNewSubscription=false` |
| CANCELLED＋now == paid_through（邊界） | `expired`（`paidOk` 要求嚴格未來 `ms > nowMs`）→ 顯示方案 — 與 DB 邊界（等於即 due）方向一致 |
| CANCELLED＋now > paid_through | `expired`：「訂閱已結束」＋重新顯示月訂／年訂；`allowNewSubscription=true` |
| Refresh 一致性 | 純函式：同輸入兩次呼叫 deep-equal（到期前後各驗一次） |
| subscription = null（釋放後 get_status 無列） | `none`：顯示方案按鈕 |

## 9. 真實 subscription 未修改證據

交易內 `REAL_unchanged_in_txn identical=true` ＋ 交易外複查（§1）：
狀態、paid_through、last_payment_time、access_blocked、tx count（1）、sub count（1）、
slot OCCUPIED、release_after、released_at null — **前後完全相同**。
wallet／points／coins／tickets／payment_orders 未被任何 fixture 語句觸及
（fixture 只寫 `paypal_subscriptions`／`user_subscription_slots` 且全部 rollback）。

## 10. 測試數量

```text
新增 paypal-subscription-expiry-view.test.js: 5 pass / 0 fail
pwsh -File scripts/verify-local.ps1: 873 pass / 0 fail（868 + 5）
Rollback fixture: 12 情境列全數符合預期（scripts/auth-07c9-expiry/fixture.sql）
```

## 11. 聲明

未付款、未部署 Function、未 db push、未改 Secrets、未 commit/push、未修改時鐘、
未修改 production 程式（僅新增 test-only harness 與測試檔）。無 production defect 發現 —
RPC 行為與 07C.1A／07C.2 設計完全一致。

---

## Auth-07C.9 Result

```text
Auth-07C.9 Result:
Preflight Tests: 868/868 PASS (873/873 after adding view tests)
Test Harness: remote BEGIN..ROLLBACK fixture (isolated 07c9-fx-% users) + pure view-model unit tests (injected nowMs)
Remote Fixture Used: YES (rollback-only)
Rollback Verified: YES (0 fixture rows left; real snapshot byte-identical)
Before Expiry Access: ALLOWED (paid_through > now; UI cancelled_with_access)
Before Expiry Slot: OCCUPIED (release RPC returns FALSE)
At Expiry Boundary: DUE inclusive (release_after <= now releases; UI paidOk requires strictly-future => expired)
After Expiry Access: DENIED (UI expired mode)
After Expiry Slot: RELEASED (released_at set; subscription row untouched)
Repeated Release Idempotency: PASS (2nd call FALSE; released_at unchanged; no duplicate slot)
Resubscribe Eligibility After Release: PASS (acquire returns new APPROVAL_PENDING session; occupied slot raises SUBSCRIPTION_SLOT_OCCUPIED)
Active Slot Protection: PASS (ACTIVE never auto-released even with past release_after)
Suspended Slot Protection: PASS (SUSPENDED stays blocking)
Historical Subscription Retained: YES (old CANCELLED row kept after resubscribe)
Historical Transactions Retained: YES (tx count 1 unchanged)
UI Before Expiry: cancelled_with_access (已取消自動續訂 + 可使用至…; plans hidden)
UI After Expiry: expired (訂閱已結束; plan buttons re-shown; refresh-consistent)
Real Sandbox Subscription Mutated: NO
Payment Attempted: NO
Database Push: NONE
Functions Deployed: NONE
Secrets Changed: NO
Commit/Push: NO
Gate: PASS
```

完成後停止。
