# P-AUTH-02 Hotfix — Review

## 修改哪些
- 修改 `js/services/auth/email-otp-service.js`：僅改 `verifyUpgradeOtp()`。UUID Preservation 檢查通過
  後，新增 `refreshSession()` → `getSession()` 兩步，改用重新讀取的最新 session/user 呼叫
  `resolveAuthState()`。`createEmailOtpService()` 的依賴檢查同步要求 `authClient.refreshSession`/
  `authClient.getSession`。回傳 API 形狀（`{ ok, data: { authUserId, authState } }`）不變。
- 修改 `js/services/auth/__tests__/email-otp-service.test.js`：mock `authClient` 加入
  `refreshSession`/`getSession`；新增 3 個測試（refresh 後即使 `verifyOtp()` 本身回傳仍為
  `is_anonymous:true`，最終 Authentication State 仍為 `is_anonymous:false`／`official`；
  `refreshSession()`/`getSession()` 失敗皆正規化為 `OTP_VERIFY_FAILED`），並擴充建構子依賴檢查測試。

## 為什麼
E2E 驗證發現升級完成當下，瀏覽器 Session 仍持有舊 JWT（`is_anonymous` 尚未反映為 `false`），需手動
`refreshSession()` 才能取得最新狀態。依 Hotfix 指示於 `verifyOtp()` 之後、UUID 檢查之後插入
`refreshSession()` + `getSession()`，確保回傳的 `authState` 一律來自升級後最新的 Session/JWT，而非
`verifyOtp()` 當下可能過期的資料。

## 驗收結果
- `.\scripts\verify-local.ps1`：Syntax Check 全過；Unit Tests 270/270 通過（原 267 + 新增 3），0 失敗。
- 新增測試證實：refresh 後 `authState.isAnonymous === false`、`userType === "official"`，即使
  `verifyOtp()` 本身回傳仍顯示匿名；`refreshSession`/`getSession` 失敗皆被正規化，不外洩原始錯誤。

## 未完成事項
- 未修改 UI、商業流程與 Database（符合 Hotfix 限制）。
- 前端尚未串接（`js/user.js`/實際頁面呼叫）仍延後至後續階段，與 P-AUTH-02 review 一致。
