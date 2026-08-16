# P-AUTH-03 Subscription Entry Guard — Review

## 修改哪些
- 新增 `js/services/auth/subscription-entry-guard.js`：Subscription Entry Guard（純協調層，DI 模式，
  預設沿用 P-AUTH-01 `auth-service.js`）。提供 `createSubscriptionEntryGuard({ authService,
  emailOtpService })` →
  - `evaluateSubscriptionEntry({ session, user, checkoutContext })`：呼叫 `isOfficialUser()`（經
    `resolveAuthState()`），Official → `enter_checkout`；非 Official（Anonymous/Visitor）→
    `start_email_otp_upgrade`，並將 `checkoutContext` 存入 `pending` 保留原訂閱意圖。
  - `startUpgrade({ email })`：轉呼叫 P-AUTH-02 `sendUpgradeOtp()`。
  - `completeUpgradeAndResume({ email, token, previousAuthUserId, pending })`：轉呼叫
    `verifyUpgradeOtp()`，成功且 Official → `enter_checkout` 並帶回原 `checkoutContext`
    （Return-to-Checkout Flow）；失敗或仍非 Official → `upgrade_failed`/`upgrade_incomplete`，
    `pending` 原樣保留供重試。
- 新增 `js/services/auth/__tests__/subscription-entry-guard.test.js`：8 個單元測試，涵蓋
  Official/Anonymous/Visitor 三種入口判斷、checkoutContext 保留、Upgrade 成功後續接 Checkout、
  Upgrade 失敗與「verify 成功但仍非 Official」情境、建構子依賴檢查。
- 修改 `scripts/verify-local.ps1`：加入新檔案的 `node --check`（測試 glob 已涵蓋
  `js/services/auth/__tests__/*.test.js`）。
- 未修改任何 HTML/UI、Database Schema、Payment/Webhook/Subscription 啟用邏輯。

## 為什麼
依 003-spec-auth-subscription.md 第 8 節，訂閱入口需先判斷 `isOfficialUser()`：Official 直接進
Checkout，否則走 Email OTP Upgrade 後自動返回原訂閱流程。本模組全程不做 I/O、不操作 DOM/localStorage、
不導頁——只回傳下一步 `action` 供前端就地處理，天然滿足「不重整頁面／保留目前頁面與操作狀態」；
`checkoutContext` 透過 `pending` 在整個 Upgrade 往返中保留，滿足 Return-to-Checkout Flow 交付項。

## 驗收結果
- `.\scripts\verify-local.ps1`：Syntax Check 全過；Unit Tests 278/278 通過（原 270 + 新增 8），0 失敗。
- Official 直接 Checkout、Anonymous 完成 Upgrade 後自動繼續 Checkout（含原 checkoutContext）、
  Upgrade 失敗/未完全轉正時不強行進入 Checkout，皆有對應測試並通過；未破壞既有測試。

## 待 P-AUTH-04 處理事項（不實作）
- Subscription Checkout Edge Function 本身（含 Section 11 的 401/403/重複訂閱防呆）。
- Payment / Webhook / Subscription 實際啟用。
- Existing Account Login 的 Account Merge（Spec 第 7 節）。
- 前端串接（訂閱按鈕、OTP 輸入 UI 實際呼叫本 Guard）。
