先只讀：
#file docs/working-prompts/prompts-auth-05A.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。

執行 P-AUTH-05A：Existing Account Merge Security Foundation。依 ADR-009 盤點實際 schema、FK、unique constraints、RLS 與所有前端 user_id 寫入點；禁止直接實作不安全的前端跨 UID 合併。

完成後輸出修改檔案與測試結果至docs/0-review/review-auth/review-auth-05A.md。

要求：

1. 為 users、user_mascots、redeem_history、shop_cart、orders/order_items 建立以 auth.uid() 為準的 RLS；不再信任 localStorage 或 client-supplied owner ID。
2. 先處理舊字串 ID 與 Auth UUID 相容性，migration 必須可回滾，不得破壞既有資料。
3. 建立 point_transactions ledger，禁止直接用前端讀值後加總更新點數。
4. 建立 account_merge_claims：只存 claim token hash、anonymous_user_id、target email hash、expires_at、used_at、狀態與 audit 欄位；原始 token 不落庫。
5. 明確定義各表合併規則：購物車去重、吉祥物衝突、兌換紀錄保留、點數 ledger、訂單不可重複或任意改歸屬；有疑義先列 blocker。
6. 所有 SECURITY DEFINER function 固定 search_path、最小權限並撤銷 public execute；此階段不得加入 service-role key 到前端。
7. 補齊 RLS owner/跨帳號拒絕、migration、rollback及權限測試，執行 verify-local.ps1。
8. 產出 review-auth-05A.md，列出實際 SQL、風險、測試證據與 P-AUTH-05B 的 begin/finalize merge 契約。本階段不得宣告資料合併完成或 Gate 4 PASS。
