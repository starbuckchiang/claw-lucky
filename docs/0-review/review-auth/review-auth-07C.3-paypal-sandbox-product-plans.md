# review-auth-07C.3-paypal-sandbox-product-plans

Auth-07C.3：PayPal **Sandbox** Subscription Product＋Monthly／Yearly Plans＋Edge Secrets。

前置：

- `docs/0-review/review-auth/review-auth-07C.1A-paypal-subscriptions-design-fix.md`
- `docs/0-review/review-auth/review-auth-07C.2A-postgres-verification.md`
- 07B.2.4 成功 E2E 之同一 Sandbox Business App

```text
Gate: PASS
```

```text
Subscription Created: NO
Payment Attempted: NO
Database Changed: NO
Migration Changed: NO
DB Push Performed: NO
Functions Deployed: NO
Webhook Events Changed: NO
Commit/Push Performed: NO
Existing PayPal credential secrets modified: NO
```

---

## 1. 環境安全確認

| 檢查 | 結果 |
|---|---|
| `config.js` `PAYPAL_ENV` | **sandbox** |
| API host | `https://api-m.sandbox.paypal.com` |
| OAuth | **OK**（token 未輸出） |
| Client ID vs `config.js` | **MATCH**（len=80，prefix6=`AcmJxz`，sha8=`0c3626cd`；與 Edge secret digest 前綴一致） |
| Merchant Account ID vs Edge `PAYPAL_MERCHANT_ID` digest | **MATCH**（len=13，prefix6=`6489QG`，sha8=`ebbb48d7`） |
| Live API | **未使用** |

→ Merchant／App Validation：**MATCH**（非 `BLOCKED_ENVIRONMENT`）

---

## 2. 既有資源掃描

唯讀 list catalogs／plans：

| 資源 | 同名筆數 | 處置 |
|---|---|---|
| Product `Lucky Buddies Subscription (Sandbox)` | 本 Gate 前 **0** → 建立後 **1** | 建立後重用 |
| Plan `Lucky Buddies Monthly USD 5` | 本 Gate 前 **0** → 建立後 **1** | 建立後重用 |
| Plan `Lucky Buddies Yearly USD 48` | **0** → 建立 **1** | 新建 |

無同名多筆 → 非 `BLOCKED_DUPLICATE_RESOURCE`。  
規格不符既有資源 → 未發生。

---

## 3. 建立／重用結果（遮罩）

| 項目 | Created this gate | Reused | ID exists | len | prefix6 | sha8 | GET |
|---|---|---|---|---|---|---|---|
| Product | **YES**（首跑） | YES（複驗） | YES | 22 | `PROD-1` | `dd82ce7f` | type=`SERVICE` **MATCH** |
| Monthly Plan | **YES**（首跑） | YES（複驗） | YES | 26 | `P-5KH0` | `9db3df70` | status=`ACTIVE` **MATCH** |
| Yearly Plan | **YES** | — | YES | 26 | `P-9783` | `9c65fbe6` | status=`ACTIVE` **MATCH** |

完整 ID／access token／Client Secret：**未輸出**。

---

## 4. 權威 GET 規格

| 規格 | Monthly | Yearly |
|---|---|---|
| status | ACTIVE | ACTIVE |
| product_id | 同 Product | 同 Product |
| billing | USD **5.00**／MONTH×1／`total_cycles=0` | USD **48.00**／YEAR×1／`total_cycles=0` |
| trial | **NONE**（僅 REGULAR cycle） | **NONE** |
| setup fee | **NONE**（建立 payload 省略；GET 無非零 setup_fee） | **NONE** |
| auto_bill_outstanding | **true** | **true** |
| payment_failure_threshold | **3** | **3** |

首跑 Monthly 曾因字串 `"5"` vs `"5.00"` 誤判 `NOT_MATCH`；改為數值比對後複驗 **MATCH**。資源未刪除、未另建同名第二份。

---

## 5. Supabase Edge Secrets

設定（值無引號／空白；未讀回完整值）：

| Secret name | Set | `secrets list` 名稱 |
|---|---|---|
| `PAYPAL_SUBSCRIPTION_PRODUCT_ID` | YES | **PRESENT** |
| `PAYPAL_PLAN_ID_MONTHLY` | YES | **PRESENT** |
| `PAYPAL_PLAN_ID_YEARLY` | YES | **PRESENT** |

**未修改：** `PAYPAL_ENV`／`PAYPAL_CLIENT_ID`／`PAYPAL_CLIENT_SECRET`／`PAYPAL_MERCHANT_ID`／`PAYPAL_WEBHOOK_ID`。

Webhook event subscriptions：**未變更**（依 Gate 禁令，留給 07C.4+）。

---

## 6. 信任邊界備註（給後續 Gate）

Plan ID 為 allowlist 公開配置（非「對前端保密」）。  
Browser 仍只能經 JWT Edge 取得 allowlisted plan_id；confirm／webhook 必須 GET 驗證。

Runner（本機、不部署）：`scripts/auth-07c3-sandbox-product-plans/run.cjs`

---

## Auth-07C.3 Result

```text
Auth-07C.3 Result:
PayPal Environment: sandbox
API Host: https://api-m.sandbox.paypal.com
Merchant/App Validation: MATCH
Existing Product Found: NO (before gate) / YES (after create; reused on verify)
Product Created: YES
Product Validation: MATCH (SERVICE; masked id prefix PROD-1 / sha8 dd82ce7f)
Monthly Plan Found: NO→YES (created then reused)
Monthly Plan Created: YES
Monthly Plan Status: ACTIVE
Monthly Billing: USD 5.00 / MONTH / unlimited (total_cycles=0)
Yearly Plan Found: NO
Yearly Plan Created: YES
Yearly Plan Status: ACTIVE
Yearly Billing: USD 48.00 / YEAR / unlimited (total_cycles=0)
Trial: NONE
Setup Fee: NONE
Auto Bill Outstanding: true
Payment Failure Threshold: 3
Duplicate Resources Created: NO
Product Secret Set: YES (PAYPAL_SUBSCRIPTION_PRODUCT_ID PRESENT)
Monthly Plan Secret Set: YES (PAYPAL_PLAN_ID_MONTHLY PRESENT)
Yearly Plan Secret Set: YES (PAYPAL_PLAN_ID_YEARLY PRESENT)
Existing Secrets Changed: NO (credential secrets untouched)
Subscription Created: NO
Payment Attempted: NO
Database Changed: NO
Migration Changed: NO
DB Push Performed: NO
Functions Deployed: NO
Webhook Events Changed: NO
Commit/Push Performed: NO
Gate: PASS
```

---

## 7. Stop

本 Gate 完成。**不得**開始 07C.4（webhook handler／event 訂閱更新）。
