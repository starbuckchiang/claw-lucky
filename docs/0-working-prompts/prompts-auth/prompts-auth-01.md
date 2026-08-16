請開始 auth-01

先只讀：
#file docs/working-prompts/prompts-auth-01.md

1.依照 copilot-instructions.md 執行。
2.不要掃描整個 Repository。
3.除非測試或 import dependency 明確需要，禁止掃描其他目錄。
4.先回報預計修改檔案，不要立即修改。
5.做完請將工作存檔至review-auth/review-auth-01.md
  控制內容200~500 字
  只寫：
    -修改哪些
    -為什麼
    -驗收結果
    -未完成事項
    -不要寫一大堆log

# prompts-auth-01.md

# P-AUTH-01 Authentication Foundation

## Objective

請依據 **003-spec-auth-subscription.md** 實作「Authentication Foundation」。

**除本 Prompt 特別說明外，其餘需求、流程、狀態定義、驗收標準均以 `003-spec-auth-subscription.md` 為唯一依據，不要重新設計流程。**

---

## Reference

- 003-spec-auth-subscription.md

---

## Scope

本階段僅完成 Authentication Foundation。

包含：

- 建立統一 Auth Service（若已存在則擴充）
- 實作 `isOfficialUser()`
- 建立 Authentication State 管理
- 提供統一 API 供前端呼叫
- 不修改 UI
- 不實作 Email OTP
- 不實作 Checkout
- 不修改 Webhook

---

## Deliverables

完成：

- Authentication Service
- Authentication State
- `isOfficialUser()`
- 必要型別、文件與註解
- 單元測試

---

## Acceptance

需通過：

1. Visitor 判定正確
2. Anonymous User 判定正確
3. Official User 判定正確
4. 無破壞既有功能
5. 全部測試通過

---

## Constraints

- 優先沿用既有架構，不新增重複 Service。
- 不修改資料庫 Schema。
- 不新增商業邏輯。
- 若發現與 Spec 不一致，以 `003-spec-auth-subscription.md` 為準。
- 完成後請輸出：
  - 修改檔案清單
  - 測試結果
  - 待下一階段處理事項（不實作）。