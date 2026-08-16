
先只讀：
#file docs/working-prompts/prompts-auth-03-UI-integration.md

1.依照 copilot-instructions.md 執行。
不要掃描整個 Repository。
除非測試或 import dependency 明確需要，禁止掃描其他目錄。先回報預計修改檔案，不要立即修改。
2.做完請將工作存檔至docs/0-review/review-auth/review-auth-03-UI-integration.md


# P-AUTH-03.1 Subscription Entry UI Integration

## Objective

請依據 `003-spec-auth-subscription.md`，將 P-AUTH-01～03 的 Auth Service 串接至實際訂閱入口 UI。

## Scope

- 新增或沿用「訂閱」按鈕
- 點擊後呼叫 `SubscriptionEntryGuard`
- Anonymous/Visitor 顯示 Email 與 OTP 輸入介面
- 呼叫 `startUpgrade()`、`completeUpgradeAndResume()`
- Upgrade 成功後恢復原 `checkoutContext`
- 暫以「Ready for Checkout」狀態取代真實付款
- 顯示可理解的錯誤與重試操作

不實作 Payment、Webhook、Edge Function 或 Account Merge。

## Acceptance

- Official User 點訂閱後直接顯示 Ready for Checkout
- Anonymous User 可完成 Email 驗證並自動回到原訂閱流程
- UUID 保持不變
- 頁面不重新整理
- 原方案與操作狀態不遺失
- 全部測試通過

## Constraints

沿用既有 Service，不複製 Auth 邏輯；不修改 Database Schema。完成後輸出修改檔案、測試結果及手動 E2E 步驟。

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

完成後輸出修改檔案與測試結果。