請執行 P2-AI-03 Supabase Deployment Gate A：
部署 daily_lucky_context Prompt Registry migration。

本次只允許：
- Supabase 唯讀查詢
- supabase migration list
- supabase db push --dry-run
- 條件全部通過後執行一次 supabase db push
- 部署後唯讀驗證

禁止：
- functions deploy
- 修改程式碼
- commit 或 push
- 修改其他資料
- 刪除或停用 prompt row
- 顯示完整 prompt、API Key 或 secrets

預期 Git commit：
c411784

預期唯一 migration：
20260727000000_seed_daily_lucky_context_prompt.sql

一、部署前確認

1. 確認：
   git rev-parse HEAD
   git rev-parse origin/main

兩者都必須是 c411784。

2. 唯讀查詢遠端 prompt_versions：
   WHERE prompt_type = 'daily_lucky_context'

預期結果必須是 0 rows。

只回報：
- row count
- version
- is_active
- schema 欄位存在性

不得輸出完整 template。

3. 執行：
   supabase migration list
   supabase db push --dry-run

dry-run 必須顯示只有：
20260727000000_seed_daily_lucky_context_prompt.sql

若出現其他 pending migration、遠端已出現 prompt row、
Git commit 不一致或查詢失敗，立即停止，不要 db push。

二、執行 Migration

所有條件符合後，執行一次：

supabase db push

不要加入 --include-all，不要使用其他參數。

三、部署後驗證

1. 再執行 supabase migration list，確認：
   20260727000000 在 local 與 remote 都存在。

2. 唯讀查詢 prompt_versions，確認：
   - prompt_type = daily_lucky_context
   - 剛好 1 row
   - is_active = true
   - version = shopkeeper-context-v1
   - template 包含：
     luckyTheme
     blessing
     story
     oneLiner
     shopkeeperMessage
     version
   - 不包含：
     lucky_theme
     one_liner

3. 不輸出完整 template，只輸出各項 Boolean 結果。

4. 再執行：
   supabase db push --dry-run

預期結果為沒有 migration 需要套用。

四、異常處理

若 db push 後驗證失敗：
- 不要自行執行 UPDATE、DELETE 或 rollback
- 不要部署 Edge Function
- 保留所有現況並回報實際結果

最後輸出：
- Git commit 驗證
- 部署前 row count
- dry-run migration 清單
- db push 結果
- 遠端 migration 狀態
- active prompt row count
- Schema Boolean 驗證
- Gate A：PASS / FAIL
- 是否可進入 Gate B：Edge Function Deployment

完成後停止。
不要執行 functions deploy。
將report存檔至review/P2-AI-03-SupabaseDeployment-GateA.md