先只讀：
#file docs/working-prompts/prompts-auth-03-hotfix.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。

完成後輸出修改檔案與測試結果至docs/0-review/review-auth/review-auth-03-hotfix.md。

# P-AUTH-03.1 Spec Alignment Hotfix

依據 `003-spec-auth-subscription.md` 修正 Official User 判定。

Spec 原文字將 Email 與 Google 誤寫為同時必要；正確規則為至少一種可再次登入的永久 Identity 已驗證，即 Email OR Google OR其他支援身分。

請修改 `auth-service.js`：

- Email 已驗證且 `is_anonymous=false` 可判定為 Official。
- Google identity 已驗證也可判定為 Official。
- 不要求 Email 與 Google 同時存在。
- 保留 Session、JWT、Active Status 等既有條件。
- 更新相關單元測試。
- 不修改 UI、Database 或 Checkout 流程。

