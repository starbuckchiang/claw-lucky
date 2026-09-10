# review-auth-07C.1A-paypal-subscriptions-design-fix

Auth-07C.1A：PayPal Subscriptions 設計缺口修正（**僅設計文件**）。

前置：`docs/0-review/review-auth/review-auth-07C.1-paypal-subscriptions-plan.md`  
本文件 **覆寫／鎖定** 07C.1 中未決或錯誤的信任模型與狀態機細節。

```text
Gate: READY_FOR_IMPLEMENTATION
```

```text
Code Changed: NO
Migration Created: NO
PayPal Resources Created: NO
Secrets Changed: NO
Deployment Performed: NO
Payment Attempted: NO
Commit/Push Performed: NO
```

---

## 1. Plan ID 信任模型（修正）

### 錯誤（07C.1 舊敘述）

「Plan ID 對前端保密／永不信前端」——**不成立**。  
PayPal JS SDK `actions.subscription.create({ plan_id })` 時，瀏覽器**必然可見** plan_id。

### 鎖定模型

| 項目 | 規則 |
|---|---|
| Plan ID 性質 | **公開配置值**（非 Secret）；Sandbox／Live **必須分開設定** |
| 前端取得方式 | **只能**向 JWT Edge `create-subscription-session` 索取所選 `plan_code` 對應的 allowlisted `plan_id` |
| 前端禁止 | 硬編任意 plan_id、自造價格／幣別、信任自己送的 userId |
| 竄改防護 | 即使使用者改 SDK `plan_id`，`confirm-subscription` 與 webhook 仍必須：`GET /v1/billing/subscriptions/{id}`，驗證 `plan_id ∈ env whitelist`、amount、currency、`PAYPAL_ENV` |
| 真正 Secret | 僅 `PAYPAL_CLIENT_SECRET` 等憑證；Plan／Product ID 可放 Edge env（不必當「不可見 Secret」行銷） |

建議設定名稱（仍不建值）：

```text
PAYPAL_PLAN_ID_MONTHLY_SANDBOX / PAYPAL_PLAN_ID_YEARLY_SANDBOX
PAYPAL_PLAN_ID_MONTHLY_LIVE    / PAYPAL_PLAN_ID_YEARLY_LIVE
```

或依 `PAYPAL_ENV` 選一組 `PAYPAL_PLAN_ID_MONTHLY`／`YEARLY`（部署環境隔離）。

---

## 2. 訂閱建立架構（鎖定，不混用）

採用 **單一** 路徑：

```text
1. JWT Edge  create-subscription-session
2. 驗證 official user（非 anonymous）且無 blocking subscription slot
3. 建立內部列：
     status = APPROVAL_PENDING
     checkout_session_id = 不可猜測 UUID（或 128-bit random）
     佔用 user subscription slot
4. 回傳 { checkout_session_id, plan_id, plan_code, amount, currency }
5. Browser PayPal SDK:
     vault=true
     intent=subscription
     actions.subscription.create({
       plan_id,                    // 來自步驟 4
       custom_id: checkout_session_id
     })
6. onApprove → JWT Edge confirm-subscription
     body: { subscriptionID, checkout_session_id }
7. Server:
     GET subscription
     驗證 plan_id / amount / currency / env / custom_id==checkout_session_id
     綁定 paypal_subscription_id ↔ user_id + session
```

### `custom_id` 可行性

**允許。** PayPal Subscriptions Create API 與 JS SDK `actions.subscription.create` 支援 `custom_id`（1–127 可見 ASCII）。  
本設計將 `custom_id` **固定為** server 簽發的 `checkout_session_id`（**不是** Email、不是明文 user_id）。

若未來 SDK／API 異常缺少 `custom_id` 回傳：等價備援為  
`confirm` 以 `(subscriptionID + checkout_session_id)` 查 pending session，並用 GET subscription 的 `custom_id` 交叉驗證；**禁止**用 payer Email／姓名綁定。

---

## 3. Webhook 早於 confirm

| 情況 | 處理 |
|---|---|
| 事件已驗簽 | **永不丟棄** |
| 能以 `custom_id`（=`checkout_session_id`）或之後已知的 `paypal_subscription_id` 找到 pending session | 套用狀態／記 transaction（仍不錯綁 user：session 已綁 `user_id`） |
| 找不到本地列 | `payment_webhook_events.processing_status = pending_resolution`（或等價欄位）；保留 event id |
| confirm 稍後完成綁定 | **冪等** replay／resolve pending events for that subscription／session |
| 禁止 | 依 Email／姓名／前端 user_id 猜測綁定；把訂閱綁給錯誤 user |

`BILLING.SUBSCRIPTION.*` resource 通常含 subscription `id`；可先寫「未綁 user 的 holding」僅當能用 `custom_id` 對上 session。  
無 `custom_id` 且尚無本地 subscription 列 → **只** `pending_resolution`，等 confirm 帶 `subscriptionID` 對齊後再處理。

---

## 4. 重複訂閱防護（原子、無 `now()` unique）

### Blocking 定義（產品）

使用者 **不可**再開新訂閱，若存在任一：

- `APPROVAL_PENDING`
- `APPROVED`
- `ACTIVE`
- `CANCELLED` 且 **`paid_through` 仍有效**（權益未到期）

（`SUSPENDED`：建議亦視為 blocking，直到明確釋放政策；預設 **blocking**。）

### 為何不能 `UNIQUE (... ) WHERE paid_through > now()`

PostgreSQL partial unique **不得**依賴 `now()`（非 IMMUTABLE／會隨時間漂移）。

### 可實作方案（鎖定）：`user_subscription_slots`

```text
user_subscription_slots
  user_id TEXT PRIMARY KEY
  paypal_subscription_id TEXT NULL   -- 當前佔用者
  checkout_session_id TEXT NULL
  slot_state TEXT NOT NULL
      -- OCCUPIED | RELEASED
  occupied_at TIMESTAMPTZ
  release_after TIMESTAMPTZ NULL      -- CANCELLED 時 = paid_through
  released_at TIMESTAMPTZ NULL
```

規則：

1. `create-subscription-session` 以 **單一 RPC**（`FOR UPDATE` 或 `INSERT … ON CONFLICT`）嘗試將 `slot_state` 從 `RELEASED`（或不存在）→ `OCCUPIED`。  
2. 兩個並發請求：只有一個成功；另一個回 `SUBSCRIPTION_SLOT_OCCUPIED`。  
3. **不**用 partial unique + `now()`；到期釋放：

```text
release_subscription_slot_if_due(user_id):
  IF slot_state = OCCUPIED
     AND release_after IS NOT NULL
     AND release_after <= now()
     AND subscription status IN (CANCELLED, EXPIRED, …)
  THEN slot_state = RELEASED
```

呼叫點：create-session 開頭、status 查詢、排程（可選）。

4. **取消時**：PayPal status → `CANCELLED`；`release_after = paid_through`；**到期前不** `RELEASED`。  
5. UI 隱藏按鈕只是 UX；**權威**在 slot RPC。

`paypal_subscriptions` 仍保留業務列；slot 是跨狀態的 **單槽互斥**。

---

## 5. `PAYMENT.SALE.COMPLETED` 關聯欄位（精確）

依 PayPal Sale／真實 Sandbox webhook 慣例（**實作 Gate 須用官方 fixture 再驗一次**；此處不假設未見欄位）：

| 資料 | webhook `resource` 欄位 |
|---|---|
| Subscription ID | **`billing_agreement_id`**（形如 `I-…`；即 billing subscription id） |
| Sale ID | **`id`** |
| Amount | **`amount.total`**（舊 Payments sale 形狀） |
| Currency | **`amount.currency`** |
| Payment time | **`create_time`**（必要時參考 `update_time`） |
| 可選 custom | 部分環境有 `resource.custom`；**不可獨信**；權威仍以 GET subscription.`custom_id` |

處理步驟（鎖定）：

1. 讀取上表欄位；缺 `billing_agreement_id` 或 `id` → `pending_resolution`／failed（不丟棄 event）。  
2. **必須** `GET /v1/billing/subscriptions/{billing_agreement_id}`。  
3. 驗證：plan_id whitelist、amount／currency vs plan、env／merchant、本地 subscription 或 `custom_id`→session→user。  
4. 本地找不到 → `pending_resolution`；**禁止**錯綁或丟棄。

`PAYMENT.SALE.REFUNDED`／`REVERSED`：同樣以 sale `id`／`billing_agreement_id` 關聯既有 transaction。

---

## 6. `paid_through` 演算法（鎖定）

成功 `PAYMENT.SALE.COMPLETED` 且驗證通過後：

1. **冪等寫入** `paypal_subscription_transactions`：`UNIQUE(paypal_sale_id)` + `UNIQUE(paypal_event_id)`。  
   若 sale 已處理 → **不**再次延長 `paid_through`。  
2. `GET subscription`。  
3. **優先**：`billing_info.next_billing_time` → 寫入 `paid_through`（僅當新值 ≥ 舊值，單調延長）。  
4. 若 `next_billing_time` 暫時缺失／未更新：  
   - **不**直接失敗整筆 webhook（可 200 + 業務 `reconciliation_pending`）  
   - **不**盲目用固定天數重複延長  
   - 標記 subscription／event `reconciliation_pending`；稍後 GET 重試  
5. **Fallback**（僅當具權威付款證據：sale completed + GET 成功 + plan 已知，且 next_billing 仍空）：  
   `paid_through = payment_time + calendar interval`  
   - monthly：`+ 1 calendar month`  
   - yearly：`+ 1 calendar year`  
   - **禁止**固定 30／365 天  
6. 同一 `sale_id` 重送 webhook → transaction unique → **零二次延長**。

首期權益：**以 SALE.COMPLETED 為準**延長；單獨 `ACTIVATED` 不授予完整週期（與 07C.1 建議一致，本文件鎖定）。

---

## 7. 退款／沖銷政策（鎖定）

| 事件 | 政策 |
|---|---|
| 全額 `REFUNDED` | **立即**停止該付款週期權益（縮短／封鎖至適當 `paid_through` 或 `access_blocked_until`）；標記 **`needs_review`**；寫 audit reason |
| `REVERSED` | **立即**暫停權益；標記 **`needs_review`**；audit reason |
| 部分退款 | **不**自動縮短 `paid_through`；標記 **`needs_review`** |
| 交易列 | **不得刪除**；只追加狀態／audit |

所有縮短／封鎖必須留下：`reason_code`、`actor=system|admin`、關聯 `sale_id`／`event_id`、時間戳。

---

## 8. 對 07C.1 的取代摘要

| 主題 | 07C.1 | 07C.1A |
|---|---|---|
| Plan ID | 暗示對前端保密 | 公開但 server-issued + GET 驗證 |
| 建立流程 | create／confirm 略混 | 鎖定 session + `custom_id` |
| Webhook 早到 | 未完整 | `pending_resolution` + 冪等 resolve |
| 防重複 | partial unique on status | **slot 表**；含 CANCELLED+paid_through；無 `now()` unique |
| SALE 關聯 | 籠統 | `billing_agreement_id` + sale `id` + GET |
| paid_through | next_billing／模糊 fallback | 優先 next_billing；calendar fallback；sale 冪等 |
| 退款 | 待定 | 全額／沖銷立即停權；部分只審核 |

---

## 9. 實作 Gate 仍不得在本階段做

- 改碼、migration、PayPal Product／Plan、Secrets 寫值、部署、付款、commit／push、**07C.2**

---

```text
Auth-07C.1A Result:
Browser Plan ID Model: server-issued allowlisted plan_id (visible in browser; NOT a secret); confirm+webhook GET-validate
Subscription Creation Architecture: JWT create-subscription-session → SDK create({plan_id, custom_id:checkout_session_id}) → JWT confirm-subscription
Pre-approval Binding: APPROVAL_PENDING row + unguessable checkout_session_id + slot OCCUPIED
Webhook Before Confirm: match session via custom_id/subscriptionID; else pending_resolution; never drop verified events; never bind by email
Atomic Duplicate Prevention: user_subscription_slots OCCUPIED/RELEASED via atomic RPC (no now() in UNIQUE)
Cancelled Paid-through Blocking: CANCELLED keeps slot until release_after=paid_through; then release RPC
SALE Subscription Link Field: resource.billing_agreement_id (sale id=resource.id; amount.total/currency; create_time)
Unresolved Event Handling: pending_resolution then idempotent resolve after confirm
Paid-through Algorithm: idempotent sale+event; prefer billing_info.next_billing_time; else reconciliation_pending; calendar fallback only with authoritative sale
Calendar Interval Handling: +1 month / +1 year (no fixed 30/365)
Refund Policy: full REFUNDED → immediate stop period entitlement + needs_review; partial → needs_review only; never delete tx
Reversal Policy: REVERSED → immediate suspend entitlement + needs_review + audit
Code Changed: NO
Migration Created: NO
PayPal Resources Created: NO
Secrets Changed: NO
Deployment Performed: NO
Payment Attempted: NO
Commit/Push Performed: NO
Gate: READY_FOR_IMPLEMENTATION
```
