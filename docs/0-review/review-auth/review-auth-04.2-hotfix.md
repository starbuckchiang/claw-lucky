# P-AUTH-04.2 Hotfix — 既有 Email 登入分流（Existing Account Login）— Review

## 根因（Root Cause）
`subscription.html` 訂閱流程中，Anonymous User 輸入 Email 後一律呼叫
`EmailOtpService.sendUpgradeOtp()`，其內部使用 Supabase 的「匿名帳號升級」API
`authClient.updateUser({ email })`。當使用者輸入的 Email **已經是另一個既有正式帳號**時，
Supabase 會回傳錯誤（訊息類似 `A user with this email address has already been registered`），
但修正前的程式碼只是把 `result.error.message` **原封不動**包進 `OTP_SEND_FAILED` 的 DTO，
再由 `js/pages/subscription-entry.js` 直接塞進 `sendOtpStatus.textContent` 顯示——等於把
Supabase 的原始英文錯誤直接丟給使用者，且流程整個卡住（沒有任何後續分流邏輯），使用者無法用
這個既有 Email 完成任何登入或訂閱動作。

根本原因可歸納為兩點：
1. **少了「Email 已註冊」的錯誤分類**：`sendUpgradeOtp()`/`email-otp-service.js` 從未檢查
   Supabase 回傳的是不是這種特定錯誤，一律視為普通的 `OTP_SEND_FAILED` 並直接顯示原始訊息
   （違反需求 5：不得洩漏 Supabase 原始英文錯誤）。
2. **少了「既有帳號登入」這條路徑**：`specs/003-spec-auth-subscription.md` 第 7 節（Existing
   Account Login）從一開始就被 P-AUTH-02/03 明確排除在範圍外（見兩份文件的模組註解），所以
   整個程式庫裡從未實作過「用既有帳號的 Email 直接走登入 OTP（而非匿名升級 OTP）」這條路徑，
   也自然沒有「登入既有帳號後應如何處理」的邏輯——這正是這次 Hotfix 需要補上的部分。

## 追加修正（Hotfix-of-Hotfix，真實瀏覽器 E2E 測試中發現）
第一輪修正部署後，實際在瀏覽器測試既有 Email 時，`isEmailAlreadyRegisteredError()` 的偵測
沒有生效，UI 改顯示泛用的「驗證碼寄送失敗，請稍後再試。」（雖然已經不是原始英文錯誤，但也沒有
正確分流到既有帳號登入路徑）。

根因：`sendUpgradeOtp()` 只有在 `authClient.updateUser()` **正常回傳** `{ data, error }` 且
`result.error` 存在時才會呼叫 `isEmailAlreadyRegisteredError()`；但實測環境中，這個呼叫是以
**拋出例外（thrown exception）** 的方式失敗，直接進了 `catch` 區塊，而 `catch` 區塊原本完全沒有
呼叫 `isEmailAlreadyRegisteredError()`，一律回傳泛用 `OTP_SEND_FAILED`。

修正：`catch` 區塊比照 `result?.error` 分支，同樣先呼叫 `isEmailAlreadyRegisteredError(error)`
判斷是否為既有帳號情境，是的話回傳 `EMAIL_ALREADY_REGISTERED`；否則才回退到泛用
`OTP_SEND_FAILED`。另外在兩個分支都加上**暫時性**的 `console.warn` 診斷 log（僅記錄
`name`/`code`/`status`/`message`，不影響回傳給 UI 的訊息、也不寫進 DTO 的 `message` 欄位），
方便下一輪真人測試時從瀏覽器 Console 直接看到 Supabase 原始錯誤的實際欄位形狀，之後可視情況
移除。已新增測試涵蓋「以 thrown exception 形式失敗、且帶有 `already been registered` 訊息與
`email_exists` code」的情境。`subscription.html` 對應腳本版本號更新為
`email-otp-service.js?v=20260815-2`。

## 追加修正 #2（真實瀏覽器 E2E 測試中發現：既有帳號登入 OTP 遭 Supabase Captcha 擋下）
套用追加修正 #1 後，實測確認 `updateUser()` 的 422 錯誤已正確分類為 `EMAIL_ALREADY_REGISTERED`
（Console 顯示 `PUT .../auth/v1/user 422`），並正確切換到既有帳號登入分支；但緊接著呼叫
`signInWithOtp()` 寄送登入用驗證碼時，Console 顯示 `POST .../auth/v1/otp 400 (Bad Request)`，
UI 顯示「登入驗證碼寄送失敗，請稍後再試。」。

根因：本專案的 Supabase Auth 專案已啟用 Captcha（Cloudflare Turnstile）保護（可見
`js/user.js` 既有的 `signInAnonymously({ options: { captchaToken } })` 呼叫）。`updateUser()`
是對「目前已登入使用者」的 PATCH，不受 Captcha 保護，所以之前沒有出現這個問題；但
`signInWithOtp()` 是公開的登入入口（Public Sign-in Endpoint），會被同一組 Captcha 規則擋下——
沒有帶 `captchaToken` 就一律回傳 `400 Bad Request`。新增的 `sendLoginOtp()` 當初完全沒有帶
`captchaToken`，因此必定失敗。

修正：
- `js/user.js`：把既有的 `verifyTurnstile()`（原本只在檔案內部給 `signInAnonymously` 用）
  透過 `window.UserStore.verifyTurnstile` 導出，讓其他流程可以重複使用同一組 Turnstile 元件
  邏輯，不需要另外複製一份。
- `js/services/auth/email-otp-service.js`：`sendLoginOtp({ email, captchaToken })` 新增
  `captchaToken` 參數，轉呼叫 `authClient.signInWithOtp({ email, options: { shouldCreateUser:
  false, captchaToken } })`；`catch`／`result?.error` 兩個分支都加上與追加修正 #1 相同風格的
  暫時性 `console.warn` 診斷 log。
- `js/services/auth/subscription-entry-guard.js`：`startLoginOtp({ email, captchaToken })`
  原樣轉發 `captchaToken`。
- `js/pages/subscription-entry.js`：偵測到 `EMAIL_ALREADY_REGISTERED` 時，先呼叫
  `window.UserStore.verifyTurnstile()` 取得一組新的 Turnstile token（畫面會彈出與匿名登入
  相同的驗證方框），再帶著這個 token 呼叫 `guard.startLoginOtp({ email, captchaToken })`；
  若使用者未完成驗證（Turnstile 失敗/逾期），顯示繁中友善錯誤訊息，不會呼叫 Supabase。
- `subscription.html`：`js/user.js`/`email-otp-service.js`/`subscription-entry-guard.js`/
  `subscription-entry.js` 對應版本號更新為 `?v=20260815-1`（user.js）／`?v=20260815-3`
  （email-otp-service.js）／`?v=20260815-2`（其餘兩個）。

**注意**：`verifyOtp()`（驗證階段，不論是升級還是既有帳號登入）目前判斷不受 Captcha 保護
影響（Supabase 的 Captcha 保護通常只套用在「發起」登入/註冊的端點，而非驗證碼比對本身），
本次未替 `verifyLoginOtp()`/`verifyUpgradeOtp()` 加上 `captchaToken`；若下一輪真實測試中
`verifyOtp()` 也出現 `400`，需要再追加一次 Hotfix。

## 修改哪些檔案
- `js/services/auth/email-otp-service.js`
  - 新增 `isEmailAlreadyRegisteredError(error)`：同時判斷新版 GoTrue 的 `error.code ===
    "email_exists"`/`"user_already_exists"`，以及舊版只有英文訊息（包含 `already` 且包含
    `registered`/`exists`）兩種型態，避免依賴單一格式。
  - `sendUpgradeOtp()`：偵測到上述錯誤時回傳新的 `EMAIL_ALREADY_REGISTERED`（`details.requiresLogin
    = true`），不再回傳泛用 `OTP_SEND_FAILED`；**thrown exception 與 resolved-with-error 兩種
    失敗形狀都會檢查**（見上方「追加修正」）。
  - 新增 `FRIENDLY_MESSAGES`：所有對外錯誤訊息（`INVALID_EMAIL`/`OTP_SEND_FAILED`/
    `EMAIL_ALREADY_REGISTERED`/`INVALID_OTP`/`OTP_VERIFY_FAILED`/`AUTH_UUID_MISMATCH`/
    `LOGIN_OTP_SEND_FAILED`/`LOGIN_OTP_VERIFY_FAILED`）改為固定的繁中友善文字；Supabase/JS 原始
    錯誤訊息保留在 `details.rawMessage`（僅供 log/debug，UI 不會讀取這個欄位）。
  - 新增 `sendLoginOtp({ email, captchaToken })`／`verifyLoginOtp({ email, token })`：既有帳號登入
    （spec 第 7 節）。`sendLoginOtp` 呼叫 `authClient.signInWithOtp({ email, options: {
    shouldCreateUser: false, captchaToken } })`——`shouldCreateUser: false` 是關鍵，確保 Supabase
    在該 Email 沒有既有帳號時「不會」建立新帳號（不會誤觸這條路徑去建立重複帳號）；`captchaToken`
    則是追加修正 #2 補上的，因為這是公開登入端點，受本專案的 Supabase Captcha 保護。
    `verifyLoginOtp` 呼叫既有的 `authClient.verifyOtp()`，但**刻意不做 UUID Preservation 檢查**
    （這條路徑本來就預期回傳「不同於匿名 UUID」的既有帳號 UUID）。
  - `createEmailOtpService()` 的建構檢查新增要求 `authClient.signInWithOtp` 必須存在。
- `js/services/auth/subscription-entry-guard.js`
  - `ACTION` 新增 `START_EMAIL_OTP_LOGIN`、`LOGIN_FAILED`、`EXISTING_ACCOUNT_MERGE_REQUIRED`。
  - 新增 `startLoginOtp({ email, captchaToken })`（薄轉發至 `emailOtpService.sendLoginOtp`，原樣
    轉發 `captchaToken`）與 `completeLoginAndResume({ email, token, pending })`：驗證成功且為
    Official User 時，**永遠**回傳 `EXISTING_ACCOUNT_MERGE_REQUIRED`（見下方 Blocker 說明），
    絕不直接回傳 `ENTER_CHECKOUT`／自動接續原本的 `checkoutContext`。
  - 建構檢查新增要求 `emailOtpService.sendLoginOtp`/`verifyLoginOtp` 必須存在。
- `js/pages/subscription-entry.js`
  - 新增 `pendingMode`（`"upgrade"` / `"login"`）狀態，記錄目前是走「匿名升級」還是「既有帳號
    登入」分支。
  - `handleSendOtp()`：`guard.startUpgrade()` 回傳 `EMAIL_ALREADY_REGISTERED` 時，先呼叫
    `window.UserStore.verifyTurnstile()` 取得新的 Captcha token，再呼叫
    `guard.startLoginOtp({ email, captchaToken })` 寄送登入用驗證碼，並切換
    `pendingMode = "login"`，UI 顯示對應提示文字（沿用同一組 Email/驗證碼輸入框，不需要使用者
    重新輸入 Email）；Turnstile 驗證失敗時顯示繁中友善錯誤訊息，不會呼叫 Supabase。
  - `handleVerifyOtp()`：依 `pendingMode` 分流呼叫 `guard.completeUpgradeAndResume()` 或
    `guard.completeLoginAndResume()`。收到 `EXISTING_ACCOUNT_MERGE_REQUIRED` 時顯示繁中友善的
    Blocker 訊息（登入成功，但資料尚未合併，請重新點擊「訂閱」），**不會**呼叫 `showReady()`／
    不會自動進入 Checkout。
  - `handlePlanClick()`/`handleRetry()`：重置 `pendingMode = "upgrade"`，避免殘留上一輪的分支
    狀態。
- `js/user.js`：導出既有的 `verifyTurnstile()` 為 `window.UserStore.verifyTurnstile`，供
  `subscription-entry.js` 重複使用同一組 Cloudflare Turnstile 元件邏輯，不需另外複製一份。
- `subscription.html`：對應腳本的 cache-busting 版本號更新（`user.js?v=20260815-1`／
  `email-otp-service.js?v=20260815-3`／`subscription-entry-guard.js`、`subscription-entry.js`
  皆為 `?v=20260815-2`）。
- `js/services/auth/__tests__/email-otp-service.test.js`：`authClient` mock 補上 `signInWithOtp`；
  新增 `EMAIL_ALREADY_REGISTERED`（含/不含 `error.code` 兩種情境、thrown exception 情境、以及
  「不誤判」的反例）、`sendLoginOtp`（含 `shouldCreateUser: false` 與 `captchaToken` 轉發驗證）、
  `verifyLoginOtp` 測試（UUID 刻意不同、friendly message 不外洩原始英文訊息）。
- `js/services/auth/__tests__/subscription-entry-guard.test.js`：`emailOtpService` mock 補上
  `sendLoginOtp`/`verifyLoginOtp`；新增 `startLoginOtp`（含 `captchaToken` 轉發驗證）/
  `completeLoginAndResume` 測試，特別驗證「登入既有帳號成功後絕不自動進入 `ENTER_CHECKOUT`」。

未修改：任何方案/價格設定、資料庫 schema、RLS、既有公開 API；`auth-service.js` 的
`resolveAuthState`/`isOfficialUser` 邏輯本身未變動。

## Blocker（依需求 4 記錄，禁止自行處理）
`specs/003-spec-auth-subscription.md` 第 7 節要求既有帳號登入時，須對 Cart／Mascot／Gift／
Points／Subscription 做資料合併（Points 需建立交易紀錄而非直接相加；一位使用者僅能有一個有效
訂閱等）。**目前整個程式庫裡沒有任何跨 Auth UUID 的資料合併機制**（沒有對應的 repository/
service，也沒有相關資料表或欄位設計）。

因此本次 Hotfix 的既有帳號登入路徑（`completeLoginAndResume`）在驗證成功、確認是 Official User
之後，**刻意不會**自動接續原本選擇的訂閱方案進入 Checkout，而是回傳
`EXISTING_ACCOUNT_MERGE_REQUIRED`，UI 顯示「已登入既有帳號，但資料尚未合併，請重新點擊訂閱」。
使用者仍可用既有帳號手動重新操作（此時 `evaluateSubscriptionEntry()` 會直接判定為
Official User 並進入 Checkout，只是不會自動帶著匿名身份的購物車/吉祥物/點數資料）。

**這是刻意的行為，不是遺漏**：跨 UUID 合併若貿然自動化，有靜默遺失或重複使用者資料的風險，
不在本次 Hotfix 授權範圍內，需另立任務（例如 P-AUTH-05 或未來的 Account Merge 專案）設計
Cart/Mascot/Gift 去重、Points 交易紀錄、Subscription 唯一性檢查等機制後才能安全自動化。

## 自動測試結果
執行 `.\scripts\verify-local.ps1`：

```
== Syntax Check ==  全數通過
== Unit Tests ==
ℹ tests 316
ℹ suites 0
ℹ pass 316
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
Verification Complete
```

新增測試（均通過）：
- `email-otp-service.test.js`：
  - `createEmailOtpService requires ... signInWithOtp`（建構檢查含新依賴）
  - `sendUpgradeOtp: Supabase 'already registered' error (with code) is normalized as
    EMAIL_ALREADY_REGISTERED with a zh-TW friendly message`
  - `sendUpgradeOtp: Supabase 'already registered' error (message only, no code) is still
    normalized as EMAIL_ALREADY_REGISTERED`
  - `sendUpgradeOtp: unrelated Supabase error message never mismatches as
    EMAIL_ALREADY_REGISTERED`
  - `sendUpgradeOtp: Supabase 'already registered' error thrown as an exception (not resolved
    with {error}) is still normalized as EMAIL_ALREADY_REGISTERED`（涵蓋「追加修正」的情境）
  - `sendLoginOtp: rejects invalid email without calling Supabase`
  - `sendLoginOtp: success returns the normalized email, never creates a new account
    (shouldCreateUser: false), and forwards captchaToken (Supabase Captcha protection on this
    public endpoint)`（涵蓋「追加修正 #2」的 captchaToken 轉發）
  - `sendLoginOtp: Supabase error is normalized as LOGIN_OTP_SEND_FAILED with a friendly message`
  - `sendLoginOtp: thrown exception is normalized as LOGIN_OTP_SEND_FAILED`
  - `verifyLoginOtp: rejects missing token`
  - `verifyLoginOtp: success returns the EXISTING account's Auth UUID ... without enforcing UUID
    Preservation`
  - `verifyLoginOtp: Supabase error is normalized as LOGIN_OTP_VERIFY_FAILED with a friendly
    message`
  - `verifyLoginOtp: thrown exception is normalized as LOGIN_OTP_VERIFY_FAILED`
- `subscription-entry-guard.test.js`：
  - `createSubscriptionEntryGuard requires ...`（建構檢查含 `sendLoginOtp`/`verifyLoginOtp`）
  - `startUpgrade: EMAIL_ALREADY_REGISTERED is passed through unchanged so the caller can switch to
    startLoginOtp`
  - `startLoginOtp: delegates to emailOtpService.sendLoginOtp unchanged, forwarding captchaToken`
  - `completeLoginAndResume: successful login to a DIFFERENT existing account ->
    existing_account_merge_required, NEVER auto-resumes Checkout`
  - `completeLoginAndResume: verify failure -> login_failed, pending preserved for retry`

既有測試（新增/既有Email、錯誤 OTP、重送、刷新狀態等）全數維持通過，未因本次修改而回歸失敗。

## Gate 4 手動 E2E 步驟（尚未於真實瀏覽器執行 — 依需求 8，不宣告 PASS）
本次工作僅完成程式碼修改與 `node --test` 自動化測試，**沒有**啟動真實瀏覽器對接真實 Supabase
專案驗證。以下步驟提供給下一步做真人手動驗證使用，完成前 Gate 4 狀態為 **PENDING（未驗證）**。

前置：需要 2 個測試帳號 —— 帳號 A（尚未使用過的全新 Email，用於匿名升級路徑）、
帳號 B（Supabase Auth 後台已存在的正式帳號 Email，用於既有帳號登入路徑）。

1. **新 Email（匿名升級，既有行為應維持不變）**
   - 以無痕視窗開啟 `subscription.html`（全新 Anonymous session）。
   - 點選任一方案「訂閱」→ 應顯示 Email/OTP 面板。
   - 輸入帳號 A 的 Email → 點「寄送驗證碼」→ 狀態文字應顯示「驗證碼已寄至 ...」。
   - 至信箱取得驗證碼 → 輸入並點「驗證並繼續」→ 應顯示「Ready for Checkout」，方案名稱與步驟
     2 點選的一致（`checkoutContext` 保留）。
   - 檢查 `localStorage`/Supabase Auth 後台：升級後的 Auth UUID 應與升級前的匿名 UUID 相同
     （UUID Preservation）。

2. **既有 Email（本次 Hotfix 的核心情境）**
   - 以另一個無痕視窗開啟 `subscription.html`（全新 Anonymous session）。
   - 點選任一方案「訂閱」→ 顯示 Email/OTP 面板。
   - 輸入帳號 B（**已存在的正式帳號**）Email → 點「寄送驗證碼」。
   - **預期**：狀態文字顯示繁中友善訊息（例如「此 Email 已註冊過帳號，登入用驗證碼已寄至
     ...」），**不應**出現任何英文 Supabase 原始錯誤字串，畫面**不應卡住**，應直接進入驗證碼
     輸入步驟。
   - 至帳號 B 的信箱取得登入用驗證碼 → 輸入並點「驗證並繼續」。
   - **預期**：顯示錯誤/提示面板，訊息為「登入成功！此 Email 已有正式帳號，但目前身份的資料
     尚未合併，暫不支援自動繼續訂閱。請重新點擊「訂閱」按鈕，以此帳號繼續操作。」，**不應**
     自動跳到「Ready for Checkout」畫面。
   - 檢查 Supabase Auth 後台：帳號 B 的 Auth UUID 不應改變、且**沒有**產生任何新的重複帳號
     （`shouldCreateUser: false` 應生效）。
   - 再次點擊「訂閱」按鈕（此時瀏覽器 session 已是帳號 B 的正式帳號）→ 應直接顯示
     「Ready for Checkout」（因為 `evaluateSubscriptionEntry()` 判定已是 Official User）。

3. **錯誤 OTP**
   - 於既有 Email 登入流程（步驟 2）中，故意輸入錯誤的 6 碼驗證碼 → 預期顯示繁中友善的
     「驗證碼錯誤或已逾期，請重新寄送」訊息，不應出現英文原始錯誤。

4. **重新寄送（Resend）**
   - 於任一分支（新 Email 或既有 Email）點擊「重新寄送」→ 應重新呼叫對應的
     `sendUpgradeOtp`/`sendLoginOtp`，狀態文字更新為「已重新寄送」等提示，不應報錯。

5. **刷新狀態 / 中途重試**
   - 於任一分支輸入驗證碼前，點擊「重試」返回 Email 輸入步驟 → 應清除 `pendingMode`（回到
     `"upgrade"`）且不遺失原本選擇的方案（`pending.checkoutContext`），可重新輸入不同 Email
     並得到正確分流結果。

6. **Network/URL 全程觀察**
   - 全程不應出現整頁 reload/navigation，僅應看到 Supabase Auth 的 fetch 請求
     （`updateUser`/`verifyOtp`/`signInWithOtp`/`refreshSession`/`getSession`）。

完成以上 6 項且結果與「預期」欄一致後，才可將 Gate 4 標記為 PASS；任一項不符，請記錄實際
現象並視為新的 Hotfix 需求，勿自行修改跨 UUID 合併邏輯。
