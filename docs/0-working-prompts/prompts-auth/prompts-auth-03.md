先只讀：
#file docs/working-prompts/prompts-auth-03.md

1.依照 copilot-instructions.md 執行。
不要掃描整個 Repository。
除非測試或 import dependency 明確需要，禁止掃描其他目錄。先回報預計修改檔案，不要立即修改。
2.做完請將工作存檔至docs/0-review/review-auth/review-auth-03.md

# prompts-auth-03.md

# P-AUTH-03 Subscription Entry Guard

## Objective

請依據 **003-spec-auth-subscription.md** 實作「Subscription Entry Guard」。

除本 Prompt 外，其餘流程、權限與驗收皆以 `003-spec-auth-subscription.md` 為唯一依據。

---

## Reference

- 003-spec-auth-subscription.md

---

## Scope

僅實作訂閱入口流程：

- 點擊「訂閱」
- 呼叫 `isOfficialUser()`
- Official User → 進入 Checkout
- Anonymous User → 啟動 Email OTP Upgrade
- Upgrade 成功後自動返回原訂閱流程
- 保留目前頁面與操作狀態

本階段**不實作**：

- Payment
- Webhook
- Subscription 啟用
- Account Merge

---

## Deliverables

- Subscription Entry Guard
- Return-to-Checkout Flow
- 必要測試與文件

---

## Acceptance

- Official User 可直接進入 Checkout
- Anonymous User 完成 Upgrade 後自動繼續 Checkout
- 不重整頁面
- 不影響既有功能
- 全部測試通過

---

## Constraints

- 沿用 P-AUTH-01、P-AUTH-02 Service。
- 不修改 Database Schema。
- 不新增商業流程。
- 完成後輸出修改檔案、測試結果及待 P-AUTH-04 處理事項。