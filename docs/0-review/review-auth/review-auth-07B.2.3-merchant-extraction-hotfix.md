# review-auth-07B.2.3-merchant-extraction-hotfix

Auth-07B.2.3：Capture merchant extraction hotfix（mock only；未部署）。

```text
Gate: PASS
```

```text
Root Cause: MERCHANT_EXTRACTION_BUG
Merchant Secret Changed: NO
Fallback GET Order: PASS
Missing Merchant Handling: PASS
Actual Mismatch Detection: PASS
Idempotency: PASS
Tests Passed: verify-local 756/756; paypal-checkout-webhook.test.js 36/36
Tests Failed: 0
Database Migration: NONE
Functions Requiring Deployment: paypal-checkout
Historical Order Mutated: NO
Production Deployment Performed: NO
Commit/Push Performed: NO
```

---

## 1. 根因確認

依 `review-auth-07B.2.2-merchant-mismatch-forensic.md`：

- Sandbox App／Order payee／Webhook payee／Business Merchant 一致。
- `PAYPAL_MERCHANT_ID` **不需**修改。
- Capture API 精簡 representation 可能缺少 `purchase_units[].payee`。
- 舊邏輯把「merchant 欄位缺失」誤判為 `MERCHANT_MISMATCH` 並標 `failed`。

---

## 2. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `supabase/functions/_shared/lib/paypal-client.js` | `Prefer: return=representation`；`getOrder`；`normalizeMerchantId`；`extractCaptureValidationFields` |
| `supabase/functions/_shared/lib/paypal-client.ts` | 同上（Deno twin） |
| `supabase/functions/_shared/paypal-checkout-handler.js` | Capture 驗證流程：missing≠mismatch；GET fallback；`capture_pending` 可重試 |
| `supabase/functions/_shared/paypal-checkout-handler.ts` | 同上 |
| `supabase/functions/_shared/__tests__/paypal-checkout-webhook.test.js` | 07B.2.3 mock 案例 |
| `docs/0-review/review-auth/review-auth-07B.2.3-merchant-extraction-hotfix.md` | 本文件 |

未改：secrets、webhook handler（除共用 helper 匯出）、Auth／gift／gacha／wallet／merge、migration。

---

## 3. `Prefer: return=representation` 加入位置

| API | Header |
|---|---|
| `POST /v2/checkout/orders`（createOrder） | `Prefer: return=representation` |
| `POST /v2/checkout/orders/{id}/capture` | `Prefer: return=representation` |
| `GET /v2/checkout/orders/{id}` | `Prefer: return=representation` |

保留：`Authorization`、`Content-Type`、`PayPal-Request-Id`（create／capture）。

---

## 4. Capture ↔ GET Order 判定流程

```text
if order already has paypal_capture_id:
  GET Order only (no second Capture)
else:
  Capture with Prefer representation
  extract validation fields
  if any required field missing:
    GET Order
    if GET fails (network/5xx):
      keep/transition capture_pending
      return 503 PAYPAL_ORDER_LOOKUP_FAILED
      (wait signed webhook → paid)
    else use GET resource as authoritative

validate order id / amount / currency / merchant / capture status
```

必要驗證欄位：payee merchant、capture id、capture status、amount、currency。

---

## 5. missing vs mismatch

| 情況 | 行為 |
|---|---|
| merchant **缺失**（含 GET 後仍缺） | **不是** `MERCHANT_MISMATCH`；`capture_pending` + `PAYPAL_ORDER_LOOKUP_FAILED`（details.reason=`MERCHANT_ID_MISSING_FROM_CAPTURE_RESPONSE`） |
| merchant **存在且 normalize 後不一致** | `MERCHANT_MISMATCH` → 可標 `failed` |

Normalization（雙方）：

```ts
value.trim().toUpperCase()
```

---

## 6. payment 狀態轉換

| 情境 | 結果 status |
|---|---|
| 完整 representation／GET 成功且 COMPLETED | `paid` |
| Capture 成功但 GET 暫時失敗 | `capture_pending`（**不** `failed`） |
| 真實 merchant／amount／currency 不一致 | `failed` |
| PayPal DECLINED／DENIED | `denied` |
| 已有 `paypal_capture_id` 重試 | 只 GET，不二次 Capture |

---

## 7. 冪等性

- 已有 `paypal_capture_id`：resume 只呼叫 `getOrder`，**不**再 `captureOrder`。
- Capture 仍使用既有 `capture_request_id` → `PayPal-Request-Id`。
- Fallback GET **不**建立新 PayPal Order／payment order。
- 已 `paid`：直接回成功訊息，不重 Capture。

---

## 8. 測試

```text
node --test supabase/functions/_shared/__tests__/paypal-checkout-webhook.test.js
→ 36/36 pass

powershell -File scripts/verify-local.ps1
→ 756/756 pass, 0 fail
```

涵蓋 Prompt 要求：完整 representation、sparse+GET 成功、GET 暫失敗→pending、真實 mismatch、normalize、amount／currency mismatch、webhook pending→paid、retry 不二次 Capture。

---

## 9–10. 未部署／未 commit；舊訂單未改

- `supabase db push`：**NO**
- `supabase functions deploy`：**NO**
- `git commit`／`git push`：**NO**
- 訂單 `90T780620H780851Y`：**未**重抓、**未**重新 Capture、**未**手動改 paid、**未**回放 Webhook。

```text
Historical false-negative order retained for audit; no mutation performed.
```

---

## 11. 下一階段

僅需部署受影響 Function：

```text
paypal-checkout
```

（`paypal-client`／checkout-handler 為其共用模組；`paypal-webhook` 未改行為，除非後續要一併帶共用 helper 版本一致性，本 Gate 不要求部署 webhook。）
