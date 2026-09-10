# review-auth-07B.1-sandbox-infrastructure-deploy

Auth-07B.1：PayPal Sandbox **基礎設施**部署（無付款、無 Webhook 註冊、無 commit）。

```text
Gate: READY_FOR_PAYPAL_WEBHOOK_REGISTRATION
```

```text
db push: YES (only 20260821000200)
functions deploy: YES (paypal-checkout, paypal-webhook only)
--no-verify-jwt: NO
secrets set this Gate: NO (names pre-existed; values not read/printed)
PayPal Create/Capture HTTP: NO
Webhook registration: NO
git add/commit/push: NO
frontend deploy: NO
entitlements: NO
code/migration edited this Gate: NO
```

---

## 開始前唯讀

| # | 檢查 | 結果 |
|---|---|---|
| 1 | verify-local | **746 / 746** pass，0 fail |
| 2 | 唯一 pending migration | `20260821000200`（remote 當時為空） |
| 3 | 待部署新 Functions | remote 無 `paypal-checkout`／`paypal-webhook`；其餘既有 Functions 已在線 |
| 4 | Secret **名稱**存在 | `PAYPAL_ENV`、`PAYPAL_CLIENT_ID`、`PAYPAL_CLIENT_SECRET`、`PAYPAL_MERCHANT_ID`（僅確認名稱；**未**讀取／輸出值） |

`db push --dry-run` 僅列出：`20260821000200_payment_orders_and_webhook_events.sql`。

---

## 執行

### 1. `supabase db push`

提示僅含上述單一 migration。已套用。NOTICE 為 `DROP POLICY IF EXISTS` 首次套用時的 skipping（預期）。

### 2. `supabase functions deploy paypal-checkout`

成功。**未**使用 `--no-verify-jwt`。遠端 `verify_jwt: true`，version **1**。

### 3. `supabase functions deploy paypal-webhook`

成功。依 `config.toml`：遠端 `verify_jwt: false`，version **1**。

未部署其他 Functions。

---

## 部署後唯讀

| 檢查 | 結果 |
|---|---|
| migration local = remote | **PASS**（含 `20260821000200`） |
| `payment_orders`、`payment_webhook_events` 存在 | **PASS**（indexes／table-stats 可見） |
| paypal-checkout、paypal-webhook 已部署 | **PASS**（ACTIVE v1） |
| paypal-checkout JWT | `verify_jwt: true` |
| paypal-webhook JWT | `verify_jwt: false` |
| subscription-checkout 未重新部署 | **PASS**（remote 清單仍無此 slug） |
| 其他既有 Functions 未重部署 | **PASS**：wallpaper-generate v34、wallpaper-status v19、wallet-ops v6、shop-ops v6、account-merge v7（與部署前相同） |
| 未產生付款訂單 | **PASS**：`payment_orders` estimated rows **0**；`payment_webhook_events` **0** |
| 未呼叫 PayPal Create／Capture、未真實付款 | **PASS**（本 Gate 無 PayPal HTTP） |
| 未註冊 Webhook | **PASS** |

---

## Gate

```text
READY_FOR_PAYPAL_WEBHOOK_REGISTRATION
```

本 Gate **停止**。下一步（Webhook 註冊／付款測試）須另開明確核准。
