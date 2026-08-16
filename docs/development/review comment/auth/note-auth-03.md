| 驗收項目                            | 結果   | 說明                                                                          |
| ------------------------------- | ---- | --------------------------------------------------------------------------- |
| ✅ Subscription Entry Guard      | PASS | 已新增 `js/services/auth/subscription-entry-guard.js`。                         |
| ✅ Official User → Checkout      | PASS | `isOfficialUser()` 判定為 Official 時回傳 `enter_checkout`。                       |
| ✅ Anonymous → Email OTP Upgrade | PASS | 非 Official 時導向 `start_email_otp_upgrade`。                                   |
| ✅ Upgrade 後自動回到 Checkout        | PASS | `completeUpgradeAndResume()` 成功後回傳 `enter_checkout`，並保留原 `checkoutContext`。 |
| ✅ 保留原操作狀態                       | PASS | `checkoutContext` 透過 `pending` 保存，完成 Upgrade 後恢復。                           |
| ✅ 不重整頁面                         | PASS | 模組不操作 DOM、不導頁，只回傳下一步 action。                                                |
| ✅ 不修改 Database                  | PASS | 未修改 Database Schema。                                                        |
| ✅ 不實作 Payment / Webhook         | PASS | 保留至 P-AUTH-04。                                                              |
| ✅ 單元測試                          | PASS | 新增 8 個測試，共 278/278 全數通過。                                                    |
目前 Auth 流程已完成三個核心階段：

Visitor
    ↓
Anonymous
    ↓
Email Upgrade
    ↓
Official User
    ↓
Subscription Entry Guard
    ↓
Ready for Checkout

## 建議補做一個 E2E（非 Gate 必要，但開始 Gate 4 前很有價值）

目前通過的是服務層與單元測試，Review 也明確指出：

尚未串接前端（訂閱按鈕、OTP UI）。

建議在開始 P-AUTH-04 前，做一次完整手動流程：

匿名使用者點「訂閱」。
自動進入 Email Upgrade。
完成 Email 驗證。
自動回到原本的 Checkout（不用重新點訂閱）。
確認 checkoutContext（例如方案、價格、來源頁）沒有遺失。