# review-auth-07B.2.4B-create-order-forensic

Auth-07B.2.4B：`PAYPAL_CREATE_ORDER_FAILED` 唯讀鑑識。

前置：`docs/0-review/review-auth/review-auth-07B.2.4A-payment-failure-diagnostic.md`

```text
Gate: PASS
```

```text
read-only: YES
new order: NO
capture: NO
code changed: NO
deploy: NO
secrets changed: NO
DB mutated: NO
commit/push: NO
```

---

## 0. 已知事實（07B.2.4A）

| 項目 | 值 |
|---|---|
| Deployed function | `paypal-checkout` **ACTIVE v4**，`verify_jwt=true` |
| Checkout HTTP | **502** |
| Error code | `PAYPAL_CREATE_ORDER_FAILED` |
| Response `details` | `null` |
| Internal order | `1932563b-283c-4ea4-be44-5f2e03b6b441` → `failed` |
| `paypal_order_id` | `null` |
| Capture calls | **0** |
| Webhooks（本次） | **0** |
| 扣款證據 | **無** |
| 非本因 | **不是** `MERCHANT_MISMATCH` |

前端 correlation／edge 指紋（sanitize）：

- `sb-request-id`: `01a023dc-beb2-7f82-9de4-a365caddce03`
- `x-correlation-id`: `fd283ad7-cff6-44f6-a310-c77c43eae857`
- `x-deno-execution-id`: `2ccd1378-118e-461b-b80b-9b9f03839426`
- Duration ≈ **8389 ms**（不像純本機／設定短路）

---

## 1. Edge Function logs 查詢結果

### 嘗試

1. Management API `analytics/endpoints/logs.all`（`function_logs` / `function_edge_logs`，窗 `2026-08-21T10:27:00Z`–`10:29:00Z`）
2. Dashboard `…/functions/paypal-checkout/logs`
3. CLI profile access token（本 session 無法從 Credential Manager 以已知 target 取得；Dashboard 導向 sign-in）

### 結果

```text
Edge logs for incident window: UNAVAILABLE in this session
```

因此下列項目 **無法從 runtime log 直接填入**：

| # | 項目 | 結果 |
|---|---|---|
| 1 | PayPal OAuth 是否成功 | **UNKNOWN** |
| 2 | Create Order HTTP status | **UNKNOWN** |
| 3 | PayPal error `name` | **UNKNOWN** |
| 4 | `details[].issue` | **UNKNOWN** |
| 5 | `details[].description` | **UNKNOWN** |
| 6 | `debug_id` | **UNKNOWN** |
| 7 | path `/v2/checkout/orders` | 僅能由**程式碼**確認會呼叫 |
| 8 | `PAYPAL_ENV` runtime | 僅能由**程式碼＋secret 名稱**推斷為 sandbox 路徑 |
| 9 | API host `api-m.sandbox.paypal.com` | 僅能由**程式碼**確認 |
| 10 | PayPal response Content-Type | **UNKNOWN** |
| 11 | 是否在加入 Prefer 後才發生 | **時間相關：YES；因果：UNKNOWN** |
| 12 | Failure layer | 見 §4（可收窄但不可定案） |

### 程式碼層可觀測性缺口（主因）

`paypal-client` create：

- `!res.ok` 時只設 `err.details = { status }`，**不**讀取／記錄 `name` / `issue` / `debug_id`
- OAuth 失敗丟 `PAYPAL_OAUTH_FAILED`

`paypal-checkout-handler` create：

```text
catch (_paypalError) {
  → transition failed
  → 502 PAYPAL_CREATE_ORDER_FAILED "PayPal create order failed."
}
```

- **吞掉**底層錯誤（含 OAuth vs Create）
- 回傳 `details: null`
- **無** `console.log`／結構化 log 寫入 PayPal body

結論：即使 Dashboard logs 可開，現有實作也幾乎不會留下 PayPal issue／debug_id。  
依本 Gate 規則 → 分類 **`INSUFFICIENT_LOGGING`**。

---

## 2. 部署／Secrets 核對（名稱與狀態 only）

| 項目 | 狀態 |
|---|---|
| `PAYPAL_ENV` | **PRESENT**（CLI `secrets list` 名稱；值為 digest，未輸出） |
| `PAYPAL_CLIENT_ID` | **PRESENT** |
| `PAYPAL_CLIENT_SECRET` | **PRESENT** |
| `PAYPAL_MERCHANT_ID` | **PRESENT** |
| `PAYPAL_WEBHOOK_ID` | **PRESENT** |
| `paypal-checkout` | ACTIVE **v4**，`verify_jwt` **ON** |
| `paypal-webhook` | ACTIVE v3（本 Gate 未部署） |
| 含 07B.2.3 hotfix | **YES（以部署來源推斷）**：v4 為 07B.2.3 後部署；本地 `paypal-client` 含 `Prefer: return=representation`、`getOrder`、`normalizeMerchantId` |

`index.ts` 若缺 client／secret／merchant → 回 **503 `PAYPAL_CONFIG`**。本次為 **502 `PAYPAL_CREATE_ORDER_FAILED`** → 進入過 PayPal client 路徑，非單純「secret 名稱缺失」。

---

## 3. Create Order payload（程式碼核對）

來源：`paypal-plans` + `paypal-client.createOrder`（monthly）。

| 欄位 | 值／狀態 |
|---|---|
| `intent` | `CAPTURE` |
| `purchase_units` | 長度 1 的陣列 |
| `purchase_units[0].reference_id` | `monthly` |
| `purchase_units[0].description` | `月方案` |
| `amount.currency_code` | `USD` |
| `amount.value` | `"5.00"` |
| `custom_id` / `invoice_id` | **未使用**（合法：可省略） |
| `application_context` / `payment_source` | **未使用** |
| Headers（名稱 only） | `Authorization`, `Content-Type`, `PayPal-Request-Id`, **`Prefer: return=representation`** |
| undefined / null / NaN | 計劃白名單字串；**程式面視為合法** |

```text
Create Payload Valid: YES (from code; runtime PayPal validation UNKNOWN)
API Host (code): https://api-m.sandbox.paypal.com
Path (code): POST /v2/checkout/orders
PAYPAL_ENV (code default + guard): sandbox only
```

---

## 4. Failure layer 收窄

| Layer | 判定 |
|---|---|
| Edge config 缺 secret | **排除**（會 503 `PAYPAL_CONFIG`） |
| Auth／JWT | **排除**（07B.2.4A：有 Bearer；已建 internal row） |
| DB create internal | **成功**（有 failed 列） |
| OAuth | **可能**（錯誤被映射成同一 `PAYPAL_CREATE_ORDER_FAILED`） |
| Create Order HTTP `!res.ok` | **可能**（同上） |
| JSON parse → 無 id | **較不可能**（該分支訊息為 `PayPal did not return an order id.`；本次訊息為 `PayPal create order failed.`） |
| Response validation（merchant） | **排除**（create 路徑不做 merchant 比對） |
| Capture | **排除**（0 calls） |

```text
Failure Layer: UNKNOWN_PAYPAL_CLIENT_THROW (oauth_or_create_http; details discarded)
Prefer Header Related: UNKNOWN
  - Temporal: create 曾在 Prefer 前成功；v4（含 Prefer on create）後失敗
  - Causal: 無 PayPal issue／status，不得歸因 Prefer
```

---

## 5. Root Cause Classification

```text
Root Cause Classification: INSUFFICIENT_LOGGING
```

不得捏造具體 `INVALID_REQUEST` / `AUTHENTICATION_FAILURE` 等 PayPal issue。  
次要觀察（非定案）：

- Prefer 加在 **create** 與 capture／GET 同次 hotfix；與本次失敗 **時間相關**
- Handler 將 `PAYPAL_OAUTH_FAILED` 與 create 失敗 **合併** 成同一對外 code

---

## 6. Recommended Minimal Observability Hotfix（本 Gate **不實作**）

最小、只加觀測、不改 Secrets、不重試付款：

1. **`paypal-client.createOrder`**：`!res.ok` 時 sanitize 記錄／附掛  
   `status`, `name`, `details[0].issue`, `debug_id`（**禁止** token／Authorization／完整 PII）
2. **`getAccessToken`**：失敗時回傳可區分的 `PAYPAL_OAUTH_FAILED` + HTTP status（同樣 sanitize）
3. **`handleCreateOrder`**：  
   - 勿 `catch (_paypalError)` 丟棄  
   - OAuth → 專用 code；Create → `PAYPAL_CREATE_ORDER_FAILED` 且 `details` 含上述 sanitize 欄位  
   - `console.error` 結構化一行供 `function_logs`
4. （可選、另 Gate）create 路徑暫時拿掉 `Prefer` 做 A/B — **僅在 observability 之後**，本文件不批准執行

---

## 7. Safe To Retry

```text
Safe To Retry Now: NO
```

理由：無扣款風險，但根因未見；再按一次只會再產 `failed` 列且仍看不到 PayPal issue。  
應先做 observability hotfix（另 Gate）再 E2E。

---

```text
Auth-07B.2.4B Result:
OAuth Status: UNKNOWN
PayPal Create HTTP Status: UNKNOWN
PayPal Error Name: UNKNOWN
PayPal Error Issue: UNKNOWN
PayPal Debug ID: UNKNOWN
API Host: api-m.sandbox.paypal.com (from code)
PAYPAL_ENV: sandbox (secret name PRESENT; code enforces sandbox)
Create Payload Valid: YES
Prefer Header Related: UNKNOWN
Failure Layer: UNKNOWN_PAYPAL_CLIENT_THROW (oauth_or_create_http; error details discarded)
Root Cause Classification: INSUFFICIENT_LOGGING
Secrets Changed: NO
New Order Created: NO
Capture Performed: NO
Database Mutated: NO
Code Changed: NO
Deployment Performed: NO
Safe To Retry Now: NO
Recommended Minimal Fix: sanitize-log PayPal status/name/issue/debug_id; stop collapsing OAuth into CREATE_FAILED; surface details on 502
Gate: PASS
```
