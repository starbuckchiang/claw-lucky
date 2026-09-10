# review-auth-07B.2.2-merchant-mismatch-forensic

Auth-07B.2.2：MERCHANT_MISMATCH forensic audit（唯讀）。

```text
Root cause: MERCHANT_EXTRACTION_BUG
```

```text
re-capture: NO
new order: NO
order mutated: NO
code edited: NO
deploy: NO
git add/commit/push: NO
raw secrets / full merchant IDs printed: NO
```

Subject order：`paypal_order_id=90T780620H780851Y`，internal `status=failed`（來自 Auth-07B.2）。

---

## 1. Merchant extraction paths（code audit）

### Capture（`paypal-checkout-handler` + `paypal-client`）

| Priority | JSON path | Role |
|---|---|---|
| 1 | `captureResult.purchase_units[].payee.merchant_id` | `extractOrderPayeeMerchantId()` |
| 2 | `captureResult.purchase_units[].payments.captures[].payee.merchant_id` | fallback |

- Expected secret：`String(deps.paypalMerchantId || "").trim()` only。
- Compare：`String(payeeMerchant) !== merchantId`。
- **未**使用 `payer.payer_id` / buyer account id。

### Webhook（`paypal-webhook-handler` + `extractCaptureMoney`）

| Event | JSON path |
|---|---|
| `PAYMENT.CAPTURE.*` | `event.resource.payee.merchant_id` |
| `CHECKOUT.ORDER.APPROVED` | `event.resource.purchase_units[].payee.merchant_id` |

Live GET order（同一 Sandbox app credentials，唯讀）：

- `purchase_units[].payee.merchant_id`：**present**
- `purchase_units[].payments.captures[].payee.merchant_id`：**absent**
- `payer.payer_id`：present on order，**但未**用於 merchant 比對

---

## 2. Fingerprints（presence / length / sha256_8 / whitespace）

定義：

- **A** = Capture／Order 賣家 `payee.merchant_id`（handler 有效路徑；本審計以 GET order 重構，因未保存原始 capture HTTP body）
- **B** = Webhook `PAYMENT.CAPTURE.COMPLETED` → `resource.payee.merchant_id`
- **C** = Function runtime `PAYPAL_MERCHANT_ID`
- **D** = 此 Client ID 所屬 Sandbox Business Account Merchant／Account ID（local notes，僅指紋）

| ID | exists | length | sha256_8 | leading/trailing WS |
|---|---|---|---|---|
| A | YES | 13 | `ebbb48d7` | NO |
| B | YES | 13 | `ebbb48d7` | NO |
| C（raw） | **UNAVAILABLE via CLI** | — | — | — |
| D | YES | 13 | `ebbb48d7` | NO |

### C 讀取限制

`supabase secrets list -o json` 的 `value` 為 **64-char digest／opaque**，不是可還原的 raw secret（`PAYPAL_CLIENT_ID` 同樣 len=64，與前端 80-char Client ID 不同形）。  
因此 **不能**對 raw `C` 做與 A/B/D 同算法的可比指紋。

Metadata：`PAYPAL_MERCHANT_ID.updated_at = 2026-08-21T09:52:18Z`（**晚於** E2E capture／webhook ~09:34Z）→ 目前 secret **可能已變更**，不可當作失敗當下的 C。

### C_then 推論（失敗當下）

DB：`PAYMENT.CAPTURE.COMPLETED` 的 `verification_status=SUCCESS` 且 `processing_status=processed`（無 error）。  
RPC 在 COMPLETED 時若 `actual merchant ≠ expected merchant` 會寫 `processing_status=failed`。  
故 **C_then == B**。又 B 指紋 == A == D → **C_then == A == D**。

---

## 3. Comparisons（MATCH / NOT_MATCH only）

| Compare | Result |
|---|---|
| A == B | **MATCH** |
| A == C（raw current） | **NOT_COMPARABLE**（CLI 無 raw） |
| A == C_then（inferred） | **MATCH** |
| A == D | **MATCH** |
| C（raw current） == D | **NOT_COMPARABLE** |
| C_then == D | **MATCH**（inferred） |

---

## 4. Client ID：config.js vs Supabase Secret app

| Check | Result |
|---|---|
| `config.js` PAYPAL_CLIENT_ID vs 建立此 Order 的 Sandbox app credentials | **MATCH**（fingerprint `0c3626cd`，len 80） |
| 同 credentials 可 GET 該 `paypal_order_id` | **PASS** → Edge create-order 與前端 SDK 為同一 Sandbox App |

（CLI secret list 的 Client ID `value` 為 digest，無法直接與 80-char Client ID 做 raw 比對；以「可讀取該 merchant order」證明同 app。）

---

## 5. Normalization

要求：`String(value).trim().toUpperCase()`  

實際 capture 比對：

- expected：`.trim()` only  
- actual：無 `.trim()`  
- 兩側皆 **無** `.toUpperCase()`  

```text
normalization defect: YES (trim-only on expected; no toUpperCase on either side)
```

本案 A/B/D 皆無空白、且大小寫一致（`case_only` = false），**不足以單獨解釋**此次失敗。

---

## 6. Root cause

```text
MERCHANT_EXTRACTION_BUG
```

### 理由

1. Extraction **欄位選擇正確**（賣家 `payee.merchant_id`，不是 payer id）→ 排除「讀錯 buyer 欄位」類 bug 作為唯一根因敘事，但 **路徑覆蓋不足**。
2. A == B == D，且 webhook 在失敗當下以 C_then 驗過 merchant → **不是**「secret 指到別的 Business／App」（那會讓 webhook 也 `failed`）。
3. Capture Edge 仍回 `MERCHANT_MISMATCH`，唯一一致解釋：`capture-order` 當下從 **Capture HTTP response** 抽出的 `payeeMerchant` 為 **空或不一致**，而 handler 在 `!payeeMerchant` 時同樣走 mismatch。
4. 現況 GET order：`purchase_units[].payee` 有值，但 **`captures[].payee` 仍無**。若 Capture API 回應當時缺少 `purchase_units[].payee`，兩個 handler 路徑都會落到 null → 與現象吻合。
5. Webhook 從 **capture resource** 的 `resource.payee.merchant_id` 取值成功（B present）→ 同一次付款在 webhook 形狀可讀、在 capture-order 形狀／路徑上失敗 → **extraction／response-shape gap**。

### 排除

| Candidate | Why not |
|---|---|
| `MERCHANT_SECRET_WHITESPACE` | B/D/A 無 WS；webhook `btrim` 當下通過 |
| `CLIENT_ID_APP_MISMATCH` | Client ID／app 一致；C_then 與 B/D 一致 |
| `CAPTURE_WEBHOOK_MISMATCH` | A 指紋 == B 指紋 |

`UNKNOWN` 僅保留為：未持久化原始 capture response body，無法 100% 重放當時 JSON；但行為證據足以判定 extraction gap。

---

## 7. Gate stop

本 Gate **只診斷**。未重 Capture、未建新單、未改舊單、未改碼、未部署、未 commit／push。
