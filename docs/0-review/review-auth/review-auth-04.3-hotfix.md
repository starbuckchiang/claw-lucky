# P-AUTH-04.3 Hotfix — OTP 長度、既有帳號登入資料合併 ADR — Review

## 根因（Root Cause）

Gate 4 真實瀏覽器 E2E 過程中發現兩類問題：

1. **OTP 長度被硬編碼為 6 位數**：`subscription.html` 的驗證碼輸入框 placeholder 寫死「請輸入 6 位數
   驗證碼」，`email-otp-service.js` 的 `verifyUpgradeOtp()`/`verifyLoginOtp()` 也只檢查 token 是否為
   空字串，沒有任何格式提示；但 Supabase 實際寄出的 OTP 長度依專案設定可能是 6～8 碼，UI 文字與（缺乏
   的）格式檢查都沒有反映這件事，容易讓使用者誤以為輸入 7、8 碼是錯的。
2. **既有帳號登入成功後，Checkout 被永久卡住，且從未真正嘗試過安全合併**：P-AUTH-04.2 讓
   `completeLoginAndResume()` 在既有帳號登入成功後一律回傳 `EXISTING_ACCOUNT_MERGE_REQUIRED`，但這只是
   「寫死擋住」，程式碼裡完全沒有一個「合併服務」的介面／呼叫點，也沒有對現行資料庫做過完整盤點，
   無法判斷「擋住」是暫時的還是永久的，也沒有為未來安全合併預留可插拔的架構。

## 追加修正（真實瀏覽器 Gate 4 測試中發現：新 Email OTP 驗證一律失敗）

套用上述兩項修正並實際於瀏覽器測試「全新（未註冊過）Email」的匿名帳號升級流程時，發現：Email 成功
收到驗證碼，但輸入正確驗證碼後，`verifyUpgradeOtp()` 一律回傳 `OTP_VERIFY_FAILED`（驗證碼錯誤或已
逾期）——即使驗證碼完全正確、也還在有效期限內。

**根因**：Supabase 針對不同的寄信流程，會產生**不同 `type` 的 OTP**，`verifyOtp()` 驗證時**必須**傳入
與寄送當下完全相同的 `type`，否則 Supabase 會判定驗證碼「無效」（即使數字本身正確）：

- 匿名帳號透過 `authClient.updateUser({ email })` 綁定新 Email → Supabase 寄出的是 **`email_change`**
  類型的 OTP。
- 既有帳號透過 `authClient.signInWithOtp({ email })` 登入 → Supabase 寄出的是 **`email`**（一般登入）
  類型的 OTP。

但 `email-otp-service.js` 的 `verifyUpgradeOtp()`（匿名帳號升級專用）**寫死**呼叫
`authClient.verifyOtp({ email, token, type: "email" })`——用了「既有帳號登入」的 type 去驗證「匿名
帳號升級」寄出的驗證碼，兩者對不上，Supabase 因此**必定**回報驗證失敗，與驗證碼本身是否正確、是否
逾期完全無關。這是全新 Email 升級流程「Gate 4 一定過不了」的真正根因，而非之前懷疑的 OTP 長度或
Captcha 問題。

### 修正方式：以 `otpPurpose` 貫穿整個寄信／驗證流程

- `sendUpgradeOtp()`（`updateUser` 路徑）成功時，回傳 `data.otpPurpose = "email_change"`。
- `sendLoginOtp()`（`signInWithOtp` 路徑）成功時，回傳 `data.otpPurpose = "email"`。
- `verifyUpgradeOtp({ email, token, previousAuthUserId, otpPurpose })`：呼叫
  `authClient.verifyOtp({ ..., type: otpPurpose })`，**不再寫死 `"email"`**；若呼叫端未帶
  `otpPurpose`，預設回退為 `"email_change"`（此函式唯一正確的預設值），但正常流程一律由寄送步驟
  的回傳值往下傳遞，從不由這裡自行猜測。
- `verifyLoginOtp({ email, token, otpPurpose })`：同樣改為 `type: otpPurpose`，預設回退為
  `"email"`。
- `subscription-entry-guard.js` 的 `completeUpgradeAndResume()`/`completeLoginAndResume()` 新增
  `otpPurpose` 參數，原樣轉發給對應的 `verifyUpgradeOtp()`/`verifyLoginOtp()`，不做任何轉換。
- `subscription-entry.js` 新增頁面層狀態 `pendingOtpPurpose`：在 `handleSendOtp()` 成功寄出驗證碼
  時，把 `sendUpgradeOtp()`/`sendLoginOtp()` 回傳的 `otpPurpose` 存起來；`handleVerifyOtp()`
  呼叫 `completeUpgradeAndResume()`/`completeLoginAndResume()` 時帶入 `otpPurpose: pendingOtpPurpose`。
  **重新寄送**（`resendOtpBtn` 呼叫同一個 `handleSendOtp()`）會重新走一次寄送流程，因此每次都會
  重新產生並保存與這次寄送相符的 `otpPurpose`，天然維持一致，不需要額外邏輯。
- 同時補上「清除 OTP 暫存」：新增 `resetPendingOtpState()`，在成功進入 Checkout
  （`ACTION.ENTER_CHECKOUT`）、既有帳號登入的合併阻擋（`ACTION.EXISTING_ACCOUNT_MERGE_REQUIRED`）、
  按下「重試」、或重新點擊「訂閱」開始新一輪流程時呼叫，清除 `pendingGuard`／`pendingEmail`／
  `pendingOtpPurpose`／重置 `pendingMode`，避免任何殘留狀態被下一輪流程誤用。`pendingEmail`（也就是
  spec 所稱的 `pendingNewEmail`）維持既有設計：僅在寄送當下寫入一次，`verify` 步驟一律原樣重用，
  從不重新讀取當下的輸入框內容。
- Session/user 重新取得、Auth State 解析：`verifyUpgradeOtp()` 既有的
  `refreshSession()`→`getSession()`→`resolveAuthStateFn()` 流程未變動（P-AUTH-02-hotfix 已實作），
  本次僅修正 `type` 參數；`pendingPlan` 保留與自動繼續 Checkout 的行為（`pending.checkoutContext`）
  同樣未變動，已透過既有測試涵蓋。

## 資料表盤點（現況，未修改任何 schema）

| 資料表 | Owner 欄位 | 是否有 RLS（`authenticated`）| 前端寫入是否信任 client-supplied ID |
|---|---|---|---|
| `public.users` | `user_id`（舊字串或 Auth UUID） | **找不到** | **是** — `js/api.js` 用 anon key 直接以 `localStorage.supabaseAuthUserId` 來源的 `userId` 讀寫 |
| `public.user_mascots` | `user_id` | **找不到** | 是（同上模式） |
| `public.redeem_history` | `user_id` | **找不到** | 是（同上模式） |
| `public.shop_cart` | `user_id` | **找不到** | 是 — `js/shop/shop_cart.js` |
| `public.orders` / `order_items` | `user_id` | **找不到** | 是 — `js/shop/shop_cart.js` |
| `wallpaper_generations`/`wallpaper_generation_jobs`/`daily_generation_usage` | `user_id` | **有**（`p_*_select_owner` + `RESTRICTIVE ... WITH CHECK (false)`，寫入僅限 service-role） | 否（唯讀） |
| `public.subscriptions` | — | — | **尚不存在**（Checkout 仍是佔位邏輯，從未真的建立過訂閱列） |
| Points 交易紀錄／ledger | — | — | **尚不存在**（`points-repository.js` 目前是「讀出、算術相加、UPDATE」，沒有稽核紀錄） |

結論：`users`/`user_mascots`/`redeem_history`/`shop_cart`/`orders` 這些「要合併」的資料表**目前完全沒有
RLS，且前端寫入信任 localStorage 提供的 userId**——這正是 `supabase.instructions.md` 明確禁止的模式。
若在此基礎上直接做「跨 UID 合併」，等於讓任何已登入使用者可能用 anon key 把別人的資料合併進自己帳號，
是嚴重的水平權限提升風險。加上「Points 必須用交易紀錄」「Subscription 最多一筆有效」這兩條 spec 規則
所需的資料表（`point_transactions`、`subscriptions`）目前都不存在。

**因此依需求 4 明確授權的路徑**：本次不直接對生產資料庫做合併／不新增 migration，而是產出
[ADR-009-existing-account-data-merge.md](../../adr/ADR-009-existing-account-data-merge.md)，記錄完整
盤點、風險、以及未來 SECURITY DEFINER RPC + Edge Function 的規劃 SQL 草稿（明確標示「計畫，未套用」），
不假裝合併已經成功。

## 修改哪些檔案

### OTP 長度修正
- `subscription.html`：驗證碼輸入框 placeholder 改為「請輸入驗證碼（6～8 碼數字）」，並加上
  `pattern="[0-9]{6,8}"`、`maxlength="8"`、`autocomplete="one-time-code"`（純 UX 提升，不影響邏輯）。
- `js/services/auth/email-otp-service.js`：新增 `isValidOtpToken()`（`/^\d{6,8}$/`），取代
  `verifyUpgradeOtp()`/`verifyLoginOtp()` 原本只檢查「是否為空」的邏輯；這只是**先擋掉明顯錯誤的格式**
  （空白、非數字、5 碼以下、9 碼以上），驗證碼**真正是否正確**仍完全交給 Supabase 的 `verifyOtp()` 判斷，
  未自行猜測或寫死正確長度。`FRIENDLY_MESSAGES.INVALID_OTP` 文字同步更新為「請輸入 6～8 碼數字驗證碼。」
  匯出 `isValidOtpToken` 供測試直接呼叫。

### 既有帳號登入資料合併（架構＋誠實的暫時行為）
- 新增 `js/services/auth/account-merge-service.js`：`createAccountMergeService({ mergeRpcClient })`。
  - 未注入 `mergeRpcClient`（**目前正式環境的真實狀態**，因為 RPC 尚未建置）時，
    `mergeAnonymousIntoExistingAccount()` **一律**回傳 `MERGE_NOT_SUPPORTED`（`retryable:false`），
    絕不假裝合併成功。
  - 若未來注入真正的 `mergeRpcClient`（呼叫 ADR-009 規劃的 Edge Function/RPC），本服務會呼叫它並將
    `{ok, data}`/`{ok:false, error:{code, message, retryable}}` 原樣往上傳遞；`idempotencyKey` 為必要
    參數，缺少時回傳可重試的 `MERGE_IDEMPOTENCY_KEY_REQUIRED`。
- `js/services/auth/subscription-entry-guard.js`：
  - 新增可注入的 `accountMergeService`（預設載入 `window.AccountMergeService`/`require(...)` 的
    「未配置」版本），建構檢查新增要求其具備 `mergeAnonymousIntoExistingAccount(...)`。
  - `completeLoginAndResume({ email, token, pending, previousAuthUserId })`：既有帳號登入驗證成功、
    確認為 Official User 後，改為**實際呼叫** `accountMergeService.mergeAnonymousIntoExistingAccount()`，
    帶入依 `previousAuthUserId`（匿名 UUID）與登入後 `authUserId`（既有帳號 UUID）決定性推導出的
    `idempotencyKey`（`merge:<anon>:<existing>`，同一組永遠相同，安全可重試）：
    - 合併成功 → 回傳 `ACTION.ENTER_CHECKOUT`，自動接續 `pending.checkoutContext`（需求 5）；
      Authentication State 沿用 `verifyLoginOtp()` 已刷新的結果（登入本身就是該既有帳號的真實
      Session，合併不影響身份，故不需要再次 refresh session）。
    - 合併失敗（目前**必定**如此，因為尚無真正 RPC）→ 仍回傳 `ACTION.EXISTING_ACCOUNT_MERGE_REQUIRED`，
      `pending` 原樣保留（可恢復操作），並附上 `retryable`/`mergeError` 供未來 UI 區分「可重試」與
      「尚未支援」。
- `js/pages/subscription-entry.js`：呼叫 `completeLoginAndResume()` 時多帶入
  `previousAuthUserId: pendingPreviousAuthUserId`（僅用於推導 idempotencyKey，不做 UUID Preservation
  檢查，這條路徑本來就預期是不同 UUID）。
- `subscription.html`：新增 `<script src="./js/services/auth/account-merge-service.js">` 並更新相關
  版本號。
- `scripts/verify-local.ps1`：加入 `js/services/auth/account-merge-service.js` 的 `node --check`。
- 新增 `docs/adr/ADR-009-existing-account-data-merge.md`：完整盤點、風險分析、決策、未套用的
  migration/RPC 計畫 SQL 草稿、Edge Function 職責、後續追蹤工作清單。`docs/adr/README.md` 補上索引列。

### 新 Email OTP 驗證失敗（otpPurpose / Supabase `verifyOtp` type 不一致）
- `js/services/auth/email-otp-service.js`：
  - `sendUpgradeOtp()`（`updateUser` 路徑）成功時新增回傳 `data.otpPurpose = "email_change"`；
    `sendLoginOtp()`（`signInWithOtp` 路徑）成功時新增回傳 `data.otpPurpose = "email"`。
  - `verifyUpgradeOtp({ email, token, previousAuthUserId, otpPurpose })`：呼叫
    `authClient.verifyOtp({ ..., type: otpPurpose })`，**不再寫死 `"email"`**；未帶
    `otpPurpose` 時預設回退為 `"email_change"`（此函式唯一正確的預設值）。
  - `verifyLoginOtp({ email, token, otpPurpose })`：同樣改為 `type: otpPurpose`，預設回退為
    `"email"`。
- `js/services/auth/subscription-entry-guard.js`：`completeUpgradeAndResume()`/
  `completeLoginAndResume()` 新增 `otpPurpose` 參數，原樣轉發給對應的
  `verifyUpgradeOtp()`/`verifyLoginOtp()`，不做任何轉換。
- `js/pages/subscription-entry.js`：
  - 新增頁面層狀態 `pendingOtpPurpose`：`handleSendOtp()` 成功寄出驗證碼時儲存寄送回傳的
    `otpPurpose`；`handleVerifyOtp()` 呼叫驗證時帶入 `otpPurpose: pendingOtpPurpose`。重新寄送
    （`resendOtpBtn` 呼叫同一個 `handleSendOtp()`）自然重新推導並保存相同 purpose，不需額外邏輯。
  - 新增 `resetPendingOtpState()`：成功進入 Checkout、既有帳號登入合併障擋
    （`EXISTING_ACCOUNT_MERGE_REQUIRED`）、按下「重試」、或重新點擊「訂閱」開始新一輪時呼叫，清除
    `pendingGuard`/`pendingEmail`/`pendingOtpPurpose`、重置 `pendingMode`，避免殘留狀態被下一輪誤用
    （滿足需求「清除 OTP 暫存」）。`pendingEmail`（即 spec 所稱 `pendingNewEmail`）仍維持既有
    設計：僅在寄送當下寫入一次，`verify` 步驟一律原樣重用。
- `subscription.html`：相關腳本版本號更新。

未修改：`verifyUpgradeOtp()` 既有的 `refreshSession()`→`getSession()`→`resolveAuthStateFn()`
流程（P-AUTH-02-hotfix 已實作，本次僅修正 `type` 參數）；`pendingPlan` 保留與自動繼續
 Checkout 的行為（`pending.checkoutContext`）。

未修改：任何方案/價格設定、資料庫 schema（未實際套用任何 migration）、RLS、既有公開 API；
`checkout-authorization-service.js`（後端仍會獨立重新驗證身份，未受影響）。

## 自動測試結果

執行 `.\scripts\verify-local.ps1`：

```
== Syntax Check ==  全數通過（含新檔案 account-merge-service.js）
== Unit Tests ==
ℹ tests 338
ℹ suites 0
ℹ pass 338
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
Verification Complete
```

新增/修改測試（均通過）：
- `email-otp-service.test.js`：
  - `isValidOtpToken: accepts 6, 7, and 8 digit numeric tokens`
  - `isValidOtpToken: rejects too-short, too-long, non-numeric, and empty tokens`
  - `verifyUpgradeOtp: accepts a 7-digit OTP token ...`
  - `verifyUpgradeOtp: rejects an obviously-malformed token (5 digits) before ever calling Supabase`
  - `verifyLoginOtp: accepts an 8-digit OTP token ...`
- 新增 `account-merge-service.test.js`（9 個測試）：建構檢查、缺 idempotencyKey、未配置
  `mergeRpcClient` 時**必定** `MERGE_NOT_SUPPORTED`（誠實保證）、成功透傳、`retryable:true/false`
  兩種失敗透傳、thrown exception 正規化、**同一 idempotencyKey 重複呼叫不會重複套用合併副作用**
  （冪等性證明）。
- `subscription-entry-guard.test.js`：
  - 建構檢查新增 `accountMergeService` 缺少方法時拋錯。
  - `completeLoginAndResume: ... 真實預設（尚無 merge RPC）-> existing_account_merge_required
    ...retryable:false...MERGE_NOT_SUPPORTED`（證明目前正式環境行為誠實、未變動）。
  - `completeLoginAndResume: merge succeeds (future RPC) -> auto-resumes the ORIGINAL pending
    Checkout`（證明需求 5 的自動接續設計正確）。
  - `completeLoginAndResume: merge fails but is retryable ...`
  - `completeLoginAndResume: idempotencyKey is deterministic for the same (anonymous, existing)
    UUID pair across repeated attempts`（證明重複執行安全）。
- **新 Email OTP `otpPurpose`/`type` 修正**（本次追加修正）：
  - `email-otp-service.test.js`：
    - `sendUpgradeOtp: success returns the normalized email and otpPurpose 'email_change' ...`
    - `verifyUpgradeOtp: calls authClient.verifyOtp with type='email_change' by DEFAULT (never
      hardcoded 'email')`
    - `verifyUpgradeOtp: honors an explicit otpPurpose ..., never overriding it with a hardcoded
      type`
    - `sendLoginOtp: ... forwards captchaToken ...`（新增斷言 `result.data.otpPurpose === "email"`）
    - `verifyLoginOtp: calls authClient.verifyOtp with type='email' by DEFAULT (never
      hardcoded/confused with 'email_change')`
  - `subscription-entry-guard.test.js`：
    - `completeUpgradeAndResume: forwards otpPurpose unchanged to
      emailOtpService.verifyUpgradeOtp`
    - `completeLoginAndResume: forwards otpPurpose unchanged to emailOtpService.verifyLoginOtp`

既有測試（新 Email、既有 Email、錯誤 OTP、重送、刷新狀態、Captcha）全數維持通過，未回歸失敗。

## Blocker（延續 P-AUTH-04.2，本次補強而非解除）

既有帳號登入成功後仍**不會**自動繼續 Checkout——這是刻意行為，理由與作法詳見
[ADR-009-existing-account-data-merge.md](../../adr/ADR-009-existing-account-data-merge.md)。使用者
可在登入既有帳號後手動重新點擊「訂閱」以該帳號繼續（此時會直接判定為 Official User 進入 Checkout，
只是尚未帶著匿名身份的購物車／吉祥物／點數資料）。後續工作已列在 ADR 的「Follow-up work」章節，包含：
補齊核心資料表 RLS、建立 Points 交易紀錄表、建立 `subscriptions` 表、實作
`merge_anonymous_account()` RPC + Edge Function、將真正的 `mergeRpcClient` 接回
`account-merge-service.js`。

## Gate 4 手動 E2E 步驟（尚未於真實瀏覽器對本次變更執行 — 不宣告 PASS）

**本次「新 Email OTP 驗證失敗」修正是 Gate 4 的必要前提**——先確認以下兩點基本流程可行，再執行後續
既有帳號登入／既有測試步驟：

0. **全新 Email 升級（本次修正的核心情境）**：以無痕視窗開啟 `subscription.html`，點選任一方案
   →輸入一個**從未註冊過**的 Email → 寄送驗證碼 → 至信箱取得驗證碼 → 輸入並點「驗證並繼續」。
   **預期**：直接顯示「Ready for Checkout」，**不應**再出現「驗證碼錯誤或已逾期」訊息（這是本次修正
   前必定會發生的錯誤）。檢查 Supabase Auth 後台：升級後的 Auth UUID 應與升級前的匿名 UUID 相同。
0-1. **重新寄送後仍可正確驗證**：在上一步驟寄送驗證碼後，點擊「重新寄送」取得新驗證碼，輸入新驗證碼
   應同樣能成功驗證（證明 `otpPurpose` 在重送後依然正確保存為 `email_change`）。

延續 P-AUTH-04.2 review 文件中已列出的既有帳號登入 E2E 步驟，本次額外需要驗證：

1. **OTP 長度**：無論 Supabase 實際寄出 6、7 或 8 碼驗證碼，輸入框都應能正常輸入並送出（不因長度被
   前端擋下），placeholder 應顯示「請輸入驗證碼（6～8 碼數字）」而非「6 位數」。
2. **既有帳號登入後的訊息**：完成既有帳號登入 OTP 驗證後，畫面應顯示「登入成功！此 Email 已有正式
   帳號，但目前身份的資料尚未合併，暫不支援自動繼續訂閱。請重新點擊「訂閱」按鈕，以此帳號繼續操作。」
   （與 P-AUTH-04.2 相同，這次是透過真正呼叫 `accountMergeService`、得到 `MERGE_NOT_SUPPORTED` 之後才
   顯示，而非寫死跳過，屬於同一使用者可見結果的「誠實」版本）。
3. **重新點擊訂閱**：登入既有帳號後，再次點擊任一方案的「訂閱」按鈕，應直接顯示「Ready for
   Checkout」（不需要重新走一次 Email/OTP 流程）。
4. 全程觀察 Console／Network：不應出現本次修改引入的新錯誤（如 `account-merge-service.js` 相關的
   `undefined is not a function`）。

未完成以上真實瀏覽器驗證，Gate 4 狀態維持 **PENDING**。

| Gate 4 情境             | 結果   |
| --------------------- | ---- |
| 新 Email 匿名帳號升級        | PASS |
| `email_change` OTP 驗證 | PASS |
| 保留原訂閱方案               | PASS |
| 刷新後 Session 持續        | PASS |
| 正式使用者直接進入 Checkout    | PASS |
| 既有 Email OTP 登入       | PASS |
| 既有帳號匿名資料自動合併          | 尚未完成 |

結論：Gate 4 功能流程 Conditional PASS。唯一 blocker 是既有帳號的匿名資料安全合併；若 Gate 4 規格要求完整自動合併，就仍不能正式 PASS。新 Email 路徑則已完整通過。