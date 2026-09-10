# review-auth-07C.7C-sale-webhook-delivery

Auth-07C.7C：`PAYMENT.SALE.COMPLETED` Delivery Audit＋**一次**官方 Resend。

前置：`docs/0-review/review-auth/review-auth-07C.7B-paid-through-diagnostic.md`

```text
Gate: FAIL_DELIVERY
```

```text
Conditional Resend Performed: YES (count=1)
Manual Database Mutation: NO
Payment Attempted: NO
Subscription Cancelled: NO
Code Changed: NO
Deployment Performed: NO
Commit/Push Performed: NO
Duplicate Subscription: NO
Duplicate Transaction: NO
```

---

## 1. Webhook 設定（唯讀）

| 檢查 | 結果 |
|---|---|
| Webhook 數量 | **1**（無第二個） |
| ID vs 07C.5 | **MATCH**（prefix `4XX590…`，sha8 `f582b0e7`） |
| URL vs 07C.5 | **MATCH**（sha8 `7c9bd465`） |
| `PAYMENT.SALE.COMPLETED` 訂閱 | **YES**（16 event types 含 SALE＋subscription lifecycle） |
| CREATED／ACTIVATED 訂閱 | YES |

→ **非** `BLOCKED_WEBHOOK_CONFIG`／`SALE_EVENT_NOT_SUBSCRIBED`。

---

## 2. PayPal event history（14:30Z–14:45Z）

| 檢查 | 結果 |
|---|---|
| `PAYMENT.SALE.COMPLETED` 找到 | **YES**（event prefix `WH-8HW…`，sha8 `f8d3804e`） |
| create_time | `2026-09-07T14:34:22.729Z` |
| resource.id（sale） | **MATCH** GET transactions sale（prefix `52H380…`） |
| billing_agreement_id | **MATCH** subscription（prefix `I-9FMN…`） |
| amount／currency | **5.00／USD MATCH** |
| 依 transaction_id 交叉查詢 | 同一 event |
| API `status` 欄位 | **null**（無 PENDING／DELIVERED 明示） |
| 原始 delivery HTTP／attempts | **API 未提供**（僅有 self／resend links） |

分類（Resend 前）：

```text
B. Event 存在但本地無列 → DELIVERY_FAILED
```

（非 A：event 存在；非 D：非 PENDING。）

---

## 3. 條件式官方 Resend（一次）

全部滿足：

- event_type = `PAYMENT.SALE.COMPLETED`
- sale ID／subscription ID／USD 5.00 MATCH
- webhook URL MATCH
- 本地仍無 SALE transaction／webhook 列
- 非 pending delivery

執行：

```text
POST /v1/notifications/webhooks-events/{event_id}/resend
body: { webhook_ids: [<same webhook id>] }
→ HTTP 202 Accepted
Resend Count: 1
```

未自行 POST payload；未重送 CREATED／ACTIVATED；未第二次 Resend。

---

## 4. Resend 後驗證（+20s／+60s）

| 檢查 | 結果 |
|---|---|
| `payment_webhook_events` SALE 列 | **仍 0** |
| `paypal_subscription_transactions` | **仍 0** |
| `paypal_subscriptions.status` | ACTIVE（未變） |
| `last_payment_time` | **null** |
| `paid_through` | **null** |
| `next_billing_time` | `2026-10-07T10:00:00Z` |
| `reconciliation_status` | none |
| `access_blocked_at` | null |
| slot | **OCCUPIED**（單列） |
| subscription 列數 | **1** |

前端語意：仍為「首期付款確認中」（`ACTIVE` + `paid_through` null）— 本 Gate **未**再點付款／取消。

---

## 5. 結論

```text
Root Cause: DELIVERY_FAILED (Resend accepted; no local persist)
Gate: FAIL_DELIVERY
```

PayPal 已產生且可官方 Resend 的 SALE event；設定已訂閱 SALE.COMPLETED；Resend 回 **202**，但觀測窗內 **未**出現本地 webhook／transaction／`paid_through` 更新。

下一階段（本 Gate **不做**）：需調查 Edge 是否收到 SALE（平台 logs／超時）、簽名失敗（失敗不寫庫）、或 handler 早退；並／或實作 GET transactions reconciliation fallback。**禁止**手動 SQL 寫入 `paid_through`。

---

## Auth-07C.7C Result

```text
Auth-07C.7C Result:
Webhook Config Contains SALE.COMPLETED: YES
Webhook ID/URL Match: YES
PayPal SALE Event Found: YES
Sale ID Match: YES
Subscription ID Match: YES
Amount/Currency Match: YES (5.00 USD)
Original Delivery Status: unknown (API null; event existed, not in DB)
Original Delivery HTTP Status: unknown
Original Delivery Attempts: unknown
Conditional Resend Performed: YES
Resend Count: 1
Resend Delivery Status: 202 Accepted; no DB event within ~60s
Database Webhook Found: NO
Webhook Signature: N/A
Webhook Processing: N/A
Transaction Count: 0
Database Status: ACTIVE
Last Payment Time: null
Paid-through: null
Next Billing Time: 2026-10-07T10:00:00Z
Slot State: OCCUPIED
Frontend State: awaiting_first_payment (首期付款確認中)
Duplicate Subscription: NO
Duplicate Transaction: NO
Manual Database Mutation: NO
Payment Attempted: NO
Subscription Cancelled: NO
Code Changed: NO
Deployment Performed: NO
Commit/Push Performed: NO
Root Cause: DELIVERY_FAILED
Gate: FAIL_DELIVERY
```
