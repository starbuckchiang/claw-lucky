# review-auth-07B.2-sandbox-e2e

Auth-07B.2：PayPal Sandbox 真實 E2E（Orders v2 monthly USD 5）。

```text
Gate: E2E_FAILED
```

```text
Error: CAPTURE_MERCHANT_MISMATCH
Live PayPal: NO
Webhook Simulator: NO
code/migration edited: NO
manual status→paid: NO
git add/commit/push: NO
frontend deploy: NO
entitlements created: NO
```

---

## 開始前設定檢查

| # | 檢查 | 結果 |
|---|---|---|
| 1 | `verify-local` | **746 / 746** PASS |
| 2 | `20260821000200` local = remote | **PASS** |
| 3 | `paypal-checkout` ACTIVE / `verify_jwt=true` | **PASS**（v2） |
| 4 | `paypal-webhook` ACTIVE / `verify_jwt=false` | **PASS**（v2） |
| 5 | Secret **名稱** `PAYPAL_ENV` / `CLIENT_ID` / `CLIENT_SECRET` / `MERCHANT_ID` / `WEBHOOK_ID` | **全部 PRESENT**（未讀取／輸出值） |
| 6 | `config.js`：`PAYPAL_ENV=sandbox`、Client ID 非空 | **PASS** |
| 7–8 | Webhook URL + 事件清單（Developer Dashboard 目視） | **未在本 Gate 完成獨立 Dashboard 目視**；後續真實事件已到達 webhook endpoint，證明 URL 至少可收事件 |
| 9 | Baseline | `payment_orders=0`，`payment_webhook_events=0` |

---

## Official User 狀態

- 測試起點修正：`beta.html` → 抽扭蛋 → `gift.html` → `subscription.html`（未直接冷開 subscription）。
- 匿名 session 建立成功後再跑 Email OTP／既有帳號合併。
- 付款前：`hasSession=true`，`is_anonymous=false`，Email 已驗證。
- **未**記錄 Email、完整 UID、access／refresh token、OTP、Sandbox 密碼。

---

## monthly USD 5 Order

| 欄位 | 值 |
|---|---|
| internal `payment_orders.id` | `cdce5c79-3025-4b4c-92d7-4caa12608d6d` |
| `paypal_order_id` | `90T780620H780851Y` |
| `create_request_id` | `create:5020bf33-…:monthly:monthly:1787304490364`（UID 截斷） |
| `plan_code` | `monthly` |
| `amount` / `currency` | `5.00` / `USD` |
| create-order request body | 僅 `action=create-order`、`planCode=monthly`、idempotencyKey（**無**可信任 amount） |
| 建立後 status | `created` |

環境：`sandbox.paypal.com`（非 Live）。

---

## Capture 結果

| 檢查 | 結果 |
|---|---|
| `POST /functions/v1/paypal-checkout` `action=capture-order` | **HTTP 502** |
| 錯誤碼 | `MERCHANT_MISMATCH` |
| sanitized message | `Capture payee merchant mismatch.` |
| `paypal_capture_id`（內部訂單） | **仍為空** |
| 訂單最終 status | **`failed`** |
| `paid_at` | **NULL** |
| UI | 顯示「付款正在確認」；**未**顯示「訂閱已啟用」 |

判定：PayPal Capture **有**在 Sandbox 完成（見下方真實 `PAYMENT.CAPTURE.COMPLETED`），但 Edge capture 路徑比對 payee merchant 與 secret `PAYPAL_MERCHANT_ID` 不一致後，將內部訂單標為 `failed`。  
**未**輸出完整 Merchant ID。

開放訂單：同使用者／同方案無第二筆 `created|approved|capture_pending`。  
第二次 Capture：未觀察到成功的第二次 capture 寫入。

---

## 真實 Webhook 驗簽與處理

| paypal_event_id（前綴） | event_type | verification_status | processing_status | notes |
|---|---|---|---|---|
| `WH-6TK8806856189011G-5AK…` | `CHECKOUT.ORDER.APPROVED` | **SUCCESS** | `processed` | 對應同一 `paypal_order_id` |
| `WH-98K494663R491925H-2XK…` | `PAYMENT.CAPTURE.COMPLETED` | **SUCCESS** | `processed` | 真實事件（非 Simulator）；`has_capture_id=true` |

必過項對照：

1. signature verification = `SUCCESS` → **PASS**（COMPLETED）
2. `payment_webhook_events` 新增真實 event → **PASS**（+2 不同 event id）
3. event type `PAYMENT.CAPTURE.COMPLETED` → **PASS**
4. processing status 成功 → event 列為 `processed`
5. PayPal Order ID 對應同一內部訂單 → **PASS**（`90T780620H780851Y`）
6–8. 訂單 `status=paid` / `paid_at` 非空 / capture 寫回 → **FAIL**（仍為 `failed`／無 `paid_at`／無內部 capture id）

原因（唯讀）：`transition_payment_order_status` **禁止** `failed` → `paid`（`STATUS_REGRESSION_FORBIDDEN`）。capture 路徑先寫 `failed` 後，webhook RPC 對 regression 採 catch-and-continue，事件仍可能記為 `processed`，但訂單不升為 `paid`。

**未**貼 Webhook signature、完整 payload 個資、Client Secret、access token。

---

## Webhook 重送冪等

**未執行。**

前置條件「訂單已因真實 COMPLETED 進入 `paid`」未達成；依 Prompt 不得手動改 paid、不得用 Simulator。冪等 Resend 留待 merchant 設定修正後重跑。

---

## 重新整理／UI

- 當下 UI：`付款正在確認`；無「訂閱已啟用」。
- Console：可見 capture **502**；**未**見 Client Secret／access token 被應用程式 log 輸出（Network 工具原始標頭含 JWT——審查文件不轉載）。

---

## 資料庫 before / after

| 表／項目 | before | after |
|---|---|---|
| `payment_orders` | 0 | **1**（`status=failed`） |
| `payment_webhook_events` | 0 | **2**（APPROVED + COMPLETED，不同 `paypal_event_id`） |
| monthly amount | — | `5.00` USD |
| `entitlements` | — | **表不存在**（`to_regclass` null）；未啟用權益 |
| points／tickets／coins | — | 付款管線未寫入 wallet；本 Gate **未**改 balances |

---

## Gate 結論

```text
E2E_FAILED
```

```text
Error classification: CAPTURE_MERCHANT_MISMATCH
```

失敗摘要：

1. Capture Edge 回應 `MERCHANT_MISMATCH` → 內部訂單 `failed`。
2. 真實 `PAYMENT.CAPTURE.COMPLETED` 已到達且驗簽 `SUCCESS`，但無法把已 `failed` 的訂單升為 `paid`。
3. 因此不滿足 Prompt 必過項：`payment_orders.status = paid` 且 `paid_at` 非空。

本 Gate **停止**。未修碼、未手動標 paid、未 commit／push、未使用 Webhook Simulator、未跑 Live Payment。
