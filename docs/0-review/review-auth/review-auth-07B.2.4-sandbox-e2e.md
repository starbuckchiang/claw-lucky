# review-auth-07B.2.4-sandbox-e2e

Auth-07B.2.4：PayPal Sandbox Orders v2 monthly USD 5 正式 E2E 驗收（整理既有證據；本文件撰寫期間無新付款）。

前置鏈：

- `review-auth-07B.2.3-merchant-extraction-hotfix.md`
- `review-auth-07B.2.4C-create-order-observability-hotfix.md`（checkout **v5**）
- `review-auth-07B.2.4D` 唯讀確認（`paid`）

```text
Gate: SANDBOX_E2E_PASS
```

```text
Sandbox Buyer Used: YES
Plan Tested: monthly
Amount/Currency: USD 5.00
Payment Final Status: paid
Live PayPal: NO
Webhook Simulator: NO
manual status→paid: NO
Additional Payment Attempted: NO
Code Changed During Review: NO
Deployment During Review: NO
Database Migration: NONE
Commit/Push Performed: NO
Entitlement Activated: NO
```

---

## 1. 測試環境與部署版本

| 項目 | 值 |
|---|---|
| Frontend | `http://localhost:5500/subscription.html` |
| PayPal env | Sandbox（`config.js` `PAYPAL_ENV=sandbox`） |
| Buyer | Personal／Buyer Sandbox Account（**非** Seller） |
| `paypal-checkout` | ACTIVE **v5**，`verify_jwt=true` |
| `paypal-webhook` | ACTIVE **v3**，`verify_jwt=false`（本輪未 redeploy） |
| Observability | 07B.2.4C.1 已部署（OAuth／Create sanitized details） |
| Merchant extraction | 07B.2.3 hotfix 已含於 checkout v5 |

本 Review **未**部署、**未**改 Secrets、**未** `db push`。

---

## 2. 新訂單（遮罩識別）

| 欄位 | 遮罩值 |
|---|---|
| internal id | `06d36e44…` |
| user_id | `5020bf33…` |
| plan_code | `monthly` |
| amount／currency | `5.00`／`USD` |
| status | **`paid`** |
| paypal_order_id | `6GL23600…`（len 17） |
| paypal_capture_id | `70K09229…`（len 17，**非空**） |
| paid_at | present |
| created_at | `2026-09-03 05:43:17Z` |
| updated_at | `2026-09-03 05:43:47Z` |

**未**輸出完整 Order／Capture／Email／token／付款人資料。

---

## 3. Create → Approve → Capture → Webhook → paid

```text
create-order (monthly)
  → PayPal Sandbox Order created (id present)
  → Buyer approve (Personal Sandbox)
  → capture-order
  → internal paypal_capture_id attached
  → status → paid (+ paid_at)
  → signed webhooks arrive & process
```

時間線（sanitize）：

1. **~05:43:17Z** — internal row created；PayPal order 建立成功。  
2. **Buyer approve** — Sandbox Personal 帳號完成核准。  
3. **~05:43:47Z** — Capture 成功；`status=paid`，`paypal_capture_id` 非空。  
4. **~05:43:46Z** — `CHECKOUT.ORDER.APPROVED` webhook：`verification_status=SUCCESS`，`processing_status=processed`。  
5. **~05:43:58Z** — `PAYMENT.CAPTURE.COMPLETED` webhook：`verification_status=SUCCESS`，`processing_status=processed`，has capture。

與 07B.2 失敗路徑對照：本輪 **無** `MERCHANT_MISMATCH`；Capture 路徑將訂單標為 **`paid`**（非 `failed`）。

---

## 4. amount／currency／plan_code

| 檢查 | 結果 |
|---|---|
| `plan_code` | `monthly` |
| `amount` | `5.00` |
| `currency` | `USD` |
| 前端／後端金額來源 | 伺服器 plan whitelist（非 client 信任 amount） |

---

## 5. Merchant MATCH

| 證據 | 結果 |
|---|---|
| Capture 路徑達 `paid`（07B.2.3：missing≠mismatch；實際 mismatch 才 `failed`） | **MATCH**（通過驗證） |
| `PAYMENT.CAPTURE.COMPLETED` webhook `SUCCESS`＋`processed`（webhook 亦驗 merchant） | **MATCH** |
| Live GET Order（本機無 PayPal secret） | 未重做；以 paid＋webhook 為準 |

---

## 6. Capture 唯一性與冪等性

| 檢查 | 結果 |
|---|---|
| 本單 `paypal_capture_id` | **恰好一筆**（非空） |
| 同使用者開放 monthly（created／approved／capture_pending） | **0** |
| 重複 Capture 扣款 | **NO**（未觀察第二次 capture 寫入；handler 已有「已有 capture_id → GET only」） |
| 本 Review 期間再次 Capture／付款 | **NO** |

---

## 7. Webhook 驗簽與處理

| event_type | verification_status | processing_status | has_capture |
|---|---|---|---|
| `CHECKOUT.ORDER.APPROVED` | **SUCCESS** | **processed** | no |
| `PAYMENT.CAPTURE.COMPLETED` | **SUCCESS** | **processed** | yes |

- Webhook Simulator：**未使用**  
- 重複事件導致重複扣款：**未觀察**  
- `error_message`：空（成功路徑）

---

## 8. Historical failed orders 未修改

| id_prefix | paypal_order_prefix | status | updated_at |
|---|---|---|---|
| `1932563b…` | （null） | `failed` | `2026-08-21 10:27:50Z`（未變） |
| `cdce5c79…` | `90T78062…` | `failed` | `2026-08-21 09:34:43Z`（未變） |

**Historical Order Mutated: NO**（含不得重 Capture 的舊單 `90T78062…`）。

---

## 9. 前端刷新

- 付款當下 UI 曾顯示「付款正在確認」（設計為確認中文案，**非**「訂閱已啟用」）。  
- 重新整理後回到 **方案選擇頁**（Plan A／B）。  
- **不否定**付款成功：本階段 **尚未** entitlement／已付款鎖定 UI。

```text
Frontend After Refresh: PLAN_SELECTION
```

---

## 10. Entitlement／錢包

| 檢查 | 結果 |
|---|---|
| `user_plan_entitlements` 等 entitlement 表 | migration **明確不建立**；本輪 **未**啟用 |
| points／tickets／coins 因付款調整 | **NO**（付款路徑不寫錢包；本階段無 activation） |
| capture body 禁止 `entitlement` 欄位 | handler 仍拒絕 client 注入 |

```text
Entitlement Activated: NO
Wallet/Points/Tickets Changed: NO
```

---

## 11. Migration

本輪 **未**執行 `supabase db push`／新 migration。  
沿用既有 `20260821000200_payment_orders_and_webhook_events`。

```text
Database Migration: NONE
```

---

## 12. 下一階段建議

1. **付款 entitlement activation**（paid → 正式權益；與 webhook／capture 冪等對齊）。  
2. **已付款使用者 UI**：方案頁防重複訂閱／顯示已付狀態，避免再按 PayPal。  
3. （可選）刷新後把「付款正在確認」收斂為短暫成功提示（仍不宣稱訂閱已啟用，直到 entitlement 完成）。

---

```text
Auth-07B.2.4 Result:
Sandbox Buyer Used: YES
Plan Tested: monthly
Amount/Currency: USD 5.00
PayPal Order Created: YES
Capture Completed: YES
Merchant Validation: MATCH
Payment Final Status: paid
Webhook Received: YES
Webhook Signature: SUCCESS
Webhook Processing: SUCCESS
Duplicate Capture: NO
Historical Order Mutated: NO
Entitlement Activated: NO
Wallet/Points/Tickets Changed: NO
Frontend After Refresh: PLAN_SELECTION
Additional Payment Attempted: NO
Code Changed During Review: NO
Deployment During Review: NO
Database Migration: NONE
Commit/Push Performed: NO
Gate: SANDBOX_E2E_PASS
```
