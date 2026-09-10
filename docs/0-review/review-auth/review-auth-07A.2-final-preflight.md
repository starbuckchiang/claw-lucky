# review-auth-07A.2-final-preflight

Auth-07A.2：Sandbox deployment **final preflight recheck**（唯讀）。

```text
Gate: HOTFIX_REQUIRED
```

```text
Code/migration/config modified this Gate: NO
db push: NO
functions deploy: NO
secrets set: NO
PayPal HTTP: NO
git add/commit/push: NO
```

即使日後達 `SAFE_FOR_PAYPAL_SANDBOX_DEPLOY`，本 Gate 亦要求**停止、不得部署或設定 secrets**。

審查對象：`20260821000200` migration、`paypal-checkout-handler`／`paypal-webhook-handler`（JS+TS）、相關 tests、`supabase/config.toml`、`verify-local`、git 範圍。

`.\scripts\verify-local.ps1`：**739 / 739 passing**（執行通過，但下方仍有覆蓋／行為缺口 → 不得 SAFE）。

---

## Checklist

### 1. COMPLETED 標 paid 前六項必填且相符

Migration `process_paypal_webhook_event`（COMPLETED 分支）：

- `paypal_order_id`、`paypal_capture_id`、amount、currency、`p_actual_merchant_id`、`p_expected_merchant_id` 缺一 → `rejected`／`failed` event，不標 paid
- amount／currency 與內部訂單比對（**無** `IS NOT NULL` 才檢查的跳過）
- actual vs expected merchant 字串比對

Handler 傳入 actual／expected merchant；order id 來自 `related_ids.order_id`。

**判定：PASS**

---

### 2. Capture ID 衝突與冪等

- 跨單 `CAPTURE_ID_REUSED` → rejected，不標 paid
- unique violation → 不吞成 paid
- 同 `paypal_event_id` → `duplicate`，不重跑業務
- 同單同 capture 再 transition 同 status → 冪等

**判定：PASS**（程式／RPC）

---

### 3. 狀態測試必須實際存在並通過

| 要求案例 | 實際測試？ | 判定 |
|---|---|---|
| paid 後 PENDING 不倒退 | 僅有 handler stub 回 `order_status: paid`（**未**行使 `transition_payment_order_status`／RPC 回歸邏輯） | **WEAK / FAIL 要求** |
| paid 後 APPROVED 不倒退 | **無** `CHECKOUT.ORDER.APPROVED` 案例 | **FAIL** |
| refunded 後 COMPLETED 不回 paid | **無** | **FAIL** |
| reversed 後 COMPLETED 不回 paid | **無** | **FAIL** |
| failed 不重用 | 有（seed `failed`） | PASS |
| denied 不重用 | 測試名含 denied，但 **只 seed failed** | **FAIL** |

RPC 層 `transition_payment_order_status` 的終態／禁止倒退邏輯存在，但 07A.2 要求「測試必須實際存在並通過」→ **未滿足**。

**判定：FAIL**

---

### 4. 15 分鐘 TTL 與 partial unique index

| 要求 | 現況 | 判定 |
|---|---|---|
| 同 user+plan 最多一筆 open | `uq_payment_orders_one_open_per_user_plan` | PASS |
| stale fail 限 `p_user_id`+`p_plan_code` | `fail_stale_open_payment_orders` WHERE 含 user_id | PASS（不會標他戶 failed） |
| 他戶隔離測試 | **無**明確測試 | WEAK |
| unique violation 必須重查 open、不得直接 500 | **僅**第二段 `createPaymentOrder`（`:n:` 重試）有 try/catch 重查；**第一段** `createPaymentOrder` 撞 one-open unique 時落入外層 catch → **`DB_ERROR` 503**，未重查 | **FAIL** |
| 並行衝突測試 | **無**模擬 unique → 重查成功路徑 | **FAIL** |
| 14／16 分鐘 TTL | 有且通過 | PASS |

**判定：FAIL**（第一段 create 的 unique 處理不合規）

---

### 5. 驗簽／拒絕／503

- 驗簽前不呼叫 repo：有測試 PASS
- rejected → HTTP 200：有 PASS
- DB 暫時失敗 → 503：有 PASS

**判定：PASS**

---

### 6. 付款 SECURITY DEFINER RPC

全部相關 RPC（含 `fail_stale_open_payment_orders`、`process_paypal_webhook_event`、`payment_order_status_rank`）：

- `SET search_path = public, pg_temp`
- REVOKE PUBLIC / anon / authenticated
- GRANT EXECUTE → service_role only

Shape tests 逐函式覆蓋且通過。

**判定：PASS**

---

### 7. payment_orders RLS

- authenticated SELECT owner：`user_id = request_user_key()`
- authenticated RESTRICTIVE deny ALL writes
- anon RESTRICTIVE deny ALL
- webhook 表 authenticated／anon 全拒

**判定：PASS**

---

### 8. config.toml verify_jwt

```toml
[functions.paypal-webhook]
verify_jwt = false
```

未設定 `[functions.paypal-checkout]` → 維持預設 `verify_jwt = true`。

**判定：PASS**

---

### 9. git diff 範圍（禁止模組）

對下列路徑 `git diff --name-only HEAD`：**無輸出**（未改）：

- `supabase/functions/subscription-checkout`
- `js/services/auth`
- `js/gift.js` / `js/pages/gacha.js`
- `supabase/functions/account-merge` / `wallet-ops`
- `wallet-ops-handler` / `account-merge-handler` / `subscription-checkout-handler`

Auth-07／07A.1 變更集中在 paypal／subscription 付款接線／migration／review／config。

**判定：PASS**

---

### 10. verify-local

**739 / 739 pass**（本 Gate 執行）。

**判定：PASS**（綠燈，但不覆蓋第 3／4 項缺口）

---

## 最小 Hotfix 清單（本 Gate 不實作）

1. **Create-order**：任何 `createPaymentOrder`（含第一次）遇到 one-open unique violation → 重查同 user+plan 合法 fresh open 並回傳；僅在仍無合法 open 時才失敗。補並行雙擊 mock 測試。  
2. **補測試並通過**：  
   - paid 後 `CHECKOUT.ORDER.APPROVED` 不倒退（最好直接測 transition／RPC 行為或 in-memory transition 與 SQL 規則對齊）  
   - `refunded`／`reversed` 後 `PAYMENT.CAPTURE.COMPLETED` 不回 `paid`  
   - `denied` 訂單不重用（與 failed 分開断言）  
   - （建議）`fail_stale` 不影響其他 `user_id`  

完成後再跑 07A.2／07A preflight；通過前不得 Sandbox deploy。

---

## Gate 結論

```text
HOTFIX_REQUIRED
```

不得解讀為 `SAFE_FOR_PAYPAL_SANDBOX_DEPLOY`。

```text
Auth-07A.2 Result:
Gate: HOTFIX_REQUIRED
COMPLETED six-field validation: PASS
Capture conflict / duplicate idempotency: PASS
Required state tests: FAIL (APPROVED / refunded / reversed / denied gaps)
TTL + one-open unique race handling: FAIL (first insert unique → 503)
Webhook verify / rejected 200 / DB 503: PASS
RPC grants + search_path: PASS
payment_orders RLS: PASS
config.toml webhook-only verify_jwt=false: PASS
Forbidden module diffs: PASS
verify-local: 739/739 PASS
Deployment / secrets: NO
```
