# review-auth-07A-sandbox-deploy-preflight

Auth-07A：Sandbox deployment **preflight audit only**（唯讀）。

```text
Gate: HOTFIX_REQUIRED
```

```text
Code modified: NO
Migration modified: NO
Config modified: NO
db push: NO
functions deploy: NO
PayPal HTTP: NO
secrets set: NO
git commit/push: NO
```

本文件依實際程式／migration 審查，非重述 Auth-07 review。發現缺陷後**只列最小修正清單並停止**；未自行修正或部署。

審查對象（本機現況）：

- [`supabase/migrations/20260821000200_payment_orders_and_webhook_events.sql`](../../supabase/migrations/20260821000200_payment_orders_and_webhook_events.sql)
- [`supabase/functions/_shared/paypal-webhook-handler.js`](../../supabase/functions/_shared/paypal-webhook-handler.js)（及 `.ts` twin）
- [`supabase/functions/_shared/paypal-checkout-handler.js`](../../supabase/functions/_shared/paypal-checkout-handler.js)（及 `.ts` twin）
- [`supabase/functions/paypal-webhook/index.ts`](../../supabase/functions/paypal-webhook/index.ts)
- [`supabase/functions/_shared/__tests__/paypal-checkout-webhook.test.js`](../../supabase/functions/_shared/__tests__/paypal-checkout-webhook.test.js)
- [`supabase/migrations/__tests__/payment-orders-webhook-shape.test.js`](../../supabase/migrations/__tests__/payment-orders-webhook-shape.test.js)

---

## Checklist 結果

### 1. COMPLETED 前核對 paypal_order_id / capture_id / amount / currency / merchant

| 項目 | Handler | RPC `process_paypal_webhook_event` | 判定 |
|---|---|---|---|
| `paypal_order_id` | COMPLETED 要求非空；自 `related_ids.order_id` 取出 | 空則 `MISSING_PAYPAL_ORDER_ID`；以之查找內部單 | **PASS（部分）** |
| `paypal_capture_id` | COMPLETED **未**強制要求 `fields.paypalCaptureId` | 可為 NULL 仍可標 `paid`；僅在非空時做 reuse 檢查 | **FAIL** |
| amount | COMPLETED 要求非空 | `p_expected_amount IS NOT NULL` 才比對 → NULL 時**跳過** | **FAIL（RPC）** |
| currency | COMPLETED 要求非空 | `p_expected_currency IS NOT NULL` 才比對 → NULL 時**跳過** | **FAIL（RPC）** |
| `PAYPAL_MERCHANT_ID` | CAPTURE.* 比對 event payee vs env | 只檢查 `p_expected_merchant_id` **非空**，RPC **不**再比對 payload payee | **PARTIAL**（依賴 handler；RPC 防禦不足） |

**缺陷：** 標 `paid` 前，RPC／handler 未同時強制五項皆成立且不符即拒絕。尤其 **capture_id 可缺漏仍 paid**；RPC 在 amount／currency 為 NULL 時放行。

---

### 2. Webhook Order ID 來源與內部對應

- Capture 事件：`extractCaptureMoney` / `extractResourceFields` 使用  
  `resource.supplementary_data.related_ids.order_id`（見 `paypal-client.js` / webhook handler）。
- 內部對應：`WHERE paypal_order_id = p_paypal_order_id`；找不到 → `ORDER_NOT_FOUND`。
- RPC／handler **不**接受 webhook 自訂 `user_id` 或 internal order UUID 作為付款權威。

**判定：PASS**

---

### 3. 驗簽 SUCCESS 前不寫入

- `paypal-webhook/index.ts`：先 `req.text()`，再進 handler。
- Handler：缺 headers／verify 失敗 → **401**，且 **不**呼叫 `webhookRepository.processWebhookEvent`。
- RPC：`p_verification_status IS DISTINCT FROM 'SUCCESS'` → 直接 exception（防禦）。

**判定：PASS**

---

### 4. RPC 權限（實際 GRANT／REVOKE）

| Function | REVOKE PUBLIC | REVOKE anon | REVOKE authenticated | GRANT service_role |
|---|---|---|---|---|
| `payment_order_status_rank(TEXT)` | YES | （僅 PUBLIC） | （僅 PUBLIC） | YES |
| `create_payment_order(...)` | YES | YES | YES | YES |
| `attach_paypal_order_id(...)` | YES | YES | YES | YES |
| `transition_payment_order_status(...)` | YES | YES | YES | YES |
| `process_paypal_webhook_event(...)` | YES | YES | YES | YES |

能建立／綁定／轉換付款狀態的 SECURITY DEFINER RPC：對 anon／authenticated 皆 REVOKE，僅 `service_role` EXECUTE。

**判定：PASS**（`payment_order_status_rank` 為純查詢 helper，亦僅 grant service_role；建議 hotfix 時對齊補 REVOKE anon/authenticated 以一致，非 blocker）

---

### 5. 狀態亂序／重複 event

- `transition_payment_order_status`：rank 倒退拒絕；`paid` 僅可 → `refunded`/`reversed`；`refunded`/`reversed` 終態；`denied`/`failed` 不可再進 paid。
- Webhook 遇 `STATUS_REGRESSION_FORBIDDEN`：吞掉回歸、仍寫 event、**不**改壞訂單狀態。
- Duplicate `paypal_event_id`：outcome `duplicate`，不更新訂單（handler 回 2xx）。

**判定：PASS**（行為符合；見測試缺口第 8 點）

---

### 6. Create Order 重用條件

實際條件（`findOpenOrderByUserPlan`）：

```text
user_id + plan_code
AND status IN ('created','approved','capture_pending')
ORDER BY created_at DESC LIMIT 1
```

- **有**排除 `failed` / `denied` / `paid` / `refunded` / `reversed`。
- **無**最大存活時間／過期 PayPal Order 檢查。
- 極舊的 `created` 單可被無限重用並回傳既有 `paypal_order_id`。

**判定：FAIL**（不符合「不得無限重用過期／太久的 PayPal Order」）

---

### 7. Capture 確認

| 要求 | 現況 | 判定 |
|---|---|---|
| Auth UID 為 owner | `internal.user_id !== user.id` → 403 | PASS |
| 尚未 paid/refunded/reversed | paid 早退；denied/failed/refunded/reversed → 409 | PASS |
| amount / currency | 與內部訂單比對 | PASS |
| merchant | vs `PAYPAL_MERCHANT_ID` | PASS |
| capture id／order 一致 | 以 path orderId capture；**未**顯式 assert response 內 order id；capture id conflict 僅 webhook RPC 有 | PARTIAL |

**判定：PARTIAL**（核心 owner／金額／merchant OK；response order／capture 衝突防禦偏薄）

---

### 8. Mock 測試覆蓋（對照要求）

| 要求案例 | 現有測試？ |
|---|---|
| webhook amount mismatch | **NO** |
| currency mismatch | **NO** |
| merchant mismatch（webhook） | **NO**（僅 capture-order merchant mismatch） |
| order mismatch | **NO** |
| capture ID conflict | **NO** |
| duplicate event | YES |
| out-of-order event | **NO** |
| authenticated 直接呼叫付款 RPC 被拒絕 | **NO**（僅 SQL 靜態 shape 有 REVOKE 字串；無行為／政策測試敘述完整覆蓋此條） |
| stale order 不重用 | **NO** |

**判定：FAIL**（覆蓋不足，不可視為可部署前測試完備）

---

## 最小修正清單（Hotfix — 本 Gate 不實作）

1. **COMPLETED → paid 強制五項**（handler + RPC）  
   - 要求非空：`paypal_order_id`、`paypal_capture_id`、amount、currency、merchant  
   - 任一不符（含 NULL）→ 不得標 `paid`、不得寫成功付款狀態  
   - RPC：amount／currency 改為「必填且必須相等」，禁止 `IS NOT NULL` 才檢查的跳過邏輯  

2. **Create-order 重用加有效條件**  
   - 例如：僅重用 `created_at` 在 N 分鐘內、且 status ∈ open 集合的訂單  
   - 過期則新建（新 `create_request_id`），不得回傳過期 PayPal Order ID  

3. **補 mock 測試**（至少）：  
   - webhook amount／currency／merchant／order mismatch  
   - capture ID conflict  
   - out-of-order（paid 後 PENDING／APPROVED 不覆蓋）  
   - stale open order 不重用  
   - migration／policy：authenticated 不可 EXECUTE 付款 RPC（靜態断言可加強至逐函式 REVOKE 清單，與本 review 對齊）  

4. （建議）Capture response 顯式核對 `orderId`／既有 `paypal_capture_id` 衝突，與 webhook 對稱。

完成以上後另開 Gate 再評 `SAFE_FOR_PAYPAL_SANDBOX_DEPLOY`。

---

## Gate 結論

```text
HOTFIX_REQUIRED
```

不得解讀為可 Sandbox deploy。  
未達 `SAFE_FOR_PAYPAL_SANDBOX_DEPLOY`；非整線崩潰，故非 `FAIL`。

```text
Auth-07A Result:
Gate: HOTFIX_REQUIRED
Completed checks before paid: FAIL (capture_id / RPC null-skip)
Order id from related_ids: PASS
No write before verify: PASS
RPC grants: PASS
Status ordering / duplicate: PASS
Create-order reuse TTL: FAIL
Capture owner/amount/merchant: PARTIAL/PASS core
Required mock coverage: FAIL
Minimal fix list: see above
Deployment performed: NO
```
