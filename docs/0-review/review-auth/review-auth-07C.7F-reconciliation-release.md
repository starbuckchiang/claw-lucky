# review-auth-07C.7F-reconciliation-release

Auth-07C.7F：SALE Reconciliation Hotfix **Sandbox Release**＋既有首期付款對帳。

前置：

- `docs/0-review/review-auth/review-auth-07C.7E-sale-reconciliation-hotfix.md`
- `docs/0-review/review-auth/review-auth-07C.7E.1-postgres-verification.md`

```text
Gate: PASS
```

```text
Second Resend Performed: NO
Payment Attempted: NO
Subscription Cancelled: NO
Manual Database Mutation: NO
Product/Plans Changed: NO
Secrets Changed: NO
Webhook Config Changed: NO
paypal-checkout Deployed: NO
Commit/Push Performed: NO
```

---

## 1. Preflight

| 檢查 | 結果 |
|---|---|
| Target project | `umtqpstacjdwxcvcirbl` LINKED |
| `PAYPAL_ENV` digest | **MATCH** `sha256(sandbox)` |
| `verify-local` | **848／848** PASS |
| Migration pending | 僅 `20260908000100_sale_reconciliation_hotfix.sql` |
| Dry-run | Would push **only** that migration |
| `paypal-webhook` pre | **v7** ACTIVE，`verify_jwt=false` |
| `paypal-subscription` pre | **v1** ACTIVE，`verify_jwt=true` |

### 發布前唯讀（official user `5020bf33…`）

| 欄位 | 值 |
|---|---|
| subscription count | **1** |
| status | ACTIVE／monthly／USD 5 |
| `paid_through` | **null** |
| `last_payment_time` | **null** |
| `next_billing_time` | `2026-10-07T10:00:00Z` |
| transactions | **0** |
| slot | **OCCUPIED** |

→ 非 `BLOCKED_PREDEPLOY`

---

## 2. Migration applied

`supabase db push` → `20260908000100` **remote = local**

| 檢查 | 結果 |
|---|---|
| `ensure_paypal_webhook_event_received` | EXIST（PostgREST 可路由） |
| `finalize_paypal_webhook_event_failure` | EXIST |
| `reconcile_paypal_subscription_sale` | EXIST |
| `process_paypal_subscription_webhook_event` | EXIST（已 REPLACE） |
| anon reconcile | **DENIED**（404／無 EXECUTE） |
| Legacy `payment_orders` | **3** 不變 |
| Wallet Σ sample | **11202** 不變 |

未插入假 SALE／假 webhook。

---

## 3. Functions deployed

| Function | Version | verify_jwt | Notes |
|---|---|---|---|
| `paypal-webhook` | **v8** | **false** | PayPal signature verify 仍在 handler ON |
| `paypal-subscription` | **v2** | **true** | **未** `--no-verify-jwt`（deploy 指令無該旗標） |
| `paypal-checkout` | v8 | true | **本 Gate 未部署** |

---

## 4. Safe smoke

| Smoke | 結果 |
|---|---|
| Missing JWT → `paypal-subscription` | **401** |
| Bad signature → `paypal-webhook` | **401** `WEBHOOK_VERIFY_FAILED`；event rows **0** |

未發送偽造成功 SALE payload。

---

## 5. Controlled reconciliation（`get_status` ×2）

Official user session：admin `generate_link`＋`verify`（magiclink）；**未** Resend、未付款、未手動 SQL。

| 步驟 | 結果 |
|---|---|
| get_status #1 | **200** `ok:true` |
| PayPal COMPLETED sale | **FOUND**（prefix `52H380…`） |
| Plan／owner／custom_id | 由 server GET 驗證通過 |
| Amount／currency | USD **5** |
| Reconciliation RPC | **processed** |
| Transaction count | **0 → 1** |
| `audit_source` | `paypal_api_reconciliation` |
| Synthetic event id | `paypal_api_reconciliation:52…`（**非** WH-） |
| Forged SALE webhook row | **NO**（payment_webhook_events 仍無 `PAYMENT.SALE.*`） |
| CREATED／ACTIVATED | 仍 `processed`／`SUCCESS`（2 筆） |
| Orders webhook | **4** 筆保留 |
| `paid_through` | `2026-10-07T10:00:00Z`（= next_billing） |
| `last_payment_time` | `2026-09-07T14:34:18Z` |
| `reconciliation_status` | `resolved` |
| `access_blocked_at` | null |
| get_status #2 | 冪等：tx 仍 **1**；paid_through **不變** |
| Slot | 仍 **OCCUPIED** |
| Subscription rows | 仍 **1** |

Harness：`scripts/auth-07c7f-release/release.cjs`／`release.jsonl`。

---

## 6. Frontend

| 檢查 | 結果 |
|---|---|
| `localhost:5500/subscription.html` | **200** 可載入 |
| Playwright 訪客視圖 | 未登入 → 仍顯示方案按鈕（預期） |
| Official `get_status` 契約 | ACTIVE＋`paid_through`＋next billing → 對應 07C.6「訂閱使用中」／隱藏新訂閱／顯示取消 |
| 取消按鈕 | **未點擊**（禁令） |

未在瀏覽器注入官方 session（避免本機暫存憑證外洩路徑）；權威狀態以 Edge `get_status`＋DB snapshot 為準。

---

## Auth-07C.7F Result

```text
Auth-07C.7F Result:
Environment: sandbox (umtqpstacjdwxcvcirbl; PAYPAL_ENV digest MATCH)
Predeploy Tests: PASS (848/848)
Migration Dry Run: PASS (only 20260908000100)
Migration Applied: YES
paypal-webhook Deployed: YES
paypal-webhook Version: v8
Gateway JWT: OFF (webhook only)
PayPal Signature Verification: ON
paypal-subscription Deployed: YES
paypal-subscription Version: v2
Verify JWT: ON
Missing JWT Smoke: PASS (401)
Bad Signature Smoke: PASS (401, 0 rows)
Controlled Get-status Calls: 2
PayPal Completed Sale Found: YES (52H380…)
Plan/Owner/Custom ID Validation: PASS
Amount/Currency Validation: PASS (USD 5)
Reconciliation RPC: PASS
Transaction Count Before/After: 0 → 1
Audit Source: paypal_api_reconciliation
Synthetic Event Distinguished: YES
Database Status: ACTIVE monthly
Last Payment Time: 2026-09-07T14:34:18Z
Paid-through: 2026-10-07T10:00:00Z
Next Billing Time: 2026-10-07T10:00:00Z
Reconciliation Pending: NO (resolved)
Access Blocked: NO
Second Get-status Idempotency: PASS
Duplicate Transaction: NO
Duplicate Subscription: NO
Slot State: OCCUPIED
Frontend State: PAGE_OK; visitor UI without session; official entitlement confirmed via get_status/DB
Subscribe Buttons Hidden: YES (for official session per API contract / 07C.6 mapping)
Second Resend Performed: NO
Payment Attempted: NO
Subscription Cancelled: NO
Manual Database Mutation: NO
Product/Plans Changed: NO
Secrets Changed: NO
Webhook Config Changed: NO
paypal-checkout Deployed: NO
Commit/Push Performed: NO
Gate: PASS
```

完成後停止；**不得**按取消自動續訂。
