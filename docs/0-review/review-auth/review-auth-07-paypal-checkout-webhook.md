# review-auth-07-paypal-checkout-webhook

Auth-07：PayPal **Orders v2 一次性付款**（`intent: CAPTURE`）。  
`monthly` / `yearly` 僅為方案代碼與金額白名單，**不是** PayPal Subscriptions／自動續訂。

## Gate

```text
PARTIAL
```

原因：付款管線（create／capture／webhook 驗簽／冪等／狀態機）本機程式與 mock 測試已完成；**權益啟用規則未定義**（故意不建 entitlements）；**退款後權益撤銷未定義**（`BLOCKED_REFUND_POLICY`）；**未**設定真實 Sandbox secrets、**未**部署、**未**對 PayPal 發真實 HTTP。因此不可宣稱 `SAFE_FOR_PAYPAL_SANDBOX_DEPLOY`。

即使未來達到 `SAFE_FOR_PAYPAL_SANDBOX_DEPLOY`，本文件仍要求：**停止，不得部署**。

```text
Production Deployment Performed: NO
Live Payment Performed: NO
Sandbox Real HTTP Performed: NO
db push Performed: NO
functions deploy Performed: NO
git commit/push/PR: NO
```

---

## 1. 修改／新增檔案清單

### 新增

| 路徑 |
|---|
| `supabase/migrations/20260821000200_payment_orders_and_webhook_events.sql` |
| `supabase/migrations/__tests__/payment-orders-webhook-shape.test.js` |
| `supabase/functions/paypal-checkout/index.ts` |
| `supabase/functions/paypal-webhook/index.ts` |
| `supabase/functions/_shared/paypal-checkout-handler.js` |
| `supabase/functions/_shared/paypal-checkout-handler.ts` |
| `supabase/functions/_shared/paypal-webhook-handler.js` |
| `supabase/functions/_shared/paypal-webhook-handler.ts` |
| `supabase/functions/_shared/lib/paypal-client.js` |
| `supabase/functions/_shared/lib/paypal-client.ts` |
| `supabase/functions/_shared/lib/paypal-plans.js` |
| `supabase/functions/_shared/lib/paypal-plans.ts` |
| `supabase/functions/_shared/__tests__/paypal-checkout-webhook.test.js` |
| `js/services/subscription/paypal-checkout-service.js` |
| `js/services/subscription/__tests__/paypal-checkout-service.test.js` |
| `supabase/config.toml` |
| `docs/0-review/review-auth/review-auth-07-paypal-checkout-webhook.md` |

### 小幅修改

| 路徑 | 說明 |
|---|---|
| `config.js` | 公開 `window.PAYPAL_ENV` / `window.PAYPAL_CLIENT_ID`（空字串占位） |
| `subscription.html` | 付款狀態 UI；動態載入 SDK（不硬編碼 Client ID） |
| `js/pages/subscription-entry.js` | Official user → PayPal Buttons；成功文案「付款正在確認」 |
| `.env.example` | 僅變數名（含 `PAYPAL_MERCHANT_ID`） |
| `scripts/verify-local.ps1` | 新增 PayPal 相關 `node --check` |

### 刻意未改

- `supabase/functions/subscription-checkout/**`
- `subscription-checkout-handler.*` / `checkout-authorization-service.*`
- Auth / gift / gacha / wallet / account-merge

---

## 2. Migration 清單

- `20260821000200_payment_orders_and_webhook_events.sql`（**未** `db push`）

包含：

- `payment_orders`（`amount NUMERIC`；`paypal_order_id` UNIQUE；`paypal_capture_id` nullable UNIQUE index）
- `payment_webhook_events`（`paypal_event_id` UNIQUE）
- RLS：authenticated 僅可 SELECT 自己的 orders；**不得**寫 status；webhook 表對 anon/authenticated 全拒
- RPC：`create_payment_order`、`attach_paypal_order_id`、`transition_payment_order_status`（禁止 status 倒退）、`process_paypal_webhook_event`（事件＋訂單同一 transaction；重複 event → `duplicate`）
- **無** `user_plan_entitlements` / subscriptions 啟用表

---

## 3. Edge Function 路由

| Function | 路由 | 說明 |
|---|---|---|
| `paypal-checkout` | `POST /functions/v1/paypal-checkout` body `{ action: "create-order" \| "capture-order", ... }` | 瀏覽器 CORS allowlist；需 Supabase JWT；拒絕 anonymous |
| `paypal-webhook` | `POST /functions/v1/paypal-webhook` | PayPal S2S；無瀏覽器 CORS；gateway `verify_jwt=false`；**Function 內強制驗簽** |

`subscription-checkout` 保持獨立 placeholder，未修改。

---

## 4. 訂單狀態轉換

```text
created → approved | capture_pending | paid | denied | failed
approved → capture_pending | paid | denied | failed
capture_pending → paid | denied | failed
paid → refunded | reversed   (only)
denied/failed/refunded/reversed → 不可倒退回較早狀態
```

`paid → capture_pending` 等倒退由 `transition_payment_order_status` 拒絕（`STATUS_REGRESSION_FORBIDDEN`）。

`PAYMENT.CAPTURE.COMPLETED` → 僅標 `paid`（**不**啟用權益）。

---

## 5. Webhook 驗證方法

1. 讀取 **原始** `req.text()` body（禁止 parse 後再 stringify 送驗）
2. 讀 headers：`PAYPAL-AUTH-ALGO` / `CERT-URL` / `TRANSMISSION-ID` / `SIG` / `TIME`
3. 呼叫 PayPal `POST /v1/notifications/verify-webhook-signature`（Sandbox base）
4. 必須 `verification_status === SUCCESS`，否則 **401** 且 **不修改任何付款資料**
5. 成功後才呼叫 `process_paypal_webhook_event` RPC
6. 另核對 `PAYPAL_MERCHANT_ID`（payee merchant），不得只查金額／幣別

---

## 6. 冪等機制

| 層級 | 機制 |
|---|---|
| Create Order | 穩定 `PayPal-Request-Id` = `create_request_id`；同 user+plan 開立中訂單重用 |
| Capture | 穩定 `capture:{internal_id}` |
| Webhook | `paypal_event_id` UNIQUE；重複 → outcome `duplicate` + HTTP 2xx，不重複處理 |
| DB 失敗 | webhook handler 回 **503**，讓 PayPal 重試 |
| 未知事件 | 驗簽成功 → `ignored` + 2xx |

---

## 7. CORS allowlist（paypal-checkout）

沿用 `_shared/cors.ts`：

- `http://localhost:5500`
- `http://localhost:5588`
- `https://starbuckchiang.github.io`

`paypal-webhook` 不套瀏覽器 CORS。

---

## 8. Sandbox 測試結果（本機 mock only）

`.\scripts\verify-local.ps1`：**731 / 731 passing**（0 fail）。

涵蓋（mock PayPal HTTP）：

- 未登入／匿名拒絕 create
- 前端 amount 竄改拒絕；未知 planCode 拒絕
- capture owner mismatch / merchant mismatch
- capture 成功文案僅「付款正在確認」
- webhook 缺簽章／驗簽失敗不寫庫
- COMPLETED 處理＋重複 2xx
- 未知事件 ignored
- DB 失敗 503
- migration shape（unique／numeric／RLS／無 entitlements 表）

**未執行**：真實 Sandbox 建單、Capture、Webhook 註冊、真實 buyer 流程。

---

## 9. 尚未完成項目

- 真實 Sandbox secrets 配置與（經批准後）Sandbox 聯測
- Webhook 註冊與真實 signature 端到端
- 權益規則（效期、開始時點、重複購買、退款撤銷）→ 下一個 Gate
- `config.js` 中 `PAYPAL_CLIENT_ID` 仍為空（需人工填入 Sandbox Client ID）
- migration / functions **未**套用到任何遠端專案

---

## 10. Secret 設定清單（不得寫入實際值）

| 名稱 | 位置 | 公開？ |
|---|---|---|
| `PAYPAL_ENV=sandbox` | Edge secret + `window.PAYPAL_ENV` | env 可公開為 sandbox |
| `PAYPAL_CLIENT_ID` | Edge secret + `window.PAYPAL_CLIENT_ID` | 可公開 |
| `PAYPAL_CLIENT_SECRET` | Edge secret only | **否** |
| `PAYPAL_WEBHOOK_ID` | Edge secret only | **否** |
| `PAYPAL_MERCHANT_ID` | Edge secret only | **否** |

---

## 11. 是否可以進行 Sandbox deployment

**否（本 Gate 停止）。**  
程式可進入後續「人工批准的 Sandbox deploy Gate」，但 **本 Gate 不得 deploy**。

Gate 結果為 `PARTIAL`，不是 `SAFE_FOR_PAYPAL_SANDBOX_DEPLOY`。

---

## `supabase/config.toml` 完整內容與影響

本 Gate **新增**檔案（本機準備，**未部署**）：

```toml
# Auth-07 local Supabase config (NOT deployed by this Gate).
# Only paypal-webhook disables gateway JWT verification because PayPal
# cannot send a Supabase JWT. Signature verification remains mandatory
# inside the Edge Function. All other functions keep default verify_jwt=true.

[functions.paypal-webhook]
verify_jwt = false
```

影響：

- 僅 `paypal-webhook` 在 gateway 層跳過 Supabase JWT
- 其他 functions（含 `paypal-checkout`、`subscription-checkout`、`wallet-ops` 等）維持預設 `verify_jwt = true`
- **不**等於 webhook 可不驗證：Function 內仍強制 PayPal signature verification
- 本檔存在**不**授權執行 `supabase functions deploy`

---

## Server plan whitelist（與 UI 一致）

| planCode | amount | currency |
|---|---|---|
| monthly | 5.00 | USD |
| yearly | 48.00 | USD |

→ 未觸發 `BLOCKED_PLAN_CONFIG`。

---

## Blocked items

- `BLOCKED_REFUND_POLICY`（退款／reversed 後如何處理權益未定義；本 Gate 只記錄狀態）
- 權益啟用留待下一 Gate（本 Gate 禁止建立 entitlements）
- PayPal Sandbox secrets／真實聯測未完成 → 不足以 `SAFE_FOR_PAYPAL_SANDBOX_DEPLOY`

---

## Copilot 最終回報

```text
Auth-07 Result:
Gate: PARTIAL
Changed Files: see section 1
Migrations: 20260821000200_payment_orders_and_webhook_events.sql (not pushed)
Edge Functions: paypal-checkout, paypal-webhook (not deployed); subscription-checkout untouched
Webhook Verification: raw-body PayPal signature verify + PAYPAL_MERCHANT_ID check
Idempotency: PayPal-Request-Id + paypal_event_id unique + status non-regression RPC
Tests Passed: 731/731 (verify-local); mock PayPal HTTP only
Tests Failed: 0
Blocked Items: BLOCKED_REFUND_POLICY; entitlements deferred; no real Sandbox config/deploy
Secrets Required: PAYPAL_ENV, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_MERCHANT_ID
Production Deployment Performed: NO
Live Payment Performed: NO
```
