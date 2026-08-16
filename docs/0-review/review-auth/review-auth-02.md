# P-AUTH-02 Email OTP Upgrade — Review

## 修改哪些
- 新增 `js/services/auth/email-otp-service.js`：Email OTP Service（factory + DI 模式，沿用
  `js/services/wallpaper/*-service.js` 慣例）。透過注入的 `authClient` 呼叫 Supabase 官方 Anonymous
  Upgrade 機制（`updateUser({ email })` 寄送 OTP、`verifyOtp({ email, token, type: 'email' })` 驗證並
  完成升級），提供 `createEmailOtpService({ authClient })` → `sendUpgradeOtp()` /
  `verifyUpgradeOtp()`，並匯出獨立可測試的 `isUuidPreserved()`。
- 新增 `js/services/auth/__tests__/email-otp-service.test.js`：12 個單元測試，涵蓋寄送成功/失敗、
  驗證成功（UUID 保留＋Official Authentication State）、UUID 不一致拒絕、缺 token/無效 email、
  Supabase 錯誤與例外正規化。
- 修改 `scripts/verify-local.ps1`：加入新檔案的 `node --check`（測試 glob 已涵蓋
  `js/services/auth/__tests__/*.test.js`，無需再改）。
- 未修改任何 HTML/UI、`js/user.js`、`js/api.js`（前端實際串接留待後續階段）。

## 為什麼
依 003-spec-auth-subscription.md 第 4-6 節，Anonymous User 升級為 Official User 須使用 Supabase 官方
Anonymous Upgrade 機制（在既有匿名 session 上呼叫 `updateUser`/`verifyOtp`），不得建立新 Auth User。
`verifyUpgradeOtp()` 內建 UUID Preservation 檢查（`previousAuthUserId` 與升級後 `user.id` 不一致時回傳
`AUTH_UUID_MISMATCH`），並直接呼叫 P-AUTH-01 的 `resolveAuthState()` 產生最新 Authentication State，
滿足「與 P-AUTH-01 Auth Service 整合」與「完成升級後回傳最新 Authentication State」的交付項。

## 驗收結果
- `.\scripts\verify-local.ps1`：Syntax Check 全過；Unit Tests 267/267 通過（原 255 + 新增 12），0 失敗。
- Anonymous 升級成功、UUID 全程一致、Authentication State 正確更新為 Official、UUID 不一致情境被拒絕，
  皆有對應測試並通過；未破壞既有測試。

## 已知限制
- Section 6「Visitor Assets」（吉祥物/禮物/點數/購物車等）未另寫遷移邏輯：因升級全程沿用同一 Auth
  UUID，既有資料本就掛在同一 `user_id` 下，理論上自動保留；本階段未針對此點新增專屬測試（需要真實
  Supabase 整合測試才能驗證，超出本階段「不掃描整個 Repository / 不新增商業流程」範圍）。
- `isOfficialUser()`（P-AUTH-01）的 Status=Active 仍為恆真（`users` table 無 status 欄位），本階段未變動。

## 待 P-AUTH-03 處理事項（不實作）
- Subscription Checkout / Payment / Webhook。
- Existing Account Login 的 Account Merge（Spec 第 7 節：Cart / Mascot / Gift / Points / Subscription
  合併規則）。
- 前端串接（Email OTP 輸入 UI、`js/user.js`/HTML 實際呼叫 `EmailOtpService`）。
