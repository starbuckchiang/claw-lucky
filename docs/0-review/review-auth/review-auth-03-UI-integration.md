# P-AUTH-03.1 Subscription Entry UI Integration — Review

## 修改哪些
- 新增 `subscription.html`：訂閱入口頁。2 個示範方案卡片（`data-plan-id`/`data-plan-label`）、
  Email/OTP 輸入面板（寄送驗證碼→輸入驗證碼→驗證）、「Ready for Checkout」暫代付款狀態面板、
  錯誤＋重試面板。載入既有 `config.js`/`api.js`/Turnstile/`user.js`，以及
  `auth-service.js`/`email-otp-service.js`/`subscription-entry-guard.js` 與新頁面控制器。
- 新增 `js/pages/subscription-entry.js`：DOM 事件層，串接 `SubscriptionEntryGuard`——按鈕點擊只呼叫
  `evaluateSubscriptionEntry()` / `startUpgrade()` / `completeUpgradeAndResume()`，不重複實作任何
  Auth 邏輯。`checkoutContext`（`planId`）以記憶體變數保留，全程無 `location.reload`/表單提交，
  按鈕皆 `type="button"` 並 `preventDefault()`。
- 新增 `css/pages/subscription.css`：沿用既有 `.panel`/`.hero-card`/`.badge`/`.btn` 元件樣式，僅補版面
  排版與輸入框樣式。
- 修改 `js/services/auth/email-otp-service.js`、`js/services/auth/subscription-entry-guard.js`：
  修正對 `auth-service.js` 的依賴載入方式——原本用 Node `require()`，在瀏覽器 `<script>` 直接載入時會
  因 `require` 不存在而整頁掛掉；改為「Node 環境用 `require()`，瀏覽器環境退回讀取已載入的
  `window.AuthService`」，Node 測試行為完全不變。**這是本階段實際串接 UI 後才發現的既有缺陷**，修正
  範圍僅限依賴載入方式，未變更任何商業邏輯。
- 修改 `index.html`：新增一個 `entry-card` 連結到 `subscription.html`。
- 修改 `scripts/verify-local.ps1`：加入 `js/pages/subscription-entry.js` 的 `node --check`。

## 為什麼
依 `prompts-auth-03-UI-integration.md`，需將 P-AUTH-01～03 的 Service 實際接上訂閱入口 UI，且不得複製
Auth 邏輯、不得修改 Database Schema。頁面控制器刻意保持「薄」——所有身份判斷/升級/續接邏輯全部委由
`SubscriptionEntryGuard`，控制器只做 DOM 讀寫與事件綁定，符合既有 `js/pages/wallpaper.js` 的慣例。

## 驗收結果
- `.\scripts\verify-local.ps1`：Syntax Check 全過（含新檔案）；Unit Tests 278/278 全數通過（無新增
  測試——`js/pages/**` 為 DOM 膠水層，本身不可在 Node 下單元測試，與既有 `wallpaper.js`/`gacha.js`
  等頁面控制器慣例一致，僅以 `node --check` 做語法驗證）。
- 未破壞既有功能。

## 已知限制（重要，建議 P-AUTH-04 前釐清）
- **Spec 內部疑似衝突**：Section 3「Official User Definition」要求 Email 驗證 **且** Google 已驗證；
  但 Section 4「Anonymous Upgrade」流程圖僅畫出 Email OTP 一條路徑就直接標示「Official User」，未提及
  Google 驗證步驟。本專案目前完全沒有實作 Google OAuth 連結，因此**真實手動 E2E 測試時，完成 Email
  OTP 驗證後，`isOfficialUser()` 仍會回傳 `false`（因缺少 Google identity），UI 會停在
  `upgrade_incomplete` 訊息，而非直接進入 Ready for Checkout**。這不是本階段的 bug，而是沿用
  P-AUTH-01 既有邏輯的必然結果；建議下一階段先向 Spec Owner 確認「v1 是否僅需 Email OTP 即可視為
  Official」，再決定是否調整 `isOfficialUser()`。
- 「Ready for Checkout」僅為暫代畫面，未接任何真實 Checkout/Payment/Webhook。
- 未實作 Account Merge（Spec 第 7 節）。

## 手動 E2E 步驟
1. 以本機/靜態伺服器開啟 `subscription.html`（需可連線到 Supabase，Turnstile 才能完成匿名登入）。
2. 全新訪客：點選任一方案「訂閱」按鈕 → 預期顯示 Email/OTP 面板（因為此時仍是 Anonymous User）。
3. 輸入 Email，點「寄送驗證碼」→ 至 Supabase Auth 後台或測試信箱取得驗證碼。
4. 輸入驗證碼，點「驗證並繼續」：
   - 若帳號已有 Google identity（少數情境）→ 預期顯示「Ready for Checkout」，且方案名稱與步驟 2
     點選的一致（驗證 checkoutContext 有被保留）。
   - 一般情境（無 Google identity）→ 依上方已知限制，會顯示「身份尚未完全通過驗證」訊息。
5. 輸入錯誤驗證碼 → 預期顯示錯誤面板＋「重試」按鈕；點「重試」應返回 Email 輸入步驟，且不遺失原本
   選擇的方案（背景保留同一個 `pending.checkoutContext`）。
6. 全程觀察瀏覽器網址列與 Network 分頁：不應出現整頁 reload/navigation，只會有 Supabase Auth 的
   fetch 請求。
7. 檢查 `localStorage.supabaseAuthUserId`：升級前後應完全相同（UUID Preservation）。
