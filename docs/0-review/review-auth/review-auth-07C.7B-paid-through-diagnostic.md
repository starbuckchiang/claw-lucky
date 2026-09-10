# review-auth-07C.7B-paid-through-diagnostic

Auth-07C.7B：`ACTIVE` 但 `paid_through` 空白 — **唯讀診斷**（未修碼、未重送 webhook、未取消、未再付款）。

```text
Gate: PASS
```

```text
Code Changed: NO
Database Mutated: NO
Deployment Performed: NO
Commit/Push Performed: NO
Safe To Create Another Subscription: NO
Safe To Pay Again: NO
Safe To Cancel: NO
```

---

## 1. 資料庫（official test user prefix `5020bf33…`）

### `paypal_subscriptions`（恰好 1 筆）

| 欄位 | 值（遮罩） |
|---|---|
| status | **ACTIVE** |
| plan_code | monthly |
| recurring_amount／currency | 5／USD |
| paypal_subscription_id | present（prefix `I-9FMN…`，len 14） |
| start_time | **null** |
| next_billing_time | `2026-10-07T10:00:00Z`（present） |
| last_payment_time | **null** |
| paid_through | **null** |
| reconciliation_status | `none` |
| access_blocked_at | null |
| checkout_session_id | present（prefix `bd68e4…`） |
| created_at | `2026-09-07T14:33:31Z` |
| updated_at | `2026-09-07T14:34:30Z` |

### `user_subscription_slots`

| 欄位 | 值 |
|---|---|
| slot_state | **OCCUPIED** |
| subscription_id | 指向上述列（prefix `bd18ad…`） |

### `paypal_subscription_transactions`

**0** 列（無 SALE／completed transaction）。

### `payment_webhook_events`（與本訂閱相關）

| event_type | verification | processing | sub id | sale id | received_at |
|---|---|---|---|---|---|
| `BILLING.SUBSCRIPTION.CREATED` | **SUCCESS** | **processed** | MATCH `I-9FMN…` | — | `14:34:23Z` |
| `BILLING.SUBSCRIPTION.ACTIVATED` | **SUCCESS** | **processed** | MATCH `I-9FMN…` | — | `14:34:30Z` |
| `PAYMENT.SALE.COMPLETED` | — | — | — | — | **不存在** |

全表亦無任何 `PAYMENT.SALE.*`。  
無 `pending_resolution`／`reconciliation_pending`／failed subscription SALE 列。  
（另有舊 Orders `CHECKOUT.ORDER.*`／`PAYMENT.CAPTURE.*` 共 4 筆，與本訂閱無關。）

---

## 2. PayPal 唯讀（GET only）

`GET /v1/billing/subscriptions/{id}` + `.../transactions`（建立日→現在）

| 檢查 | 結果 |
|---|---|
| environment | sandbox API |
| subscription status | **ACTIVE** |
| plan_id | prefix `P-5KH0…`（monthly allowlist **MATCH**） |
| custom_id | MATCH checkout_session_id（prefix `bd68e4…`） |
| next_billing_time | `2026-10-07T10:00:00Z` |
| last_payment | time `2026-09-07T14:34:18Z`；amount **5.0**／**USD** |
| completed transactions | **1**（status COMPLETED；amount 5.00 USD；sale id present prefix `52H380…`） |
| Merchant/App | OAuth／plan allowlist MATCH（未 dump payer PII） |

未呼叫 cancel／capture／revise／suspend／activate。

---

## 3. Webhook 判定

- Edge CLI `functions logs` 本環境不可用；以 **DB webhook 列**為權威「是否收到」。
- Subscription lifecycle webhooks（CREATED／ACTIVATED）**有到達**且簽名 **SUCCESS**、已 **processed** → webhook URL／訂閱事件訂閱大致可用。
- **`PAYMENT.SALE.COMPLETED` 從未寫入 DB**（儘管 07C.5 已將該 event type 加入 webhook 訂閱清單）。
- 因此無法驗證本 SALE 的 signature／merchant／RPC 路徑 — 事件根本未進入處理管線。
- 非 `pending_resolution`（那需要先有 SALE 列）。

時間線（sanitize）：

```text
14:33:31Z  DB session/slot created
14:34:18Z  PayPal SALE COMPLETED (USD 5) — seen via GET transactions
14:34:23Z  BILLING.SUBSCRIPTION.CREATED webhook processed
14:34:30Z  BILLING.SUBSCRIPTION.ACTIVATED webhook processed → DB status ACTIVE
           paid_through 仍 null（設計：僅 SALE.COMPLETED 延長權益）
```

前端「首期付款確認中」與 `ACTIVE` + `paid_through=null` **一致**（非 UI 誤判）。

---

## 4. 根因分類

**A.** PayPal 已有 completed sale，DB 無 SALE webhook  

```text
Root Cause: WEBHOOK_NOT_RECEIVED_OR_NOT_SUBSCRIBED
```

說明：PayPal 側首期付款已完成；本地缺 `PAYMENT.SALE.COMPLETED` 投遞／入庫，故無 transaction、`paid_through`／`last_payment_time` 未更新。  
（CREATED／ACTIVATED 已到，故較像 **SALE 事件未送達或尚未送達**，而非整個 webhook 端點掛掉；本 Gate **不** resend／偽造。）

非 B／C／D／E／F：無 pending_resolution、無 reconciliation_pending、無 SALE processing failed、PayPal 並非無 sale、DB 亦無 completed tx。

---

## Auth-07C.7B Result

```text
Auth-07C.7B Result:
PayPal Subscription Status: ACTIVE
Plan Validation: MATCH (monthly / P-5KH0…)
Custom ID Validation: MATCH
Next Billing Time: YES (2026-10-07T10:00:00Z)
PayPal Last Payment: YES (2026-09-07T14:34:18Z, USD 5.0)
PayPal Completed Sale: YES (1 COMPLETED)
Database Subscription Status: ACTIVE
Database Transaction Found: NO
SALE Webhook Found: NO
Webhook Signature: N/A for SALE (CREATED/ACTIVATED = SUCCESS)
Webhook Processing: CREATED/ACTIVATED processed; SALE absent
Pending Resolution: NO
Reconciliation Pending: NO
Last Payment Time: null (DB)
Paid-through: null
Access Blocked: NO
Root Cause: WEBHOOK_NOT_RECEIVED_OR_NOT_SUBSCRIBED
Safe To Create Another Subscription: NO
Safe To Pay Again: NO
Safe To Cancel: NO
Code Changed: NO
Database Mutated: NO
Deployment Performed: NO
Commit/Push Performed: NO
Gate: PASS
```
