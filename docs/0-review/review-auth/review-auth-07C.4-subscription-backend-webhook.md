# review-auth-07C.4-subscription-backend-webhook

Auth-07C.4：PayPal Subscriptions Backend＋Webhook **本機實作**（mock／隔離測試 only）。

前置：

- `docs/0-review/review-auth/review-auth-07C.1A-paypal-subscriptions-design-fix.md`
- `docs/0-review/review-auth/review-auth-07C.2A-postgres-verification.md`
- `docs/0-review/review-auth/review-auth-07C.3-paypal-sandbox-product-plans.md`
- `supabase/migrations/20260907000100_paypal_subscriptions_rpc.sql`

```text
Gate: PASS
```

```text
Remote DB Changed: NO
PayPal Resources Changed: NO
Sandbox Subscription Created: NO
Payment Attempted: NO
Secrets Changed: NO
Functions Deployed: NO
Webhook Dashboard Changed: NO
Commit/Push Performed: NO
db push: NO
```

---

## 1. 交付物

| 項目 | 路徑 |
|---|---|
| New Function | `supabase/functions/paypal-subscription/`（`verify_jwt = true`） |
| Handler twins | `_shared/paypal-subscription-handler.js`／`.ts` |
| Client | `_shared/lib/paypal-client.js`／`.ts` → `getSubscription`／`getPlan`／`cancelSubscription` |
| Plans allowlist | `_shared/lib/paypal-plans.js`／`.ts` → env plan ID resolve |
| Webhook | `_shared/paypal-webhook-handler.js`／`.ts` 分流；Orders 路徑保留 |
| Frontend service | `js/services/subscription/paypal-subscription-service.js` |
| Tests | `paypal-subscription-backend.test.js`、`paypal-subscription-service.test.js` |

Migration：**未改**（無需重跑 07C.2A）。

---

## 2. Actions

| Action | 行為 |
|---|---|
| `create_session` | `acquire_subscription_slot`；amount／currency／`plan_id` 僅 server whitelist（`PAYPAL_PLAN_ID_MONTHLY`／`YEARLY`） |
| `confirm_subscription` | GET subscription → `custom_id`／owner／allowlist／status → `bind_paypal_subscription`；**不**設 `paid_through`；嘗試 resolve `pending_resolution` |
| `get_status` | 僅本人安全摘要 |
| `cancel_subscription` | PayPal cancel＋GET；本地 `edge-cancel:{id}`；slot **不**因 HTTP 提前釋放 |

Official user：拒 anonymous；需 email 或 Google identity。`user_id` 只來自 JWT。

---

## 3. Webhook

- 先 signature verify；失敗不寫業務表
- Subscription 事件：`BILLING.SUBSCRIPTION.*`、`PAYMENT.SALE.*`
- SALE：`billing_agreement_id`＋sale id；merchant MATCH；SALE.COMPLETED 才延長 `paid_through`
- 早於 confirm → `pending_resolution`
- Orders `PAYMENT.CAPTURE.*`／`CHECKOUT.ORDER.APPROVED`：**regression PASS**

---

## 4. 測試

```text
paypal-subscription-backend + service: 29 pass
paypal-checkout-webhook (Orders): 41 pass
verify-local.ps1: 811 pass / 0 fail
```

Mock PayPal HTTP only — **無**真實 Sandbox Subscription API。

---

## Auth-07C.4 Result

```text
Auth-07C.4 Result:
New Function: paypal-subscription (verify_jwt=true)
JWT Verification: ON (gateway + resolveAuthenticatedUser)
Official User Enforcement: PASS (anonymous / identity / JWT)
Create Session: PASS (server whitelist; slot atomic)
Confirm Subscription: PASS (custom_id + plan allowlist + bind)
Status Query: PASS (owner-safe summary)
Cancel Subscription: PASS (PayPal cancel; slot held to paid_through)
Plan Whitelist: PASS (PAYPAL_PLAN_ID_MONTHLY/YEARLY)
Custom ID Binding: PASS
Confirm Grants Entitlement: NO
SALE Grants Paid-through: PASS
Merchant Validation: PASS (SALE payee MATCH)
Webhook Signature: PASS (required before mutation)
Webhook Before Confirm: PASS (pending_resolution)
Event Idempotency: PASS
Sale Idempotency: PASS
Cancellation Slot Protection: PASS
Refund/Reversal: PASS (access block + needs_review)
Legacy Orders Regression: PASS (41/41)
Migration Changed: NO
Postgres Verification: SKIPPED (migration unchanged; 07C.2A still valid)
Tests Passed: 29 (subscription) + 41 (Orders) + verify-local suite
Tests Failed: 0
Remote DB Changed: NO
PayPal Resources Changed: NO
Sandbox Subscription Created: NO
Payment Attempted: NO
Secrets Changed: NO
Functions Deployed: NO
Webhook Dashboard Changed: NO
Commit/Push Performed: NO
Gate: PASS
```

---

## 5. Stop

本機實作與測試完成。**不得** db push／部署／更新 Dashboard webhook events（留给後續 Gate）。
