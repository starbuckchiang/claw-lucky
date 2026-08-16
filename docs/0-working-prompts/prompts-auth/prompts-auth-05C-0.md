立即停止所有 migration、deploy、資料刪除及 rollback。

執行 P-AUTH-05C.0 Deployment Scope Audit，只能唯讀檢查。

背景：
project ref `umtqpstacjdwxcvcirbl` 在 Supabase Dashboard 曾顯示
`main — PRODUCTION`，但 review-auth-05C-wallet-ops-cors-hotfix.md
將它稱為 staging，並已執行 db push、14 個 migrations及 wallet-ops deploy。

要求：

1. 唯讀確認環境身份
- 顯示目前 linked project ref。
- 顯示 Supabase organization/project name。
- 確認 Dashboard branch/environment 標籤。
- 確認是否為 main / PRODUCTION。
- 不得只因文件寫 staging 就判定是 staging。
- 不得切換、link 或建立 project。

2. 唯讀盤點已發生變更
- 列出本次開始前與開始後的 migration versions。
- 列出實際套用的 migrations。
- 列出已部署 wallet-ops 的版本與時間。
- 列出被 ALTER/CREATE/REPLACE 的 table、function、constraint及policy。
- 檢查 migration 是否造成資料 backfill或既有資料變更。
- 不得顯示 secret。

3. 風險檢查
唯讀確認：
- users、wallet balances、gacha_draw_requests、
  gift_redemption_requests、redeem_history、user_mascots資料量。
- 是否有 migration failure留下不完整 schema。
- wallet-ops目前是否可被正常驗證JWT的使用者呼叫。
- 是否存在未驗證或公開寫入路徑。
- 不得新增或刪除測試資料。

4. 不得自動 rollback
任何 DROP、DELETE、migration repair、function delete、
schema restore或重新部署都必須先提出：
- 精確影響
- 是否會遺失資料
- rollback SQL
- forward-fix替代方案
等待人工批准後才能執行。

5. 修正報告措辭
若確認 `umtqpstacjdwxcvcirbl` 是 main/PRODUCTION：
- 明確判定先前「staging deployment」敘述錯誤。
- 05C不得判定PASS。
- 將事件列為 deployment scope violation。
- 不得用「明確授權」描述 production deployment，因原指令只授權 staging。

6. 另行記錄但先不要修正
- claim_gacha_draw與redeem_gift_transaction仍有並行
  idempotency race。
- 僅提出05B-2A.2 hotfix方案，不得在本稽核中套用或部署。

輸出：
review-auth-05C.0-deployment-scope-audit.md

Gate只能為：
- SAFE_TO_PLAN_FORWARD_FIX
- PRODUCTION_SCOPE_VIOLATION
- BLOCKED

完成後停止，不得deploy、db push、rollback或刪除資料。