請執行 P2-AI-03 Supabase Deployment Gate B：
設定 Shopkeeper runtime configuration，並部署 wallpaper-generate。

本次允許：
- 唯讀部署前檢查
- 設定指定的 SHOPKEEPER_* secrets
- 條件通過後執行一次 wallpaper-generate Function deployment
- 部署後唯讀驗證

禁止：
- db push
- 修改程式碼
- commit 或 git push
- 修改 GEMINI_API_KEY
- force deploy 其他 Function
- 執行真實桌布生成
- 修改資料庫資料

目標 Git commit：
c41178443b05c1e2a6701da3f2591ac3808e8184

部署前遠端 Function：
wallpaper-generate version 26

一、Git 與資料庫確認

1. 確認：
   git rev-parse HEAD
   git rev-parse origin/main

兩者必須等於目標 commit。

2. 確認：
   supabase db push --dry-run

必須顯示 Remote database is up to date。

3. 唯讀確認 daily_lucky_context：
   - row count = 1
   - is_active = true
   - version = shopkeeper-context-v1

不得輸出完整 template。

二、確認 JWT 部署模式

搜尋 Git history、文件、部署紀錄與 scripts，確認
wallpaper-generate 過去的部署方式是否使用：

--no-verify-jwt

同時檢查：
- 前端 wallpaper-generation-client 如何傳送 Authorization
- Edge Function index.ts／handler 如何驗證使用者
- 現有架構是否依賴 Supabase Gateway JWT verification

判定：
1. 若證據明確要求預設 JWT verification：
   部署時不得加入 --no-verify-jwt。
2. 若證據明確要求 Function 自行驗證且過去使用
   --no-verify-jwt：
   才能沿用 --no-verify-jwt。
3. 若無法明確判定：
   立即停止，不要設定 secrets、不要 deploy。

不得自行猜測驗證模式。

三、設定 Runtime Configuration

先執行 supabase secrets list，只回報名稱是否存在，
不得輸出任何 secret value。

保持現有 GEMINI_API_KEY 不變，設定：

SHOPKEEPER_MODEL=gemini-2.5-flash
SHOPKEEPER_TIMEOUT_MS=20000
SHOPKEEPER_MAX_RETRY=0

使用 Supabase secrets 命令設定以上三項。
不得重新設定或顯示 GEMINI_API_KEY。

設定後再次執行 supabase secrets list，僅確認四個名稱存在：

- GEMINI_API_KEY
- SHOPKEEPER_MODEL
- SHOPKEEPER_TIMEOUT_MS
- SHOPKEEPER_MAX_RETRY

若任一設定失敗，停止，不要 deploy。

四、部署 Function

部署前再次執行：

supabase functions list

確認 wallpaper-generate 仍為 version 26，且沒有其他部署正在進行。

依第二節確認的 JWT 模式，只部署：

wallpaper-generate

不得部署 wallpaper-status 或其他 Function。

部署完成後記錄 CLI 完整成功／失敗狀態，但不得顯示 secrets。

五、部署後唯讀驗證

1. 再執行：
   supabase functions list

2. 確認：
   - wallpaper-generate status = ACTIVE
   - version 高於 26
   - updated_at 晚於部署前時間
   - wallpaper-status 版本沒有變化

3. 再確認：
   - migration 無 pending
   - daily_lucky_context 仍剛好 1 筆 active row
   - Git 工作區原有未提交檔案保持原狀

4. 本 Gate 不執行真實生成請求。
   真實 Gemini、Snapshot 與 UI 流程留到 Gate C。

六、異常處理

若部署失敗或 Function 未變為 ACTIVE：
- 不要自動重試超過一次
- 不要修改程式碼
- 不要 rollback、delete 或重新部署其他版本
- 保留現況並回報錯誤

最後輸出：
- Git commit 驗證
- JWT deployment mode 與判斷證據
- Runtime configuration 名稱存在性
- 部署前 Function version
- Deployment command（遮蔽敏感資訊）
- 部署結果
- 部署後 Function version/status/updated_at
- wallpaper-status 是否未改變
- Gate B：PASS / FAIL
- 是否可進入 Gate C：Post-deployment Verification

完成後停止。
不要執行真實生成。
將report存檔至review/P2-AI-03-11-SupabaseDeployment-GateB.md