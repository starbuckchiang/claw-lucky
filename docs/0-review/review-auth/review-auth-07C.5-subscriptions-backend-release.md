# review-auth-07C.5-subscriptions-backend-release

Auth-07C.5：Subscriptions Backend **Sandbox Release**（migration＋deploy＋webhook events＋safe smoke）。

前置：

- `docs/0-review/review-auth/review-auth-07C.2A-postgres-verification.md`
- `docs/0-review/review-auth/review-auth-07C.3-paypal-sandbox-product-plans.md`
- `docs/0-review/review-auth/review-auth-07C.4-subscription-backend-webhook.md`

```text
Gate: PASS
```

```text
Subscription Created: NO
Payment Attempted: NO
Product/Plans Changed: NO
Secrets Changed: NO
Frontend Changed: NO
paypal-checkout Deployed: NO
Commit/Push Performed: NO
```

---

## 1. Predeploy

| 檢查 | 結果 |
|---|---|
| Target project | `umtqpstacjdwxcvcirbl` LINKED（`PAYPAL_ENV` digest = sha256(`sandbox`)） |
| `verify-local` | **811 / 811** PASS |
| Migration list | 僅 `20260907000100` pending remote |
| Dry-run | Would push **only** `20260907000100_paypal_subscriptions_rpc.sql` |
| Secrets names | 全部 PRESENT：`PAYPAL_ENV`／`CLIENT_ID`／`CLIENT_SECRET`／`MERCHANT_ID`／`WEBHOOK_ID`／`SUBSCRIPTION_PRODUCT_ID`／`PLAN_ID_MONTHLY`／`PLAN_ID_YEARLY` |
| Destructive SQL | 無（additive migration） |

→ 非 `BLOCKED_PREDEPLOY`

---

## 2. Migration applied

`supabase db push` → `20260907000100` **remote = local**

| 檢查 | 結果 |
|---|---|
| Tables | `paypal_subscriptions`／`user_subscription_slots`／`paypal_subscription_transactions` **EXIST** |
| Webhook additive cols | `paypal_subscription_id`／`paypal_sale_id`／`error_code`／`resolved_at` **EXIST** |
| RPCs | acquire／bind／expire／release／process_subscription_webhook **EXIST** |
| Legacy `payment_orders` count | **3 → 3**（未變） |
| `payment_webhook_events` count | **4 → 4**（未變） |
| Wallet sample Σ(points+tickets+coins) | **11202 → 11202**（未變） |

未插入假訂閱／假付款列。

---

## 3. Functions deployed

| Function | Version | status | verify_jwt | Notes |
|---|---|---|---|---|
| `paypal-webhook` | **v7** | ACTIVE | **false**（gateway） | Handler 內 PayPal signature verify 仍 ON |
| `paypal-subscription` | **v1** | ACTIVE | **true** | **未**使用 `--no-verify-jwt` |
| `paypal-checkout` | v8 | ACTIVE | true | **本 Gate 未部署** |

---

## 4. PayPal Sandbox Webhook events

既有 webhook（prefix `4XX590`／sha8 `f582b0e7`）**PATCH merge**（非新建）：

| 項目 | 結果 |
|---|---|
| Webhook ID changed | **NO** |
| Webhook URL changed | **NO**（url sha8 `7c9bd465` 不變） |
| Duplicate webhook created | **NO**（list count = 1） |
| Orders events preserved | **YES**（APPROVED＋全部既有 CAPTURE.*） |
| Subscription events added | **YES**（10 個 BILLING.*／SALE.*） |
| Event count | 6 → **16** |

完整 URL／ID／Secret：**未輸出**。

---

## 5. Safe smoke

| Smoke | 結果 |
|---|---|
| Missing JWT → `paypal-subscription` | **401** rejected（`AUTH_REQUIRED`／gateway） |
| Official user `get_status` | **200** `{ ok:true, subscription:null }` 安全摘要；未呼叫 create_session |
| Anonymous live mint | 專案 **captcha_failed** 阻擋公開 anonymous／password token；匿名拒絕已在 07C.4 mock suite 覆蓋 |
| Webhook bad signature | **401** `WEBHOOK_VERIFY_FAILED`；`payment_webhook_events` 對該 event id **0→0**（無寫入） |

未執行：create_session／confirm／cancel／真實 Subscription／Simulator 假付款。

---

## Auth-07C.5 Result

```text
Auth-07C.5 Result:
Target Environment: sandbox (PAYPAL_ENV digest MATCH; project umtqpstacjdwxcvcirbl)
Predeploy Tests: PASS (811/811)
Migration Dry Run: PASS (only 20260907000100)
Migration Applied: YES (20260907000100)
Subscription Tables: YES
Subscription RPCs: YES
Legacy Orders Mutated: NO (count 3 unchanged)
Wallet Mutated: NO (sample sum 11202 unchanged)
paypal-webhook Deployed: YES
paypal-webhook Version: v7
Gateway JWT: OFF (webhook only)
PayPal Signature Verification: ON (handler)
paypal-subscription Deployed: YES
paypal-subscription Version: v1
Verify JWT: ON
Missing JWT Smoke: PASS (401)
Anonymous Smoke: PASS (covered by 07C.4 mocks; live anon mint blocked by project captcha)
Official User Status Smoke: PASS (200, subscription null)
Webhook ID Changed: NO
Webhook URL Changed: NO
Orders Events Preserved: YES
Subscription Events Added: YES
Duplicate Webhook Created: NO
Subscription Created: NO
Payment Attempted: NO
Product/Plans Changed: NO
Secrets Changed: NO
Frontend Changed: NO
paypal-checkout Deployed: NO
Commit/Push Performed: NO
Gate: PASS
```

---

## 6. Stop

Release 完成。**不得**進行訂閱付款／Buyer 登入／E2E create_session（留给後續 Gate）。
