先只讀：
#file docs/working-prompts/prompts-auth-02-hotfix.md

1.依照 copilot-instructions.md 執行。
不要掃描整個 Repository。
除非測試或 import dependency 明確需要，禁止掃描其他目錄。先回報預計修改檔案，不要立即修改。
2.做完請將工作存檔至docs/0-review/review-auth/review-auth-02-hotfix.md

# P-AUTH-02 Hotfix

依據本次 E2E 驗證結果，完成 Email Upgrade 後，Browser Session 仍保留舊 JWT，需手動 refreshSession() 才能取得最新 Authentication State。

請修改：

js/services/auth/email-otp-service.js

僅修改 verifyUpgradeOtp()。

流程改為：

1. verifyOtp()
2. UUID Preservation Check
3. refreshSession()
4. getSession()
5. resolveAuthState()
6. 回傳最新 Authentication State

要求：

- 不修改 UI。
- 不修改商業流程。
- 不修改 Database。
- 保持既有 API 不變。
- 補充單元測試，驗證 refresh 後回傳 is_anonymous=false。