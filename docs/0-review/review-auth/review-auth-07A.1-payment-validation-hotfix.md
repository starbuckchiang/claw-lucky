# review-auth-07A.1-payment-validation-hotfix

Auth-07A.1：依 Auth-07A preflight 最小修正清單的 **payment validation hotfix**（本機 only）。

```text
Gate: READY_FOR_PREFLIGHT_RECHECK
```

```text
db push: NO
functions deploy: NO
PayPal HTTP: NO
secrets set: NO
git commit/push: NO
entitlements created: NO
subscription-checkout modified: NO
```

即使本 Gate 為 `READY_FOR_PREFLIGHT_RECHECK`，**必須停止，不得部署**。

---

## Preflight

| 檢查 | 結果 |
|---|---|
| `git status --short` | 既有 Auth-07 未提交檔 + docs；未覆蓋無關變更意圖 |
| `supabase migration list` | `20260821000200` **local only**（remote 空白）→ **允許就地修正** pending migration |

---

## 變更摘要

### Migration（pending 就地修正）

[`supabase/migrations/20260821000200_payment_orders_and_webhook_events.sql`](../../supabase/migrations/20260821000200_payment_orders_and_webhook_events.sql)

- `process_paypal_webhook_event`：新增 `p_actual_merchant_id`；COMPLETED 強制 order／capture／amount／currency／actual+expected merchant；**禁止** `IS NOT NULL` 才比對的跳過邏輯
- 驗證失敗：寫入 `payment_webhook_events.processing_status='failed'` + `error_message`；outcome=`rejected`；**不**標 `paid`、**不**寫 `paid_at`
- Capture ID：必填（COMPLETED）；跨單 reuse／unique violation 不得標 paid
- `fail_stale_open_payment_orders(..., 15)`：過期 open → `failed`
- `uq_payment_orders_one_open_per_user_plan`：防止並行雙開
- 所有付款 SECURITY DEFINER RPC：REVOKE PUBLIC/anon/authenticated；GRANT service_role（含 `payment_order_status_rank`、`fail_stale_open_payment_orders`）

### Handlers（JS + TS twins）

- Webhook：order id **僅** `related_ids.order_id`；傳 actual／expected merchant；`rejected` → **HTTP 200**
- Checkout create：15 分鐘 TTL；stale → fail 再新建（新 `create_request_id`）；同 key 重試冪等；open unique 衝突時重抓
- Checkout capture：response order id／amount／currency／merchant／capture id 衝突；不一致 → `failed`，不標 paid

### Tests

- Mock／shape 補齊 07A.1 要求案例
- `.\scripts\verify-local.ps1`：**739 / 739** passing

---

## COMPLETED → paid 強制核對

任一為 null／空／不一致：

- 不得標 `paid`
- 不得寫 `paid_at`
- event 記為 `processing_status=failed`（validation rejected）
- HTTP：**200** + `outcome: "rejected"`

### HTTP 200 理由（避免無限重試）

驗簽已 SUCCESS，但業務驗證失敗（缺 capture id、金額錯、merchant 錯、order 不存在等）屬**不可靠重試可修復**的偽造／錯配事件。若回 4xx/5xx，PayPal 會持續重送。  
選擇 **200 + rejected**：確認已接收並持久化失敗紀錄，同時不更新付款成功狀態。  
暫時性 DB 錯誤仍回 **503**，允許 PayPal 重試。

---

## Create-order TTL（固定 15 分鐘）

| 規則 | 行為 |
|---|---|
| open 且 `created_at` 在 15 分鐘內 | 可重用既有 PayPal Order ID |
| 超過 15 分鐘 | `fail_stale_open_payment_orders` → `failed`，再建新單（新 `create_request_id`） |
| failed/denied | 不重用 |
| 同 `create_request_id` 重試 | 仍回同一列（冪等） |
| 並行雙擊 | partial unique index 一 user+plan 一 open |

---

## 測試覆蓋（本 hotfix）

- completed 缺 capture ID  
- amount null／mismatch  
- currency null／mismatch  
- merchant null／mismatch  
- order mismatch（缺 related_ids）  
- capture ID conflict  
- duplicate completed  
- paid 後 pending 不倒退（repo 回 paid）  
- 14 分鐘可重用／16 分鐘不重用  
- failed 不重用  
- 每個付款 RPC：REVOKE anon+authenticated + GRANT service_role  
- verify 失敗不寫庫；DB 失敗 503  

---

## 未做（停止條件）

- 未 db push／deploy／設 secrets／真實 PayPal  
- 未 commit／push  
- 未建立 entitlements  
- 未改 Auth／gift／gacha／wallet／merge／subscription-checkout  

---

## Gate

```text
READY_FOR_PREFLIGHT_RECHECK
```

下一步：再跑 Auth-07A preflight audit；**通過前不得 Sandbox deploy**。

```text
Auth-07A.1 Result:
Gate: READY_FOR_PREFLIGHT_RECHECK
Migration: 20260821000200 amended in place (not remote)
TTL: 15 minutes
COMPLETED validation: strict (no null-skip); merchant actual vs expected
Rejected webhook HTTP: 200 (documented)
Tests: 739/739
Deployment performed: NO
```
