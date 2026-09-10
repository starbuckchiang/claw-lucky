# review-auth-07C.7A-plan-button-diagnostic

Auth-07C.7A：訂閱方案按鈕「無反應」**唯讀診斷**（未修碼、未付款）。

```text
Gate: PASS
```

```text
Code Changed: NO
Database Mutated: NO
Subscription Created: NO
Payment Attempted: NO
Deployment Performed: NO
Commit/Push Performed: NO
```

---

## 1. 資料庫（唯讀）

| 表 | 結果 |
|---|---|
| `paypal_subscriptions` | **0** 列 |
| `user_subscription_slots` | **0** 列（無 OCCUPIED） |
| `paypal_subscription_transactions` | **0** 列 |
| 新 subscription session | **NO** |
| PayPal subscription ID | **NO** |
| SALE／transaction | **NO** |

→ **非** `BLOCKED_PENDING_SESSION`。受控點擊前後訂閱表仍為空（點方案不會呼叫 `create_session`）。

Official test user（id prefix `5020bf33…`）：`get_status` → `{ ok: true, subscription: null }`。

---

## 2. Console／Network（重新整理後）

| 檢查 | 結果 |
|---|---|
| `subscription-entry.js` | 載入成功（globals 就緒） |
| `paypal-subscription-flow.js` | 載入成功 |
| `paypal-subscription-service.js` | 載入成功 |
| 404／Syntax／Type／CORS／CSP／export | 僅 `favicon.ico` 404（無關） |
| Bootstrap | 完成；official user 已呼叫 `get_status` |
| `get_status` HTTP | **200**；`subscription: null` |
| PayPal SDK（載入前） | 尚未插入（預期：點方案後才 load） |
| 殘留 `intent=capture` | **NO** |
| 雙 SDK | **NO** |

未輸出 Authorization／完整 Client ID。

---

## 3. DOM／事件

| 檢查 | 結果 |
|---|---|
| 月訂按鈕 | `<button data-plan-id="monthly">`「選擇月訂閱」 |
| 年訂按鈕 | `<button data-plan-id="yearly">`「選擇年訂閱」 |
| Selector | `document.querySelectorAll("[data-plan-id]")` **MATCH** |
| Click listener | 已綁定（受控點擊證實） |
| disabled（點前） | **false** |
| overlay／pointer-events | hit-test = 按鈕本身；`pointer-events: auto` |
| `#paypalButtonsMount` | 存在；點前 empty |

---

## 4. 受控重現（僅一次「選擇月訂閱」）

前置：無 pending session、無 OCCUPIED、點方案本身不呼叫 `create_session` → **允許一次點擊**。

| 觀察 | 結果 |
|---|---|
| Click handler fired | **YES** |
| Selected plan | `monthly`（ready label「月訂閱」） |
| `create_session` 呼叫 | **0** |
| Ready panel | `hidden=false`（「確認自動續訂」） |
| PayPal SDK | 載入成功；**單一份** |
| SDK URL | `vault=true`、`intent=subscription`、`currency=USD`、`components=buttons` |
| `window.paypal.Buttons` | 存在 |
| Buttons render | **resolved**；mount HTML length ≫ 0 |
| PayPal iframe | **YES**（title PayPal；subscribe UI 可見） |
| Console root error | 無（僅 favicon 404） |
| 停在 PayPal 按鈕顯示 | **YES**（未點 PayPal／Agree） |

---

## 5. 根因分類

**功能路徑：正常。** Official user 點「選擇月訂閱」會展開 checkout 面板並 render PayPal Subscribe 按鈕。

使用者感知的「完全沒反應／看不到 PayPal」較可能來自 **UX／視窗**：

- 點擊後方案按鈕變 `disabled`（看起來像壞掉）
- Ready／PayPal 區塊在方案區**下方**；診斷視窗約 **529px** 高時，PayPal iframe 多數需**向下捲動**才完整看見
- 頁面**未** `scrollIntoView` 到 `#readyPanel`／`#paypalButtonsMount`

允許分類對應：

```text
Root Cause: UNKNOWN
```

（功能非 ENTRY／SDK／listener 失敗；屬「更新發生在折線下方、無自動捲動」的感知問題，清單無更精確代碼。）

```text
Safe To Fix: YES
```

建議（**本 Gate 不實作**）：`showReady` 後對 `#readyPanel` 或 `#paypalButtonsMount` 做 `scrollIntoView`；可選短狀態文案「請在下方完成 PayPal 訂閱」。

---

## Auth-07C.7A Result

```text
Auth-07C.7A Result:
New Session Created: NO
Slot State: none (0 rows)
PayPal Subscription ID Exists: NO
SALE Exists: NO
Entry Script Loaded: YES
Module Imports: YES
Bootstrap: YES
Get Status HTTP: 200 (subscription null)
Click Listener Bound: YES
Controlled Click Performed: YES (monthly once)
Click Handler Fired: YES
Selected Plan: monthly
PayPal SDK Loaded: YES
SDK Intent: subscription
SDK Vault: true
Duplicate SDK: NO
PayPal Render Called: YES
PayPal iframe Created: YES
First Console Error: favicon.ico 404 only
Network Error: NO
Root Cause: UNKNOWN
Safe To Fix: YES
Code Changed: NO
Database Mutated: NO
Subscription Created: NO
Payment Attempted: NO
Deployment Performed: NO
Commit/Push Performed: NO
Gate: PASS
```
