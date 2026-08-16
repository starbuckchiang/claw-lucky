先只讀：
#file docs/working-prompts/prompts-auth-04.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。

完成後輸出修改檔案與測試結果至docs/0-review/review-auth/review-auth-04.md。

# prompts-auth-04.md

# P-AUTH-04 Checkout Authorization

## Objective

請依據 **003-spec-auth-subscription.md** 實作 `subscription-checkout` Edge Function 的授權與防呆。

除本 Prompt 外，其餘流程、權限與驗收皆以 `003-spec-auth-subscription.md` 為唯一依據。

---

## Reference

- 003-spec-auth-subscription.md

---

## Scope

僅實作 Checkout Authorization：

- 驗證 JWT
- 驗證 `isOfficialUser()`
- 驗證 Identity 已完成
- 已訂閱者不得重複建立 Checkout
- 通過驗證才建立 Checkout Session
- 統一錯誤碼與 HTTP Status

本階段**不實作**：

- Payment
- Webhook
- Subscription 啟用
- UI 修改
- Account Merge

---

## Deliverables

- `subscription-checkout` Edge Function
- Authorization Middleware
- Error Normalization
- 單元測試與文件

---

## Acceptance

- 無 JWT → 401
- 非 Official User → 403
- Identity 未驗證 → 403
- 已訂閱 → 回傳既有訂閱
- 合法使用者 → 建立 Checkout
- 全部測試通過

---

## Constraints

沿用 P-AUTH-01～03 Service，不重複實作 Auth 邏輯；不修改 Database Schema；完成後輸出修改檔案、測試結果及待 P-AUTH-05 處理事項。