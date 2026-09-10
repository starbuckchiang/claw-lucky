# review-auth-07A.4-final-release-check

Auth-07A.4：final release check（**唯讀**；本 Gate 未改任何程式／migration／config）。

```text
Gate: SAFE_FOR_PAYPAL_SANDBOX_DEPLOY
```

```text
Code/migration/config modified this Gate: NO
db push: NO
functions deploy: NO
secrets set: NO
PayPal HTTP: NO
git add/commit/push: NO
```

完成後**停止**；本 Gate 不得自行部署。後續 Sandbox deploy 需另開明確 Gate／人工核准。

---

## Checklist（僅確認下列 10 項）

### 1. verify-local 746/746 或更多，0 fail

`.\scripts\verify-local.ps1`：**746 / 746 pass，0 fail**。

**判定：PASS**

---

### 2. `20260821000200` 仍為唯一待部署 migration

`npx supabase migration list`：

- 至 `20260821000100`：local = remote
- `20260821000200_payment_orders_and_webhook_events.sql`：local 有、**remote 空**
- 無其他 local-only migration

**判定：PASS**

---

### 3. `paypal-checkout` 與 `paypal-webhook` 是唯一待部署新 Functions

Remote `functions list`（已部署）：`wallpaper-generate`、`wallpaper-status`、`wallet-ops`、`shop-ops`、`account-merge`。

**未**出現 `paypal-checkout` / `paypal-webhook`。

Repo 新增 Edge entrypoints（untracked）：`supabase/functions/paypal-checkout/`、`supabase/functions/paypal-webhook/`。

**判定：PASS**

---

### 4. subscription-checkout / Auth / gift / gacha / wallet / account merge 無 diff

- `supabase/functions/subscription-checkout/`：無 git 變更
- `account-merge` / `wallet-ops` / `shop-ops`：無本 Gate 相關 diff
- Auth / gift / gacha / wallet / account-merge 模組路徑：無變更狀態

（預期前端：`subscription.html`／`subscription-entry.js`／`paypal-checkout-service.js` 屬 Auth-07 付款 UI，非上述禁改模組。）

**判定：PASS**

---

### 5. COMPLETED 六項驗證仍存在

Migration `process_paypal_webhook_event`（`v_target_status = 'paid'`）強制檢查：

1. `p_paypal_order_id`
2. `p_paypal_capture_id`
3. `p_expected_amount`
4. `p_expected_currency`
5. `p_actual_merchant_id`
6. `p_expected_merchant_id`

缺一或 merchant 不符 → `rejected`／event `failed`，不標 paid；無 `IS NOT NULL` 跳過。

**判定：PASS**

---

### 6. webhook verify SUCCESS 前零寫入

`paypal-webhook-handler`：先讀 headers → `verifyWebhookSignature` → 非 `SUCCESS` 則 401 返回；**其後**才 `repo.processWebhookEvent(...)`。

測試：`webhook: verify failure does not call repo`（`called === false`）。

**判定：PASS**

---

### 7. one-open unique race 測試確實只呼叫一次 PayPal Create

測試 `create-order: parallel unique race — B does not call PayPal; A creates once`：

- B 撞 unique → `ORDER_INITIALIZING`，`paypalCalls === 0`
- A Create 一次 → `paypalCalls === 1`
- B 重試 reuse 同一 `paypal_order_id`，仍 `paypalCalls === 1`
- 僅一筆 open

本 Gate 重跑相關測試：**pass**。

**判定：PASS**

---

### 8. paid / refunded / reversed 狀態不可倒退的測試通過

| 測試 | 結果 |
|---|---|
| paid → `CHECKOUT.ORDER.APPROVED` 不倒退 | pass |
| paid → `PAYMENT.CAPTURE.PENDING` 不倒退 | pass |
| refunded → `PAYMENT.CAPTURE.COMPLETED` 不回 paid | pass |
| reversed → COMPLETED 不回 paid | pass |

（stateful repo 走 `transitionStatus` 回歸規則，非固定 stub。）

**判定：PASS**

---

### 9. config.toml 只有 `paypal-webhook` 設 `verify_jwt = false`

`supabase/config.toml` 全文僅：

```toml
[functions.paypal-webhook]
verify_jwt = false
```

無其他 `verify_jwt` 覆寫。

**判定：PASS**

---

### 10. git diff 中沒有 secret、token、真實帳號或 PayPal 憑證

抽查：

- `config.js`：`window.PAYPAL_CLIENT_ID = ""`；註明 SECRET／WEBHOOK／MERCHANT 不得進前端
- `.env.example`：僅空佔位 `PAYPAL_CLIENT_ID=`／`PAYPAL_CLIENT_SECRET=`／`PAYPAL_WEBHOOK_ID=`／`PAYPAL_MERCHANT_ID=`，無實值
- 未見 committed 真實 token／secret／帳號

**判定：PASS**

---

## Gate

```text
SAFE_FOR_PAYPAL_SANDBOX_DEPLOY
```

本 Gate **停止**。實際 Sandbox：`db push`／`functions deploy`／secrets／PayPal webhook 註冊須另開明確核准流程。
