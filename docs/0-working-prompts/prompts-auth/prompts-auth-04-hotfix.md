先只讀：
#file docs/working-prompts/prompts-auth-04-hotfix.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。

完成後輸出修改檔案與測試結果至docs/0-review/review-auth/review-auth-04-hotfix.md。

# P-AUTH-04 Wiring Hotfix

修正 subscription.html 前端載入失敗。

目前 Console：

- Identifier 'resolveAuthState' has already been declared
- Cannot read properties of undefined (reading 'createEmailOtpService')

請檢查：

- js/services/auth/email-otp-service.js
- 所有 import / export
- resolveAuthState 是否重複宣告
- createEmailOtpService 是否因 SyntaxError 導致 module 未載入

要求：

- 不修改商業流程。
- 不修改 Checkout Authorization。
- 不修改 Database。
- 修正重複宣告與 module wiring。
- 完成後提供修改檔案及 verify-local 結果。