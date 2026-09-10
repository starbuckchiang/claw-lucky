# review-auth-07C.1-paypal-subscriptions-plan

Auth-07C.1：PayPal 自動續訂（Subscriptions v1）架構與 Migration Plan。  
**設計／影響分析 only** — 本 Gate **未**改碼、未建 migration、未建立 PayPal Product／Plan、未付款、未部署。

> **07C.1A supersession：** Plan ID 信任模型、訂閱建立 session／`custom_id`、webhook 早到、`user_subscription_slots` 原子防重複、SALE 欄位、`paid_through` 演算法、退款／沖銷政策，以  
> [`review-auth-07C.1A-paypal-subscriptions-design-fix.md`](./review-auth-07C.1A-paypal-subscriptions-design-fix.md)  
> 為準。本文件保留產品決策與資源／表概覽；衝突處以 07C.1A 鎖定為準。

前置：`docs/0-review/review-auth/review-auth-07B.2.4-sandbox-e2e.md`（Orders v2 monthly Sandbox **SANDBOX_E2E_PASS**）。

```text
Gate: READY_FOR_IMPLEMENTATION (see 07C.1A for corrected trust/state details)
```

```text
Code Changed: NO
PayPal Resources Created: NO
Payment Attempted: NO
Deployment Performed: NO
Commit/Push Performed: NO
Migration Applied: NO
Secrets Changed: NO
```

---

## 0. 產品決策（鎖定）

| 項目 | 決策 |
|---|---|
| monthly | USD **5.00**，每 **1 MONTH** 自動續訂 |
| yearly | USD **48.00**，每 **1 YEAR** 自動續訂 |
| 試用／setup fee | **無**；setup_fee = 0 |
| 首期 | **立即付款** |
| `auto_bill_outstanding` | **true** |
| `payment_failure_threshold` | **3** |
| API | PayPal **Subscriptions v1** |
| Merchant／App | 與現有 Sandbox Business **同一** App |
| 取消 | 停止續扣；權益保留至目前 **`paid_through`** |
| 既有 `payment_orders` | **legacy audit**；**不**轉換為 subscription |
| 免費權益 | **不**建立 |
| points／tickets／coins | **不**因訂閱修改 |

---

## 1. PayPal 資源設計

### 1.1 Product（Sandbox）

```text
type = SERVICE
name = Lucky Buddies Subscription (Sandbox)
```

一個 Product 下掛兩個 Plan（實作 Gate 才呼叫 Catalog API 建立；本 Gate **不**建立）。

### 1.2 Plans（無限期 REGULAR）

| plan_code | interval_unit | interval_count | total_cycles | fixed_price |
|---|---|---|---|---|
| `monthly` | `MONTH` | 1 | **0**（無限） | USD **5.00** |
| `yearly` | `YEAR` | 1 | **0** | USD **48.00** |

`payment_preferences`（兩 Plan 共用）：

```text
auto_bill_outstanding = true
setup_fee.value = "0" / currency = USD
setup_fee_failure_action = CANCEL
payment_failure_threshold = 3
```

無 `trial` billing cycle。

### 1.3 Server whitelist（必做）

擴充現有 `paypal-plans`（Orders SKU）為 **雙層**：

| 欄位 | 來源 | 信任 |
|---|---|---|
| `planCode` | `monthly` \| `yearly` | 前端可選 **code only** |
| `recurringAmount` / `currency` | 伺服器常數 | **永不**信前端 |
| `paypalPlanId` | Edge Secret／環境（Sandbox／Live 分開） | **永不**信前端 |

前端 **禁止**提交任意 `plan_id`、價格、幣別。  
確認 Function 必須：`GET /v1/billing/subscriptions/{id}` → 比對回傳 `plan_id` ∈ whitelist。

建議 Secrets／config **名稱**（不建、不輸出值）：

```text
PAYPAL_ENV                          (既有)
PAYPAL_CLIENT_ID                    (既有)
PAYPAL_CLIENT_SECRET                (既有)
PAYPAL_WEBHOOK_ID                   (既有；Dashboard 須加訂閱事件)
PAYPAL_MERCHANT_ID                  (既有)
PAYPAL_SUBSCRIPTION_PRODUCT_ID      (新)
PAYPAL_PLAN_ID_MONTHLY              (新)
PAYPAL_PLAN_ID_YEARLY               (新)
```

`config.js` 公開面仍只暴露 `PAYPAL_ENV` + Client ID；**不**公開 Plan ID（可選：僅由 create-subscription Edge 回傳給 SDK，避免前端硬編）。

---

## 2. 前端整合設計

### 2.1 現況 → 目標

| 現況（07B Orders v2） | 目標（07C Subscriptions） |
|---|---|
| SDK `intent=capture` | SDK `intent=subscription` + `vault=true` + `currency=USD` |
| `createOrder` → Edge create-order | `createSubscription` → Edge **create-subscription**（回傳 `paypal_plan_id`／subscription 建立所需資訊） |
| `onApprove` → Edge capture-order | `onApprove` → Edge **confirm-subscription**（只傳 `subscriptionID`） |
| UI「付款正在確認」 | UI「訂閱確認中」；**不**因 onApprove 宣稱永久權益 |

### 2.2 信任邊界

```text
Browser onApprove(subscriptionID)
  → JWT Edge confirm-subscription
      1. require official Supabase user (非 anonymous)
      2. GET PayPal subscription
      3. plan_id ∈ server whitelist
      4. merchant / PAYPAL_ENV = sandbox|live 一致
      5. bind paypal_subscription_id ↔ user_id
      6. reject 若同 user 已有 ACTIVE | APPROVAL_PENDING
      7. 不因 confirm  alone 發放「永久」權益
         （權益以 paid_through + SALE.COMPLETED／ACTIVATED 為準）
```

前端 **不得**直接呼叫 PayPal REST Cancel／GET。

### 2.3 頁面狀態（見 §5）

- 無有效訂閱：顯示方案＋訂閱按鈕（與現有 Auth／OTP 升級流程並存）。
- 有 `ACTIVE`／`APPROVAL_PENDING`：**隱藏**可付款按鈕。
- 有 `CANCELLED` 但仍 `now < paid_through`：顯示「可使用至 …」；可選擇是否允許再次訂閱（建議：**到期前禁止**再開第二張 ACTIVE，避免雙重扣款；到期後才開新訂閱）。
- Legacy Orders `payment_orders.status=paid`：**不得**當成自動續訂；UI 明確區分「歷史一次付款」vs「訂閱」。

---

## 3. 資料庫設計

### 3.1 新表：`paypal_subscriptions`

| 欄位 | 說明 |
|---|---|
| `id` UUID PK | 內部 id |
| `user_id` TEXT NOT NULL | Supabase auth user id |
| `plan_code` TEXT NOT NULL | `monthly` \| `yearly` |
| `paypal_subscription_id` TEXT UNIQUE NOT NULL | PayPal subscription id |
| `paypal_plan_id` TEXT NOT NULL | 當時綁定的 Plan ID |
| `status` TEXT NOT NULL | 見狀態機 §4 |
| `currency` TEXT NOT NULL | 預期 `USD` |
| `recurring_amount` NUMERIC(12,2) NOT NULL | 5.00／48.00 |
| `start_time` TIMESTAMPTZ | |
| `next_billing_time` TIMESTAMPTZ | 來自 PayPal |
| `last_payment_time` TIMESTAMPTZ | |
| `paid_through` TIMESTAMPTZ | **權益截止**（SoT 之一） |
| `cancelled_at`／`suspended_at` | |
| `created_at`／`updated_at` | |

建議約束／索引：

- `UNIQUE (paypal_subscription_id)`
- **Partial unique**：每 `user_id` 至多一筆 `status IN ('APPROVAL_PENDING','ACTIVE')`（防雙 ACTIVE）
- RLS：owner SELECT；deny auth／anon writes；mutation 僅 service_role RPC

建議內部 status 對齊 PayPal（大寫）或映射表：  
`APPROVAL_PENDING`｜`ACTIVE`｜`SUSPENDED`｜`CANCELLED`｜`EXPIRED`｜`APPROVED`（若出現）｜內部 `FAILED_SETUP`（可選）。

### 3.2 新表：`paypal_subscription_transactions`

| 欄位 | 說明 |
|---|---|
| `id` UUID PK | |
| `paypal_event_id` TEXT UNIQUE | webhook 冪等（或與 sale_id 二擇一／複合） |
| `paypal_sale_id` TEXT UNIQUE NULL | `PAYMENT.SALE.*` resource id |
| `paypal_subscription_id` TEXT NOT NULL | FK 邏輯關聯 |
| `amount`／`currency` | 驗證後寫入 |
| `status` | `completed`｜`refunded`｜`reversed`｜`failed`… |
| `payment_time` | |
| `payload` JSONB | **sanitize**：禁止存 payer Email／地址／完整 PII；只留 event 類型、金額、id |
| `created_at` | |

**權益延長只在** `PAYMENT.SALE.COMPLETED`（驗證通過）時更新 `paid_through`（通常設為 PayPal `next_billing_time`，或 SALE 時間＋plan interval 作為 fallback，以 GET subscription 為準）。

### 3.3 `payment_webhook_events`：沿用＋擴充

| 議題 | 結論 |
|---|---|
| 能否支援 subscription event？ | **能**：同一 endpoint／表；`paypal_event_id` **UNIQUE** 已足夠跨 Orders／Subscriptions 冪等 |
| 向後相容 | **additive**：新增可空欄 `paypal_subscription_id`、`paypal_sale_id`；舊 Orders 列不變 |
| 未知事件 | 維持 insert `ignored`（仍佔用 event id → 重送安全） |
| 驗簽 | 所有事件先 `verifyWebhookSignature`；**不得**先寫業務表 |
| RPC | **新建** `process_paypal_subscription_webhook_event(...)`（或分支函式）；**勿**把 `PAYMENT.SALE.COMPLETED` 硬塞進現有 Orders `process_paypal_webhook_event` |

### 3.4 Legacy `payment_orders`

- **保留**表與 RPC；**不刪**、**不改**既有 paid／failed 列語意。  
- 現有 Sandbox paid 單（`06d36e44…`）**不轉換**、不回填 subscription。  
- Orders v2 路徑可標為 **legacy**（見 §6）。

### 3.5 Migration 需求

```text
Migration Required: YES (additive; not authored in this Gate)
```

建議後續單一（或拆兩段）migration：

1. `paypal_subscriptions` + RLS + RPCs（create／bind／transition／cancel flags）  
2. `paypal_subscription_transactions` + RLS  
3. `payment_webhook_events` 加可空 subscription／sale 欄位＋索引  
4. **不**建 `user_plan_entitlements` 免費列；若另開 entitlement 表，僅由訂閱 SoT 驅動（見 §4.3）

---

## 4. Webhook 狀態機

### 4.1 必處理事件

| event_type | 行為摘要 |
|---|---|
| `BILLING.SUBSCRIPTION.CREATED` | upsert 訂閱列；多為 `APPROVAL_PENDING` |
| `BILLING.SUBSCRIPTION.ACTIVATED` | → `ACTIVE`；可同步 `start_time`／`next_billing_time`；**仍建議**等 SALE.COMPLETED 才延長 `paid_through`（或 ACTIVATED＋已有首期付款證據） |
| `BILLING.SUBSCRIPTION.UPDATED` | 刷新 plan／next_billing；**禁止**狀態倒退 |
| `BILLING.SUBSCRIPTION.SUSPENDED` | → `SUSPENDED`；**不**延長 `paid_through` |
| `BILLING.SUBSCRIPTION.CANCELLED` | → `CANCELLED`；`cancelled_at`；權益用至 `paid_through` |
| `BILLING.SUBSCRIPTION.EXPIRED` | → `EXPIRED`；不再延長 |
| `BILLING.SUBSCRIPTION.PAYMENT.FAILED` | 記錄失敗；**不**新增權益；可維持 ACTIVE 至 threshold／SUSPENDED |
| `PAYMENT.SALE.COMPLETED` | 驗證 amount／currency／subscription／merchant → 寫 transaction → 更新 `last_payment_time`＋`paid_through`（← `next_billing_time`） |
| `PAYMENT.SALE.REFUNDED` | transaction → refunded；進入 **人工審核／撤銷規則**（縮短或清空 `paid_through` 需明確政策；建議預設：標記 `needs_review`，不自動雙重懲罰） |
| `PAYMENT.SALE.REVERSED` | 同上，reversed |

### 4.2 共用規則

1. **先驗簽**；失敗不寫業務。  
2. **`paypal_event_id` 唯一**；重送 → `duplicate`。  
3. amount／currency／plan_id／subscription 歸屬／merchant **必須**驗證。  
4. **亂序防護**：訂閱 status 使用 rank（類似 `payment_order_status_rank`）：例如 `EXPIRED`／`CANCELLED` 不可被舊 `UPDATED` 打回 `ACTIVE`；`paid_through` 只允許 **單調延長**（除非 REFUND／REVERSE 審核路徑明確縮短）。  
5. `PAYMENT.FAILED`／payment failed：**零權益增量**。

### 4.3 Entitlement Source of Truth

```text
Entitlement Source Of Truth:
  paypal_subscriptions.paid_through
  + status not blocking access while now < paid_through
  (CANCELLED 仍可讀至 paid_through；SUSPENDED/EXPIRED 不延長；
   ACTIVE 且 now < paid_through 為有效)
```

本階段 **不**實作 points／tickets／coins；讀取權益的產品功能另 Gate 接此 SoT。

---

## 5. 重複訂閱與 UI／取消

| 規則 | 設計 |
|---|---|
| 重複訂閱 | DB partial unique + confirm Function 雙重拒絕 |
| UI | ACTIVE／APPROVAL_PENDING → 隱藏訂閱按鈕；顯示方案、狀態、`next_billing_time`／`paid_through` |
| 取消入口 | 「取消自動續訂」→ JWT Function → PayPal `POST /v1/billing/subscriptions/{id}/cancel` |
| 取消後文案 | 「可使用至 {paid_through}」 |
| Legacy paid order | 單獨區塊或忽略；**不可**顯示為訂閱中 |

---

## 6. 既有系統影響

| 元件 | 決策 |
|---|---|
| `payment_orders`／Orders v2 | **保留** legacy audit |
| `paypal-checkout` | **保留**；標記 legacy one-time；**或**凍結不再從 `subscription.html` 呼叫 |
| 新 Function | `paypal-subscription`（建議單一入口多 action）：`create-subscription`、`confirm-subscription`、`cancel-subscription`、`get-subscription-status`；`verify_jwt=true` |
| 可改用既有 placeholder | `subscription-checkout` 目前僅 Auth stub → **可退役或改建**為 confirm／cancel 殼；避免兩套平行 Auth |
| `paypal-webhook` | **修改**：驗簽後依 `event_type` 分流 Orders RPC vs Subscriptions RPC |
| `paypal-client` | **擴充**：Subscriptions GET／Create／Cancel；**不**移除 Orders helpers |
| `paypal-plans` | **擴充** `paypalPlanId` 映射 |
| Frontend | `subscription-entry.js`＋新／改 `paypal-subscription-service.js`；SDK 參數切換 |
| 現有 paid Sandbox order | **不轉換** |
| Webhook Dashboard | 同一 `PAYPAL_WEBHOOK_ID` **加訂** §4.1 事件（實作 Gate 操作；本 Gate 不做） |

### Functions 清單

```text
New Functions:
  - paypal-subscription (JWT ON) — create / confirm / cancel / status

Functions Modified:
  - paypal-webhook (event branch + subscription RPC)
  - paypal-client / paypal-plans shared libs
  - subscription.html + subscription-entry (+ SDK intent)
  - (optional) retire or repurpose subscription-checkout placeholder

Functions Retained (legacy):
  - paypal-checkout (Orders v2)
```

---

## 7. 安全與測試矩陣

| # | 案例 | 期望 |
|---|---|---|
| 1 | 偽造 `plan_id`／前端改價 | confirm／webhook **拒絕** |
| 2 | 他人 `subscriptionID` | 綁定失敗／owner mismatch |
| 3 | 重複 `onApprove` | 冪等 confirm；不雙寫 ACTIVE |
| 4 | 重複 webhook | `duplicate`；不延長兩次 |
| 5 | webhook 亂序 | 不狀態倒退；`paid_through` 不回縮（除非審核路徑） |
| 6 | 首次付款成功 | SALE.COMPLETED → transaction + paid_through |
| 7 | 月／年續扣成功 | 同上延長 |
| 8 | payment failed | 無權益增量 |
| 9 | suspended | 不延長；UI 反映 |
| 10 | cancelled | 停扣；用至 paid_through |
| 11 | refunded／reversed | needs_review／明確撤銷規則 |
| 12 | amount／currency mismatch | reject |
| 13 | Merchant mismatch | reject |
| 14 | JWT 缺失／anonymous | 401／403 |
| 15 | 同 user 第二個 ACTIVE | DB＋API 雙拒 |
| 16 | Sandbox／Live plan ID 混用 | env 隔離；錯 env → reject |

Mock：擴充既有 `paypal-checkout-webhook` 測試風格；Subscriptions 另檔。  
E2E：Sandbox Buyer；**禁止** Live；不與 legacy Orders 混測同一按鈕路徑。

---

## 8. 建議實作切片（後續 Gate，本文件不執行）

1. **07C.2** Migration＋RPC＋whitelist secrets 名稱就緒  
2. **07C.3** PayPal Catalog 建立 Product／Plans（Sandbox only）寫入 Secrets  
3. **07C.4** `paypal-subscription` Function＋webhook 分流  
4. **07C.5** Frontend SDK 切換＋防重複 UI＋取消  
5. **07C.6** Sandbox E2E（activate → SALE → cancel → paid_through）  
6. 產品讀取 `paid_through` 接權益（仍不碰 points／tickets／coins，除非另決策）

---

## 9. Open Risks

1. **首期權益時機**：僅 `ACTIVATED` vs 必須等 `PAYMENT.SALE.COMPLETED` — 建議以 **SALE.COMPLETED** 為準延長 `paid_through`，避免無款權益。  
2. **Webhook 事件清單** 須在 Developer Dashboard 更新；漏訂會導致只靠 confirm 輪詢補償。  
3. **REFUNDED／REVERSED** 自動撤銷政策需產品確認（建議先 `needs_review`）。  
4. **Legacy Orders paid** 使用者與新訂閱並存時的 UI／權益優先序需產品一句話（建議：訂閱 SoT 優先；legacy 不自動等同訂閱）。  
5. **PayPal Plan ID** 在 Sandbox／Live 不同；部署檢查清單必須防混用。  
6. `subscription-checkout` placeholder 與新 Function 命名易混淆 — 實作時統一命名。

---

```text
Auth-07C.1 Result:
Recurring Model: PayPal Subscriptions v1 (same Sandbox Business App)
Monthly Plan: USD 5.00 / MONTH x1 / total_cycles=0 / no trial
Yearly Plan: USD 48.00 / YEAR x1 / total_cycles=0 / no trial
Free Trial: NO
Initial Charge: IMMEDIATE (setup_fee=0; auto_bill_outstanding=true; failure_threshold=3)
Legacy Orders Retained: YES (payment_orders audit; paypal-checkout kept as legacy)
Existing Paid Order Converted: NO
Database Tables Proposed: paypal_subscriptions; paypal_subscription_transactions; payment_webhook_events additive columns
Migration Required: YES (not authored this Gate)
New Functions: paypal-subscription (create/confirm/cancel/status; verify_jwt=ON)
Functions Modified: paypal-webhook; paypal-client; paypal-plans; subscription frontend; optional subscription-checkout repurpose
Webhook Events: BILLING.SUBSCRIPTION.CREATED|ACTIVATED|UPDATED|SUSPENDED|CANCELLED|EXPIRED|PAYMENT.FAILED; PAYMENT.SALE.COMPLETED|REFUNDED|REVERSED
Entitlement Source Of Truth: paypal_subscriptions.paid_through (+ access while now < paid_through; cancel keeps through date)
Duplicate Subscription Prevention: partial unique ACTIVE|APPROVAL_PENDING per user + confirm Function check
Cancellation Access Rule: JWT Edge → PayPal Cancel API only; UI shows access until paid_through
Secrets/Config Required: existing PAYPAL_* + PAYPAL_SUBSCRIPTION_PRODUCT_ID + PAYPAL_PLAN_ID_MONTHLY + PAYPAL_PLAN_ID_YEARLY (names only)
Code Changed: NO
PayPal Resources Created: NO
Payment Attempted: NO
Deployment Performed: NO
Commit/Push Performed: NO
Open Risks: first-period timing (prefer SALE.COMPLETED); Dashboard event subscription; refund/reverse policy; legacy-vs-subscription UI priority; Sandbox/Live plan mix
Gate: READY_FOR_IMPLEMENTATION
```
