# review-auth-07C.6-subscription-frontend

Auth-07C.6：PayPal 自動續訂前端整合與本機 Mock 驗收。

前置：

- `docs/0-review/review-auth/review-auth-07C.1A-paypal-subscriptions-design-fix.md`
- `docs/0-review/review-auth/review-auth-07C.4-subscription-backend-webhook.md`
- `docs/0-review/review-auth/review-auth-07C.5-subscriptions-backend-release.md`

```text
Gate: PASS
```

```text
Remote DB Changed: NO
PayPal Subscription Created: NO
Payment Attempted: NO
Functions Deployed: NO
Secrets Changed: NO
Webhook Changed: NO
Commit/Push Performed: NO
```

---

## 1. 交付物

| 項目 | 路徑 |
|---|---|
| Page copy / panels | `subscription.html` |
| Page styles | `css/pages/subscription.css` |
| Page entry | `js/pages/subscription-entry.js` |
| Flow helpers（可測） | `js/services/subscription/paypal-subscription-flow.js` |
| Edge client（既有） | `js/services/subscription/paypal-subscription-service.js` |
| Tests | `js/services/subscription/__tests__/paypal-subscription-flow.test.js` |

未改：migration、RPC、Secrets、Edge Functions、Webhook、`paypal-checkout`。

---

## 2. SDK

- Loader：`vault=true`、`intent=subscription`、`currency=USD`、`components=buttons`
- 若偵測到舊 `intent=capture` script → 移除後再載入，避免雙 SDK
- 頁面改載 `paypal-subscription-*`，**不再**載入 `paypal-checkout-service.js`
- Buttons：`createSubscription`（非 `createOrder`／`capture_order`）

---

## 3. 方案與文案

- monthly USD 5／月、yearly USD 48／年，皆標示自動續訂／可取消
- 明確：付款後依週期自動扣款；取消後可用至已付款週期結束
- 前端只傳 `plan_code`；`plan_id`／amount／currency 來自 `create_session`

---

## 4. 流程

1. Official user → mount Subscribe buttons  
2. `create_session` → `actions.subscription.create({ plan_id, custom_id: checkout_session_id })`  
3. `onApprove` → `confirm_subscription({ subscriptionID, checkout_session_id })`  
4. UI：「訂閱已核准，正在確認首期付款」— **不**立即宣稱權益  
5. Poll `get_status`（上限／退避／可 stop）；`paid_through` 且非 `access_blocked` →「訂閱使用中」  
6. Refresh／bootstrap：official user 呼叫 `get_status` 恢復  
7. Cancel：二次確認文案 → `cancel_subscription` → 再 `get_status`；成功前不改 UI 為已取消  

Busy lock：建立訂閱與取消皆防雙擊。

---

## 5. 狀態 UI

| 條件 | UI |
|---|---|
| `subscription=null` | 顯示月／年方案按鈕 |
| APPROVAL_PENDING／APPROVED | 訂閱申請處理中；隱藏新訂閱 |
| ACTIVE + `paid_through` | 訂閱使用中＋取消按鈕 |
| ACTIVE 無 `paid_through` | 首期付款確認中 |
| CANCELLED + 期限內 | 已取消自動續訂，可使用至… |
| EXPIRED／EXPIRED_SETUP | 可重新選方案 |
| SUSPENDED／`access_blocked` | 提示＋無付款按鈕 |

日期以本地時區顯示；權威值仍為後端 UTC。

---

## 6. Auth upgrade

既有 `SubscriptionEntryGuard` 保留 `checkoutContext.planId`。  
Anonymous／訪客先 OTP／Google 升級；僅 `ENTER_CHECKOUT` 後才 mount 按鈕（才可能 `create_session`）。

---

## 7. 錯誤

- `onCancel`：「尚未完成訂閱」＋約 30 分鐘提示；不自動重開 PayPal；不釋放 slot  
- `onError`／sanitize：不輸出 JWT／Email／Plan ID／subscriptionID／PayPal body  
- Auth 過期：停止流程並引導重新登入  

---

## 8. 測試

Mock SDK／API only — **無**真實 PayPal Subscription／付款／`create_session` 遠端呼叫。

```text
paypal-subscription-flow.test.js: 16 pass
paypal-subscription-service.test.js: 2 pass（既有）
verify-local.ps1: 827 pass / 0 fail
```

覆蓋：SDK 參數、無 createOrder、plan_code、無硬編 Plan ID、custom_id、雙擊鎖、confirm、不立即權益、paid_through ACTIVE、polling、CANCELLED 期限、SUSPENDED／blocked、EXPIRED_SETUP、cancel 確認、onCancel、JWT 過期、legacy 回歸（verify-local 全套）。

畫面狀態以 mock view-model 覆蓋；本 Gate **未**點擊真實 PayPal 核准。

---

## Auth-07C.6 Result

```text
Auth-07C.6 Result:
SDK Intent: subscription
SDK Vault: true
Legacy createOrder Removed From Page: YES
Monthly Auto-renew UI: YES
Yearly Auto-renew UI: YES
Create Session: YES (plan_code only → Edge)
CreateSubscription: YES (server plan_id)
Custom ID: checkout_session_id
Confirm Subscription: YES
Confirm Grants Immediate Access: NO
Paid-through UI: YES (poll + ACTIVE)
Duplicate Click Protection: YES
Refresh Recovery: YES (get_status bootstrap)
Cancel Confirmation: YES
Cancelled Access: YES (paid_through retained)
Auth Upgrade: YES (plan retained)
Sensitive Data Leakage: NO (sanitized)
Responsive UI: YES (CSS grid + mobile meta)
Tests Passed: 827
Tests Failed: 0
Remote DB Changed: NO
PayPal Subscription Created: NO
Payment Attempted: NO
Functions Deployed: NO
Secrets Changed: NO
Webhook Changed: NO
Commit/Push Performed: NO
Gate: PASS
```
