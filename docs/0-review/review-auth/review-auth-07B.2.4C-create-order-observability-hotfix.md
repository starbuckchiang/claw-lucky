# review-auth-07B.2.4C-create-order-observability-hotfix

Auth-07B.2.4C／07B.2.4C.1：PayPal Create Order 最小可觀測性 Hotfix（含 invalid response 分類＋部署）。

前置：`docs/0-review/review-auth/review-auth-07B.2.4B-create-order-forensic.md`

```text
Gate: PASS
```

```text
Root Cause Addressed: INSUFFICIENT_LOGGING
Secrets Changed: NO
Create Payload Changed: NO
Prefer Header Removed: NO
Capture/Webhook/State Machine Changed: NO
Migration: NONE
PayPal Order Created: NO
Payment/Capture Performed: NO
paypal-webhook Deployed: NO
paypal-checkout Deployed: YES (v5)
Commit/Push: NO
Ready For One Manual Retry: YES
```

---

## 1. 目標

保留 OAuth／Create Order 的 **sanitized** 錯誤欄位，使下一次單次 E2E 能看到真正 PayPal root cause。  
**不是**付款邏輯重構；**不**猜測／修正尚未確認的 PayPal 問題。

---

## 2. 修改檔案

| 檔案 | 變更 |
|---|---|
| `supabase/functions/_shared/lib/paypal-client.js` | sanitize helper；OAuth／create 失敗 details；**2xx 無 id → `PAYPAL_CREATE_ORDER_INVALID_RESPONSE`** |
| `supabase/functions/_shared/lib/paypal-client.ts` | 同上（Deno twin） |
| `supabase/functions/_shared/paypal-checkout-handler.js` | 區分 OAuth／Create／Invalid Response；固定安全 message；結構化 log |
| `supabase/functions/_shared/paypal-checkout-handler.ts` | 同上 |
| `supabase/functions/_shared/__tests__/paypal-checkout-webhook.test.js` | 07B.2.4C＋07B.2.4C.1 mock |
| 本 review | 更新 |

未改：Secrets、Create Order payload、`Prefer`、Capture／Webhook／merchant 驗證、migration、前端。

---

## 3. Sanitized 欄位白名單

允許：`stage`、`status`、`paypalName`、`paypalIssue`、`debugId`、截斷 `message`、非 JSON 時 `bodyOmitted`＋`contentType`。

禁止：完整 body、request、headers、token、Secret、JWT、Email、payer、`details[].description`。

---

## 4. 錯誤分類

| 情況 | code | HTTP | 對外 message（固定） |
|---|---|---|---|
| OAuth 失敗 | `PAYPAL_OAUTH_FAILED` | 502 | `PayPal OAuth failed.` |
| Create HTTP 失敗 | `PAYPAL_CREATE_ORDER_FAILED` | 502 | `PayPal create order failed.` |
| Create **2xx 但缺 order id** | `PAYPAL_CREATE_ORDER_INVALID_RESPONSE` | 502 | `PayPal create order returned an invalid response.` |

結構化 log：

```text
{"event":"paypal_checkout_create_failed","code",stage,status,paypalName,paypalIssue,debugId,bodyOmitted}
```

Invalid response 細節：`stage=create_order`，`paypalName=INVALID_RESPONSE`，`paypalIssue=MISSING_ORDER_ID`（不含 response body）。

---

## 5. 測試

```text
paypal-checkout-webhook.test.js: 41/41
verify-local.ps1: 761/761
```

含：sanitize、bodyOmitted、OAuth、Create fail、**2xx missing id → INVALID_RESPONSE**、log 不含 Email／token／body；Capture／Webhook／merchant fallback 未退步。

---

## 6. 部署（07B.2.4C.1）

```text
Command: npx supabase functions deploy paypal-checkout --project-ref umtqpstacjdwxcvcirbl
--no-verify-jwt: NOT used
```

| Function | Version | status | verify_jwt |
|---|---|---|---|
| `paypal-checkout` | **5** | ACTIVE | **true** |
| `paypal-webhook` | 3（未部署） | ACTIVE | false |

未執行：db push、Secrets 變更、付款、commit／push。

---

## 7. 手動重試指引（停止自動操作）

Ready：**YES** — 請人工：

1. 重新整理 `subscription.html`
2. 用 **Buyer** Sandbox 試一次 **monthly USD 5**
3. 若失敗：記錄 HTTP status、`error.code`、`error.details`（stage／status／paypalName／paypalIssue／debugId）

```text
Auth-07B.2.4C.1 Result:
Invalid Response Classification: PASS
Invalid Response Test: PASS
Tests Passed: 761/761 (paypal suite 41/41)
Tests Failed: 0
Function Deployed: paypal-checkout
Function Version: 5
Verify JWT: ON
Webhook Deployed: NO
Database Push Performed: NO
Secrets Changed: NO
Payment Attempted: NO
Commit/Push Performed: NO
Ready For One Manual Retry: YES
Gate: PASS
```
