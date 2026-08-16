# P-AUTH-04 Wiring Hotfix — Review

## 修改哪些
- 修改 `js/services/auth/email-otp-service.js`：將載入 `auth-service.js` 依賴用的頂層
  `const resolveAuthState = (...)()` 更名為 `const resolveAuthStateFn`，並同步更新內部唯一使用處
  （`verifyUpgradeOtp()` 最終建立 `authState` 那行）。其餘 import/export、`createEmailOtpService()`
  對外 API 完全不變。

## 為什麼（根本原因）
`js/services/**` 的雙輸出模組（`module.exports` + `window.X`）在瀏覽器是以一般 classic `<script src>`
標籤載入（無 bundler、無 `type="module"`），同一頁面所有 classic script 共用同一個全域 lexical
scope。`auth-service.js` 本身在頂層宣告了 `function resolveAuthState(...)`；而
`email-otp-service.js`（P-AUTH-03.1 為了讓其在瀏覽器可用而加的相依載入邏輯）也在頂層宣告了
`const resolveAuthState = ...`——兩者同名，當 `subscription.html` 依序載入
`auth-service.js` 後再載入 `email-otp-service.js` 時，瀏覽器在**解析**
`email-otp-service.js` 當下就拋出 `SyntaxError: Identifier 'resolveAuthState' has already been
declared`。這是 Parse-time 錯誤，會讓整支 `email-otp-service.js` 完全不執行，`window.EmailOtpService`
永遠不會被賦值；接著 `js/pages/subscription-entry.js` 呼叫
`window.EmailOtpService.createEmailOtpService(...)` 時就變成「Cannot read properties of undefined
(reading 'createEmailOtpService')」——兩則 Console 錯誤其實是同一個根因的連鎖反應。
更名為不衝突的 `resolveAuthStateFn` 即可解決，未變更任何商業邏輯、Checkout Authorization 或資料庫。

## 驗收結果
- `.\scripts\verify-local.ps1`：Syntax Check 全過；Unit Tests 300/300 通過（與修正前一致），0 失敗。
- 已將此類「多個 classic `<script>` 共用全域作用域、頂層識別字命名衝突」的風險模式記錄至 repo
  memory，供後續在 `js/services/**` 新增瀏覽器可用的頂層識別字時先行檢查同頁其他已載入檔案。

目前確認：

訂閱按鈕與 Email 驗證介面已正常顯示。
前一個 JavaScript 載入錯誤已修好。
但使用已註冊 Email 時，系統回傳：A user with this email address has already been registered。
流程停住，無法完成身分驗證及繼續訂閱。

根本原因是系統把「既有帳號」仍當成「匿名帳號升級／新帳號註冊」。正確流程應分流：

Email 未註冊：執行匿名帳號升級。
Email 已註冊：顯示「此 Email 已有帳號，請登入」，改走既有帳號的 OTP 登入。
登入成功後，必須安全處理匿名帳號原有資料，再繼續先前選擇的訂閱方案。
不應直接把 Supabase 原始英文錯誤顯示給使用者。

因此目前判定：Gate 4 FAIL，需要 P-AUTH-04.2 hotfix。不要先繼續輸入驗證碼，因為此畫面並未成功寄出。
