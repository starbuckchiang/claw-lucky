先只讀：
#file docs/working-prompts/prompts-auth-05B-1.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。

執行 P-AUTH-05B-1：Account Merge Begin/Finalize Implementation，嚴格遵循 review-auth-05A.1-hotfix.md 契約。

1. 實作 account-merge Edge Function 的 begin/finalize；只接受明確 schema。Finalize body 只能含 claimToken，拒絕或忽略 anonymousUserId、existingUserId、email、emailHash、idempotencyKey。
2. Begin 從 JWT 取得匿名使用者，確認 is_anonymous=true；正規化目標 Email、產生高熵 claimToken並只儲存 hash。token 不得寫入 DB/log。
3. 在匿名 updateUser 回傳 Email 已存在後、signInWithOtp 前呼叫 Begin；將 claimToken 僅保存在當頁記憶體狀態，禁止 localStorage/sessionStorage。
4. OTP 登入正式帳號後，以新 Session 呼叫 Finalize；由 Session 取得正式 UID及已驗證 Email，呼叫三參數 finalize_account_merge RPC。
5. 移除前端 accountMergeService 對 idempotencyKey 的必要依賴，改以 claimToken 完成合併；不得把任何 service-role key放入前端。
6. 成功後清除 claim/OTP 暫存並自動接續原 pendingPlan Checkout；失敗保留可安全重試狀態，錯誤訊息不得洩漏 claim、Email是否存在或內部 SQL。
7. 加入 token過期、錯誤Email、重送、重複點擊、Session切換、網路失敗、Finalize成功及失敗回滾測試。
8. 此階段僅實作與測試，不部署 Production、不套用 RLS migration。執行 verify-local.ps1並產出 review-auth-05B-1.md，列出05C前仍缺的安全寫入API與真實PostgreSQL測試。
