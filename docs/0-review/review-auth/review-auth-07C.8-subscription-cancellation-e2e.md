# review-auth-07C.8-subscription-cancellation-e2e

Auth-07C.8：PayPal Sandbox 取消自動續訂完整 E2E。

前置：07C.1A／07C.2／07C.4／07C.6／07C.7F review docs（已閱）。
基準：07C.7F PASS（ACTIVE monthly、paid_through=2026-10-07T10:00:00Z、tx=1、slot OCCUPIED）。

```text
Gate: PASS
```

```text
Code Changed: NO（僅新增唯讀驗證 harness scripts/auth-07c8-cancel-e2e/，沿用 07C.7B/7F 慣例）
Manual Database Mutation: NO
Migration/DB Push: NONE
Function Deployment: NONE
Secrets Changed: NO
Commit/Push: NO
```

---

## 1. Preflight snapshot（取消前，唯讀）

| 項目 | 值 |
|---|---|
| verify-local | **868/868 PASS** |
| Environment | sandbox（`PAYPAL_ENV` digest = sha256("sandbox") MATCH） |
| Subscription rows | **1**（monthly，ACTIVE，USD 5.00） |
| Owner | official user（`is_anonymous=false`、有 email、UID 相符；hash `bccbd955`） |
| paid_through / next_billing | 2026-10-07T10:00:00Z / 同 |
| last_payment_time | 2026-09-07T14:34:18Z |
| tx count / slot | 1 / OCCUPIED（release_after=null） |
| access_blocked_at / cancelled_at / reconciliation | null / null / resolved |

取消 API 唯讀驗證（handler＋frontend＋RPC＋部署版本 v2）全項通過：
JWT 必要、僅本人、後端 Cancel＋GET、body 僅讀 `action`、`cancelLock` 防雙擊、
UI 不提前顯示 CANCELLED、冪等 key `edge-cancel:{id}`、slot 不因 HTTP 釋放、
RPC `release_after = paid_through`（migration L1088–1090）、二次取消回 `already_cancelled`。

## 2. 人工取消授權紀錄

Preflight 通過後停止自動操作並通知；使用者親自於 UI 點擊「取消自動續訂」並二次確認，
回覆「我已點擊並確認取消自動續訂，請繼續驗證」（2026-09-10）後才開始取消後驗證。
Agent 未代按、未呼叫取消 API。

## 3. Cancel HTTP call count

| 證據 | 值 |
|---|---|
| `edge-cancel:*` 事件（每次成功 cancel mutation 產生一筆，UNIQUE key） | **1** |
| 前端 busy lock＋按鈕 disabled（程式碼驗證） | 單次 request 保證 |
| HTTP status | 200（使用者流程顯示「取消中…」→「已取消自動續訂」，無錯誤） |

## 4. PayPal 權威狀態（只 GET，未再 Cancel）

| 項目 | 值 |
|---|---|
| status | **CANCELLED** |
| status_update_time | 2026-09-10T11:11:46Z |
| billing_info.next_billing_time | **null**（不再排程扣款） |
| plan_id vs DB | **MATCH** |
| custom_id vs checkout_session_id | **MATCH** |
| subscription id vs DB | **MATCH** |
| last payment | 5.0 USD（原首期，不變） |

## 5. Signed webhook 結果

| 事件 | verification | processing | 時間 |
|---|---|---|---|
| `edge-cancel:*`（合成，Edge 取消路徑） | SUCCESS | processed | 11:11:47 |
| **WH-\*（真實 signed）BILLING.SUBSCRIPTION.CANCELLED** | **SUCCESS** | **processed** | **11:12:08** |

event id 全表唯一（`all_event_ids_unique=true`）；兩事件都對應同一 subscription（MATCH）；
signed CANCELLED 恰 1 筆；無 `PAYMENT.SALE.*` 新事件。

## 6. 本地狀態轉換

| 項目 | 取消前 → 取消後 |
|---|---|
| status | ACTIVE → **CANCELLED**（cancelled_at=2026-09-10T11:11:47Z） |
| paid_through | 2026-10-07T10:00:00Z → **不變** |
| last_payment_time | 2026-09-07T14:34:18Z → **不變** |
| tx count | 1 → **1** |
| subscription rows | 1 → **1** |
| wallet（points/coins/tickets 當日交易） | **0 筆**（不變） |
| legacy payment_orders | 3 → **3** |

## 7–8. paid_through／slot 保護

- `paid_through` 未縮短、未清空、未延長（webhook 處理後仍相同）。
- slot 仍 **OCCUPIED**；`release_after = paid_through`（`release_equals_paid_through=true`）。
- `access_blocked_at = null`（權益未被立即停用）。
- 期限內第二筆訂閱：slot OCCUPIED＋`acquire_subscription_slot` 原子拒絕（07C.2A 已活庫驗證），
  UI `allowNewSubscription:false`；未實際嘗試建立（禁令）。

## 9. Transaction 冪等性

- 不再次呼叫 Cancel API；透過既有證據驗證：
  - `edge-cancel` UNIQUE 事件恰 1 筆；signed CANCELLED 恰 1 筆；event id 全表唯一。
  - `get_status` ×2（真實 Edge 呼叫，官方 session 經 admin magiclink 鑄造）：回應**完全相同**、
    status CANCELLED、paid_through 不變；之後 DB 再查 tx 仍 1、slot 仍 OCCUPIED。
  - 重複 event fixture 的既有 mock 測試包含於 868 全套（07C.4）。

## 10. UI Refresh／Mobile E2E

- **View-model 對映**（07C.6 tests 覆蓋）：CANCELLED＋期限內 → `cancelled_with_access`：
  headline「已取消自動續訂」、detail「可使用至 2026-10-07（當地時區顯示）。到期前無法建立第二張訂閱。」、
  Plan／Pay／Cancel 按鈕全隱藏。`get_status` 權威 payload 正是此輸入 → Refresh 後狀態可恢復
  （get_status ×2 相同即 bootstrap 恢復證明）。
- 依 07C.7F 前例，未將官方 session 注入自動化瀏覽器（避免憑證外洩路徑）；官方視圖以
  API 契約＋deterministic mapping＋使用者本人操作觀察為證。
- `localhost:5500/subscription.html` 真實載入（訪客視圖正常）；**mobile 390×844**：無水平 overflow、
  頁面完整、**console 0 error**。

## 11. 測試指令與通過數量

```text
.\scripts\verify-local.ps1 → 868 pass / 0 fail
node scripts/auth-07c8-cancel-e2e/verify.cjs → 全步驟 PASS（唯讀；log: verify.jsonl）
```

## 12–14. 聲明

- 未修改程式／migration／Secrets／Webhook 設定／PayPal Product、Plan；未 db push；未部署 Function。
- 未手動 UPDATE 任何資料列；未建立新 Subscription／Order；未執行新付款；未測退款。
- 未 commit／push。
- 全部 ID 以 prefix6／sha8 遮罩；無 Email、JWT、token、Secret 出現於本文件或 log。

---

## Auth-07C.8 Result

```text
Auth-07C.8 Result:
Environment: sandbox
Preflight Tests: 868/868 PASS
Subscription Before: ACTIVE monthly USD 5; paid_through 2026-10-07T10:00:00Z; tx 1; slot OCCUPIED
Manual Cancellation Approved: YES
Cancel HTTP Calls: 1
Cancel HTTP Status: 200
PayPal Status After: CANCELLED (status_update_time 2026-09-10T11:11:46Z; next_billing null)
Local Status After: CANCELLED (cancelled_at 2026-09-10T11:11:47Z)
Signed Cancellation Webhook: RECEIVED (WH-*, verification SUCCESS, 11:12:08)
Webhook Processing: processed (edge-cancel + signed WH both; event ids unique)
Paid-through Before: 2026-10-07T10:00:00Z
Paid-through After: 2026-10-07T10:00:00Z
Paid-through Preserved: PASS
Release-after: 2026-10-07T10:00:00Z (= paid_through)
Slot After Cancellation: OCCUPIED
Transaction Count Before/After: 1 / 1
Duplicate Cancellation: NO
Duplicate Transaction: NO
Access Blocked: NO
Second Subscription Created: NO
Frontend Cancelled State: PASS (get_status contract + 07C.6 view-model mapping + user-observed flow)
Refresh Recovery: PASS (get_status x2 identical)
Mobile E2E: PASS (390x844, no overflow, 0 console errors)
Code Changed: NO
Manual Database Mutation: NO
Migration/DB Push: NONE
Function Deployment: NONE
Secrets Changed: NO
Commit/Push: NO
Gate: PASS
```

完成後停止。未測試到期後 slot release、未建立下一筆訂閱（屬後續 Gate）。
