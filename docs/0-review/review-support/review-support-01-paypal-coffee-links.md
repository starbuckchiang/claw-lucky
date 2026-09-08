# review-support-01-paypal-coffee-links

Support-01：`support.html` 新增 PayPal「請我們喝杯咖啡」單次支持連結，並部署前端至 GitHub Pages。

```text
Payment Link UI Tests: PASS
PayPal Checkout Page Verification: PASS
Real Payment Completion: FAIL
Failure Layer: PAYPAL_HOSTED_CHECKOUT
Root Cause: SUSPECTED_MERCHANT_ACCOUNT_OR_RECEIVING_LIMITATION
Website Defect: NO
Real Payment E2E: BLOCKED_PAYPAL_ACCOUNT_REVIEW
Deployment Approved By User: YES
Deployment Decision: FRONTEND_RELEASE_WITH_KNOWN_PAYPAL_ACCOUNT_BLOCKER
Gate: DEPLOYED_WITH_PAYPAL_ACCOUNT_BLOCKER
```

```text
Supabase Migration: NONE
Supabase Function Deployment: NONE
Secrets Changed: NO
```

---

## 1. 任務目標

在既有 `support.html` 提供三個 PayPal 託管單次付款選項（USD 3 / 5 / 10），明確揭露為單次支持、非訂閱、不含月訂／年訂權益。僅安全導向 PayPal，不串接訂閱／checkout capture／webhook／權益寫入。

## 2. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `support.html` | 重構區塊文案、三張支持卡、三個 PayPal `ncp/payment` 按鈕與安全屬性；移除底部 QR |
| `css/pages/support.css` | disclosure、PayPal 按鈕 hover／focus-visible／active、觸控高度 |
| `js/__tests__/support-paypal-coffee-links.test.js` | 靜態 HTML／CSS shape 測試（6） |
| `docs/0-review/review-support/review-support-01-paypal-coffee-links.md` | 本 review |

未修改：`subscription.html`、PayPal subscription／webhook／Edge Functions、migrations、wallet／gift／gacha。

工作樹中其他未提交變更（Auth-07C 等）已避開，未還原或覆蓋，亦未納入 commit。

## 3. UI 與 RWD

- 沿用既有 support 咖啡棕／米金視覺與 `panel`／`btn-support` 風格。
- Desktop（≥768px）：三欄 grid。
- Mobile（390×844）：單欄堆疊，無橫向溢出；PayPal 按鈕 `min-height: 48px`。
- 無 inline JS、無 PayPal SDK。
- 未使用官方 Logo 圖冒充按鈕；按鈕文字含 `PayPal`。
- 底部 QR code 區塊已移除。

## 4. 付款連結（遮罩）

| 選項 | 預期金額 | 網域 | 代碼遮罩 |
|---|---:|---|---|
| 小杯咖啡 | USD 3.00 | `www.paypal.com` | `JQ25…` |
| 暖暖咖啡 | USD 5.00 | `www.paypal.com` | `BHAZ…` |
| 大杯咖啡 | USD 10.00 | `www.paypal.com` | `FDKV…` |

路徑型態：`/ncp/payment/{CODE}`（正式連結，非 sandbox）。未寫入任何 PayPal Secret／Merchant ID／token。

## 5. 安全屬性驗證

- 三個按鈕皆 `target="_blank"` → **PASS**
- 三個按鈕皆 `rel="noopener noreferrer"` → **PASS**
- 無空白／placeholder／`javascript:` href → **PASS**
- 無 inline script／PayPal SDK → **PASS**
- accessible name 可區分 USD 3／5／10 → **PASS**

## 6. 自動測試

```bash
node --test js/__tests__/support-paypal-coffee-links.test.js
# 6/6 PASS

powershell -File scripts/verify-local.ps1
# tests 854 / pass 854 / fail 0
```

```text
Payment Link UI Tests: PASS
```

## 7. Desktop／Mobile E2E

| 項目 | 結果 |
|---|---|
| Desktop 1280×900 載入、三卡、disclosure | PASS |
| 無 JS page error（業務相關） | PASS |
| Tab／focus 三個 PayPal 按鈕 | PASS |
| 點擊 USD 3 開新分頁，原頁不被替換 | PASS |
| Mobile 390×844 單欄、無橫向溢出 | PASS |
| 按鈕不重疊 | PASS |

## 8. PayPal checkout 名稱／金額／幣別核對（未完成付款）

| 選項 | HTTP | 頁面名稱 | 金額 | 幣別 |
|---|---:|---|---:|---|
| 小杯咖啡 | 200 | 小杯咖啡 | $3.00 | USD |
| 暖暖咖啡 | 200 | 暖暖咖啡 | $5.00 | USD |
| 大杯咖啡 | 200 | 大杯咖啡 | $10.00 | USD |

```text
PayPal Checkout Page Verification: PASS
```

## 9. 真正付款 E2E（如實記錄）

```text
Real Payment Completion: FAIL
Failure Layer: PAYPAL_HOSTED_CHECKOUT
Root Cause: SUSPECTED_MERCHANT_ACCOUNT_OR_RECEIVING_LIMITATION
Website Defect: NO
Real Payment E2E: BLOCKED_PAYPAL_ACCOUNT_REVIEW
```

- Support-01.A 已批准人工嘗試小杯咖啡 USD 3。
- PayPal 託管付款頁出現 `generic-error`；一般非自動化 Chrome 亦可重現。
- 判定為疑似 PayPal 商業帳戶／收款能力限制，**不是** `support.html` defect。
- **不得**將此寫成完整付款 E2E PASS。
- 未輸出登入資料、卡號、Secret、token 或完整付款人／Transaction ID。

## 10. 實際費用

未成功完成付款；無確認的 Completed 交易（依使用者回報之託管頁錯誤）。

## 11. 重複交易檢查

`NOT_APPLICABLE`（付款未完成）。

## 12. 訂閱／權益未被修改

- 未改 subscription frontend／backend。
- 未呼叫 `paypal-subscription`／`paypal-checkout`／webhook。
- 未寫 `payment_orders`／subscription tables／`paid_through`。
- 未改 points／coins／tickets／gift／gacha／wallet／account merge。

## 13. 部署前 Gate

| 條件 | 狀態 |
|---|---|
| 本機自動測試 | PASS（854/854） |
| Desktop E2E | PASS |
| Mobile E2E | PASS |
| 三個 checkout 金額核對 | PASS |
| 無 placeholder | PASS |
| 無敏感資料洩漏 | PASS |
| 訂閱 regression（本任務範圍未改動） | PASS |
| 真正付款 E2E | BLOCKED_PAYPAL_ACCOUNT_REVIEW |
| 使用者明確批准部署 | YES（Support-01.B） |

```text
Deployment Decision: FRONTEND_RELEASE_WITH_KNOWN_PAYPAL_ACCOUNT_BLOCKER
```

## 14. 部署與正式站 smoke

- 分支：`main`（GitHub Pages 來源）
- Commit message：`feat: add PayPal coffee support links`
- 僅提交 Support-01 核准檔案；未 force push
- Production URL：`https://starbuckchiang.github.io/claw-lucky/support.html`
- 正式站 smoke（部署後填寫）：見部署執行結果

## 15. 聲明

未修改 Supabase、PayPal Secrets、訂閱流程。本次僅前端靜態連結導向與 GitHub Pages 發布。

## 16. 敏感資料

本文件不含帳密、卡號、token、Authorization header、完整付款人資料或完整 Transaction ID。
