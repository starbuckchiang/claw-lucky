# review-auth-07B.2.4A-payment-failure-diagnostic

Auth-07B.2.4A：付款失敗唯讀診斷（「付款失敗，請重試。」）。

```text
Gate: PASS
```

```text
read-only: YES
re-create order: NO
re-capture: NO
code changed: NO
deploy: NO
DB mutated: NO
commit/push: NO
```

---

## 一、前端證據（sanitize）

| 項目 | 結果 |
|---|---|
| UI | `付款失敗，請重試。`（`onError` 固定文案） |
| Console | PayPal SDK `create_order_error` → `PAYPAL_CREATE_ORDER_FAILED: PayPal create order failed.` |
| Console | `unhandled_error` / `click_initiate_payment_reject`（同源 create 失敗） |
| Stack | `subscription-entry.js` `createOrder` throw → SDK `onError` |
| Latest `POST …/paypal-checkout` | **#62** |
| Request `action` | **`create-order`** |
| Body（sanitize） | `planCode=monthly`；有 `idempotencyKey`；**無** amount／userId |
| HTTP status | **502** |
| Error code | **`PAYPAL_CREATE_ORDER_FAILED`** |
| Message | `PayPal create order failed.` |
| Callback | **`createOrder` 失敗 → `onError`**（**未**進 `onApprove`／**未** `onCancel`） |
| Create calls（本次嘗試） | **1**（#62） |
| Capture calls（本次嘗試） | **0** |
| Authorization | **有** `Authorization: Bearer …`（authenticated session；**不**輸出 token／Email） |
| 舊請求對照 | #56 為先前 `capture-order`（舊單 `90T780…`）`MERCHANT_MISMATCH`，**非**本次 |

---

## 二、資料庫（唯讀）

### 最新 `payment_orders`（本使用者前綴 `5020bf33`）

| 欄位 | 本次新單 | 歷史舊單（對照） |
|---|---|---|
| id | `1932563b-283c-4ea4-be44-5f2e03b6b441` | `cdce5c79-3025-4b4c-92d7-4caa12608d6d` |
| user_id | `5020bf33…`（遮罩） | 同 |
| plan_code | monthly | monthly |
| amount / currency | 5.00 / USD | 5.00 / USD |
| status | **`failed`** | `failed` |
| paypal_order_id | **`null`** | `90T780620H780851Y` |
| paypal_capture_id | **null** | null |
| failure_code | **欄位不存在（N/A）** | N/A |
| capture_request_id | null | 有（舊 capture 路徑） |
| created_at → updated_at | `10:27:48Z` → `10:27:50Z`（~2s） | 較早 |

開放 monthly（created／approved／capture_pending）：**0**

### `payment_webhook_events`（近 30 分鐘）

**0 筆**（本次 create 未取得 PayPal order id，無新 webhook）。

歷史 COMPLETED／APPROVED 事件仍屬舊單 `90T780…`，與本次無關。

---

## 三、判定分支

```text
C. payment_orders = failed
```

補充：

- **不是** `MERCHANT_MISMATCH`（本次停在 **create-order**）。
- **不是** A（paid）／B（capture_pending+capture_id）。
- 有新內部列但 **`paypal_order_id` 為空** → Edge 已建 internal row，呼叫 PayPal Create Order 失敗後 `transitionStatus → failed`（與 handler catch 行為一致）。
- **未**完成 Capture；**未**扣款證據。

```text
Failure Classification: PAYPAL_CREATE_ORDER_FAILED (create-order stage; no PayPal order id attached)
```

---

## 四、PayPal GET Order

**未執行**（無 `paypal_order_id`；且限制禁止 capture）。

| 項目 | 結果 |
|---|---|
| PayPal Order Status | N/A |
| Capture ID Exists | NO（DB） |
| Capture Status | N/A |
| Merchant Validation | **NOT_CHECKED** |

---

## 五、Safe To Retry

```text
Safe To Retry Payment: YES
```

理由：本次無 PayPal order／capture；DB 為 `failed` 且無開放 monthly；未觀察到扣款或 webhook COMPLETED。  
重試前建議：**重新整理 subscription 頁**（避免沿用舊 PayPal Buttons session／idempotency 時間戳），再走 Buyer Sandbox。  
本診斷 **不**重試、**不**修碼。

---

## 六、與 Auth-07B.2.4 關係

- `paypal-checkout` v4 已部署；本次 E2E **未**完成付款。
- 07B.2.4 Gate 應視為 **未通過／中止於 create-order**；細節以本 07B.2.4A 為準。
- 歷史假陰性單 `90T780620H780851Y`：**未**突變。

```text
Auth-07B.2.4A Result:
Frontend Callback: onError (after createOrder failure; onApprove not reached)
Checkout HTTP Status: 502
Checkout Error Code: PAYPAL_CREATE_ORDER_FAILED
Create Calls: 1
Capture Calls: 0
Database Order Found: YES (1932563b-283c-4ea4-be44-5f2e03b6b441)
Database Status: failed
PayPal Order Status: N/A (paypal_order_id null)
Capture ID Exists: NO
Capture Status: N/A
Webhook Event Found: NO (for this attempt)
Merchant Validation: NOT_CHECKED
Safe To Retry Payment: YES
Failure Classification: PAYPAL_CREATE_ORDER_FAILED_AT_CREATE_ORDER
Code Changed: NO
Deployment Performed: NO
Database Mutated: NO
Commit/Push Performed: NO
Gate: PASS
```
