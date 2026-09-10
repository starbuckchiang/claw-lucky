# review-auth-07C.7D-sale-delivery-forensic

Auth-07C.7D：SALE Webhook Edge Delivery **唯讀鑑識**。

前置：

- `docs/0-review/review-auth/review-auth-07C.7B-paid-through-diagnostic.md`
- `docs/0-review/review-auth/review-auth-07C.7C-sale-webhook-delivery.md`

```text
Gate: BLOCKED_LOG_ACCESS
Log Access Complete: NO
```

```text
Second Resend Performed: NO
Code Changed: NO
Database Mutated: NO
Payment Attempted: NO
Subscription Cancelled: NO
Deployment Performed: NO
Commit/Push Performed: NO
```

---

## 1. Edge／平台 logs — **無法取得**

Cursor 環境：

| 嘗試 | 結果 |
|---|---|
| `SUPABASE_ACCESS_TOKEN` env |  absent |
| `~/.supabase`／Roaming access-token／credentials JSON | 未找到可用 Management token |
| `supabase functions logs` | CLI 無此 subcommand |
| Supabase MCP `get_logs` | **無**可用 MCP |
| Management API `.../analytics/endpoints/logs(.all)` | **未呼叫成功**（無 token） |

依 gate 規定：**不得猜測**原始投遞／Resend 是否到達 Edge、HTTP status、驗簽結果或 handler stage。

### 請你在 Dashboard 代查（然後把 sanitized 結果貼回）

**專案：** `umtqpstacjdwxcvcirbl`  
**路徑：** Supabase Dashboard → **Logs** → **Edge Functions**（必要時再查 Logs Explorer）

#### Window A — 原始 SALE（約）

- **From：** `2026-09-07T14:34:15Z`
- **To：** `2026-09-07T14:35:30Z`
- Function：**`paypal-webhook`**（期望 version **v7**）

搜尋／過濾關鍵字（任一）：

- `PAYMENT.SALE.COMPLETED`
- event prefix `WH-8HW`（sha8 `f8d3804e`）
- sale prefix `52H380`（sha8 `5e93ec1a`）
- subscription prefix `I-9FMN`（sha8 `bcd16d52`）
- `WEBHOOK_VERIFY_FAILED`／`WEBHOOK_SIGNATURE`
- `MERCHANT_MISMATCH`／`INTERNAL_ERROR`／timeout

#### Window B — 官方 Resend（07C.7C，約）

- **From：** `2026-09-07T14:45:00Z`
- **To：** `2026-09-07T15:15:00Z`
- 同上關鍵字＋任何 `paypal-webhook` POST

#### 請回報的 sanitized 欄位（每個 request 一列）

- timestamp  
- HTTP status（2xx／4xx／5xx）  
- function version  
- event_type（若有）  
- error code（若有）  
- verification result（若有）  
- stage／execution outcome  
- **不要**貼 body、Authorization、完整 headers、完整 ID  

#### Logs Explorer SQL 範例（若 UI 支援）

```sql
-- function_edge_logs / edge request metadata
select timestamp, event_message
from function_edge_logs
where timestamp between '2026-09-07T14:34:15Z' and '2026-09-07T14:35:30Z'
order by timestamp asc
limit 100;

-- internal console
select timestamp, event_message
from function_logs
where timestamp between '2026-09-07T14:34:15Z' and '2026-09-07T14:35:30Z'
order by timestamp asc
limit 100;
```

對 Resend 窗再跑一次（14:45Z–15:15Z）。

有 logs 後可將 Root Cause 精確對到 A–G；**目前不得分類 delivery 根因**。

---

## 2. 公開端點安全檢查（允許、非仿造事件）

| 檢查 | 結果 |
|---|---|
| URL | `https://umtqpstacjdwxcvcirbl.supabase.co/functions/v1/paypal-webhook` |
| HTTPS／DNS | OK（A 記錄可解析） |
| GET | **405**（僅 POST — 預期） |
| OPTIONS | **204** |
| Deployed | `paypal-webhook` **ACTIVE v7**，`verify_jwt` = **false** |
| `config.toml` | `[functions.paypal-webhook] verify_jwt = false` 與部署一致 |

未重送／未 Simulator／未仿造成功 payload。

---

## 3. 靜態程式碼核對（唯讀；**非** delivery 根因定論）

| # | 檢查 | 結果 |
|---|---|---|
| 1 | `PAYMENT.SALE.COMPLETED` ∈ subscription set | **YES**（`SUBSCRIPTION_EVENT_TYPES`） |
| 2 | 驗簽前讀不存在欄位導致 throw | 低風險：先讀 PayPal headers，缺則 **401** `WEBHOOK_SIGNATURE_MISSING`（不入庫） |
| 3 | SALE amount shape | **支援** `amount.total` **與** `amount.value`；currency `currency`／`currency_code` |
| 4 | 缺 `billing_agreement_id`／sale／payee | 缺 merchant → 可能 `MERCHANT_MISMATCH`；有 sub id 時仍嘗試 RPC `failed`；無 sub id 則 **200 rejected 且可能不入庫** |
| 5 | throw 在 insert 前 | 驗簽失敗／JSON 壞掉：不 insert；uncaught → index `500` |
| 6 | catch 無 structured log | index catch 只回 generic `INTERNAL_ERROR`；**少** console 結構化欄位 |
| 7 | verify 用 raw body | **YES**（`req.text()` → `verifyWebhookSignature({ rawBody })`） |
| 8 | Orders merchant 誤用於 SALE | SALE 用 `resource.payee.merchant_id`；Orders 用 capture／purchase_units — **分流正確** |
| 9 | RPC 契約 | Edge 呼叫 `process_paypal_subscription_webhook_event` 參數名與 migration **MATCH** |
| 10 | 非 subscription 提前 ignored | 未知 event → Orders path `ignored`；SALE **不會**走該支（在 subscription set 內） |

**靜態結論：** 程式路徑**允許**處理 SALE；無法解釋「為何 Resend 後仍無列」——缺 Edge request evidence。可疑但未證實假設：SALE 缺 `payee.merchant_id` → early 200 不入庫（屬分類 F 候選，**需 logs 才能成立**）。

Lifecycle（CREATED／ACTIVATED）已入庫且驗簽 SUCCESS → 同 endpoint／v7／簽名管線**對 lifecycle 可用**；SALE 與 lifecycle 的最早分歧點 **必須用 logs 對齊**（到達？401？handler？RPC？）。

---

## 4. 後續修正建議（**不實作**）

### Delivery-specific minimal fix（待 logs）

1. 若 **A**（無 request）：查 PayPal delivery HTTP、TLS、URL、WAF；對照 CREATED 成功投遞差異。  
2. 若 **B**（401／403 gateway）：確認 `verify_jwt` 仍 false（目前為 false）。  
3. 若 **C**（驗簽失敗）：比對 SALE vs lifecycle 的 transmission headers／raw body 完整性。  
4. 若 **F**（200 但無列）且缺 merchant：補 SALE payee／merchant 解析或改以 GET subscription＋allowlist 驗證後再 persist failed／processed 列。  
5. 加強 structured log：`event_type`、`verification_status`、`outcome`、`error_code`（無 PII）。

### GET transactions reconciliation fallback（設計約束）

- 僅 **server／service_role**  
- `GET` subscription＋transactions；驗證 plan／merchant／amount／currency／status  
- `sale_id` 唯一；**不**偽造 webhook signature  
- 獨立 reconciliation RPC／audit source  
- 之後真實 SALE webhook 到達不得重複延長 `paid_through`  
- **禁止**手動 SQL 設 `paid_through`

---

## Auth-07C.7D Result

```text
Auth-07C.7D Result:
Original Request Reached Edge: UNKNOWN (no logs)
Resend Request Reached Edge: UNKNOWN (no logs)
Function Version: v7 (deployed; request association UNKNOWN)
Gateway HTTP Status: UNKNOWN (no logs)
Verify JWT: false (config + deployed)
Signature Verification: UNKNOWN (no logs)
Failure Stage: UNKNOWN (blocked on log access)
Structured Error: UNKNOWN
Lifecycle Events Comparison: CREATED/ACTIVATED persisted SUCCESS earlier; SALE divergence needs logs
SALE Route Present: YES (static)
SALE Payload Shape Supported: YES (total|value static)
RPC Contract Match: YES (static)
Earliest Divergence: UNKNOWN (needs Edge logs)
Root Cause: BLOCKED_LOG_ACCESS
Log Access Complete: NO
Second Resend Performed: NO
Code Changed: NO
Database Mutated: NO
Payment Attempted: NO
Subscription Cancelled: NO
Deployment Performed: NO
Commit/Push Performed: NO
Recommended Delivery Fix: obtain Edge logs then apply A–G-specific minimal fix (see §4)
Recommended Reconciliation Fix: service_role GET transactions + sale_id-unique reconciliation RPC (no fake signature / no manual SQL)
Gate: BLOCKED_LOG_ACCESS
```
