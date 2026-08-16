先只讀：
#file docs/working-prompts/prompts-auth-02.md

1.依照 copilot-instructions.md 執行。
不要掃描整個 Repository。
除非測試或 import dependency 明確需要，禁止掃描其他目錄。先回報預計修改檔案，不要立即修改。
2.做完請將工作存檔至docs/0-review/review-auth/review-auth-02.md


# P-AUTH-02 Email OTP Upgrade

## Objective

請依據 **003-spec-auth-subscription.md** 實作「Anonymous User 升級為 Official User（Email OTP）」。

**除本 Prompt 特別說明外，其餘流程、狀態、驗證規則及驗收標準皆以 `003-spec-auth-subscription.md` 為唯一依據，不要重新設計流程。**

---

## Reference

- 003-spec-auth-subscription.md

---

## Scope

本階段僅完成 Email OTP Upgrade。

包含：

- 建立 Email OTP 流程
- 支援寄送與驗證 OTP
- Anonymous User 升級為 Official User
- 保留原 Auth UUID
- 完成升級後回傳最新 Authentication State
- 與 P-AUTH-01 Auth Service 整合

本階段**不實作**：

- Subscription Checkout
- Payment
- Webhook
- Account Merge
- UI 美化

---

## Deliverables

完成：

- Email OTP Service（沿用既有架構）
- Upgrade Flow
- UUID 保留驗證
- 必要文件與註解
- 單元測試

---

## Acceptance

需通過：

1. Anonymous User 可成功升級
2. Auth UUID 全程保持一致
3. Authentication State 正確更新
4. Official User 判定正確
5. 全部測試通過
6. 不影響既有功能

---

## Constraints

- 優先使用 Supabase 官方 Anonymous Upgrade 機制。
- 不建立新的 Auth User。
- 不修改 Database Schema。
- 不新增商業流程。
- 完成後請輸出：
  - 修改檔案清單
  - 測試結果
  - 已知限制
  - 待 P-AUTH-03 處理事項（不實作）。