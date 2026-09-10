# review-auth-07C.7E-sale-reconciliation-hotfix

Auth-07C.7E：SALE Early-200＋Transactions Reconciliation Hotfix（本機程式／additive migration／測試 only）。

前置：

- `docs/0-review/review-auth/review-auth-07C.7B-paid-through-diagnostic.md`
- `docs/0-review/review-auth/review-auth-07C.7C-sale-webhook-delivery.md`
- `docs/0-review/review-auth/review-auth-07C.7D-sale-delivery-forensic.md`
- Dashboard `function_edge_logs`：`2026-09-07T14:34:37Z`／`14:52:08Z` `paypal-webhook` POST → HTTP **200**；之後仍無 SALE event／tx

```text
Gate: PASS
Corrected Root Cause: EARLY_SUCCESS_OR_MISSING_PERSIST
```

```text
Historical Sale Mutated: NO
Second Resend Performed: NO
Remote DB Changed: NO
Existing Subscription Changed: NO
Payment Attempted: NO
Subscription Cancelled: NO
Functions Deployed: NO
Secrets Changed: NO
Commit/Push Performed: NO
```

---

## 1. Corrected root cause

| 舊分類（07C.7C／7D） | 修正 |
|---|---|
| DELIVERY_FAILED／WEBHOOK_NOT_RECEIVED | **否** — Edge 已收並回 200 |
| **EARLY_SUCCESS_OR_MISSING_PERSIST** | **是** — 驗簽後可在 persist 前 `return 200`（缺 merchant／billing_agreement 等）|

---

## 2. Webhook 收件順序（修復）

`paypal-webhook`（JS／TS twin）：

1. raw body  
2. PayPal signature verify  
3. **`ensure_paypal_webhook_event_received`**（event_id 冪等 → `processing_status=received`）  
4. routing／merchant／amount／currency／RPC  

永久失敗路徑：`finalize_paypal_webhook_event_failure` + structured log；仍可 HTTP 200，但 **必有 event 列**。

---

## 3. Merchant missing vs mismatch

| 情況 | 行為 |
|---|---|
| payee.merchant_id 存在且 ≠ expected | `MERCHANT_MISMATCH`（persist failed） |
| payee.merchant_id **缺失** | 不直接當 mismatch；server GET subscription + allowlist plan + custom_id + amount／currency |
| fallback 全過 | `merchant_validation_source = verified_webhook_plus_authenticated_paypal_get` |
| payee 存在且 MATCH | `merchant_validation_source = sale_payee_merchant_id` |

不虛構 merchant ID；不信任前端。

---

## 4. Structured logging

單行 JSON：`event=paypal_subscription_webhook_result`，含 `eventType`／`stage`／`verificationStatus`／`processingStatus`／`errorCode`／`merchantValidationSource`。  
不記錄完整 event／sale／subscription ID、email、body、headers、Secret。

---

## 5. Additive migration

路徑：`supabase/migrations/20260908000100_sale_reconciliation_hotfix.sql`  
**未**修改已部署的 `20260907000100_paypal_subscriptions_rpc.sql`。  
**未** `db push`。

| RPC | 用途 | Execute |
|---|---|---|
| `ensure_paypal_webhook_event_received` | 驗簽後先落 received | service_role only |
| `finalize_paypal_webhook_event_failure` | early fail 標 error_code | service_role only |
| `process_paypal_subscription_webhook_event`（REPLACE） | 可從 `received` 續跑；webhook tx `audit_source=paypal_webhook` | （既有權限） |
| `reconcile_paypal_subscription_sale` | API reconciliation；synthetic event id `paypal_api_reconciliation:{sale_id}`；sale UNIQUE | service_role only |

---

## 6. Reconciliation server flow

`paypal-subscription`：`confirm_subscription` 後與 `get_status`（ACTIVE + `paid_through=null`）觸發內部：

1. GET subscription  
2. GET subscription transactions  
3. 只處理 `COMPLETED`  
4. 驗證 custom_id／owner／plan allowlist／amount／currency  
5. 呼叫 `reconcile_paypal_subscription_sale`  
6. 再讀安全 status  

Browser **不可**提交 sale_id／amount／currency／paid_through；無 public `reconcile_*` action。

---

## 7. 歷史 SALE（本 Gate）

- 僅 mock fixture  
- **未** Resend、未改真實 SALE／訂閱、未手動 `paid_through`  
- 未來 Release 後：既有 ACTIVE＋`paid_through=null` 可由 `get_status` 權威 reconcile 一次；延遲 webhook 因 sale_id UNIQUE 不雙重延長

---

## 8. 測試

| 項 | 結果 |
|---|---|
| 07C.7E webhook／reconciliation cases（backend test） | PASS |
| Legacy Orders webhook regression | PASS（既有 checkout-webhook tests） |
| Migration shape（`sale-reconciliation-hotfix-shape.test.js`） | 6/6 PASS |
| Live isolated PostgreSQL | **NOT_RUN**（Docker 無運行中 Postgres；本 Gate 禁止 remote db push） |
| `scripts/verify-local.ps1` | **846／846** PASS |

---

## 9. 主要變更檔

- `supabase/functions/_shared/paypal-webhook-handler.js`／`.ts`
- `supabase/functions/_shared/paypal-subscription-handler.js`／`.ts`
- `supabase/functions/_shared/lib/paypal-client.js`／`.ts`（`getSubscriptionTransactions`）
- `supabase/migrations/20260908000100_sale_reconciliation_hotfix.sql`
- `supabase/functions/_shared/__tests__/paypal-subscription-backend.test.js`
- `supabase/migrations/__tests__/sale-reconciliation-hotfix-shape.test.js`

---

## Auth-07C.7E Result

```text
Auth-07C.7E Result:
Corrected Root Cause: EARLY_SUCCESS_OR_MISSING_PERSIST
Verified Event Persisted Before Routing: YES
Early 200 Without Event Prevented: YES
Missing Merchant Handling: verified_webhook_plus_authenticated_paypal_get fallback
Actual Merchant Mismatch: MERCHANT_MISMATCH + persisted failed event
Structured Logging: YES (paypal_subscription_webhook_result)
Additive Migration: 20260908000100_sale_reconciliation_hotfix.sql
Reconciliation RPC: reconcile_paypal_subscription_sale
RPC Execute Restricted: YES (REVOKE PUBLIC/anon/authenticated; GRANT service_role)
GET Transactions Reconciliation: YES (confirm + get_status ACTIVE/paid_through=null)
Historical Sale Mutated: NO
Second Resend Performed: NO
Webhook/Reconciliation Idempotency: YES (paypal_sale_id UNIQUE both paths)
Legacy Orders Regression: PASS
Postgres Tests: SHAPE 6/6; live isolated PG NOT_RUN
Tests Passed: 846
Tests Failed: 0
Remote DB Changed: NO
Existing Subscription Changed: NO
Payment Attempted: NO
Subscription Cancelled: NO
Functions Deployed: NO
Secrets Changed: NO
Commit/Push Performed: NO
Gate: PASS
```

完成本機測試；**停止**。下一步需人工核准後才可 db push／部署 Functions／對歷史 ACTIVE 訂閱做真實 reconcile。
