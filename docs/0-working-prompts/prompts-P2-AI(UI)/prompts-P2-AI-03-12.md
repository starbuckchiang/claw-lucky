請執行 P2-AI-03 Gate C：Post-deployment Verification。

本次允許：
- 使用 Playwright MCP 操作 localhost:5500
- 使用目前已登入的 Supabase 使用者 Session
- 執行最多一次真實桌布生成
- 唯讀查詢此次生成紀錄與 Function logs
- 產出驗收報告

禁止：
- 建立或修改帳號
- 繞過 Cloudflare Turnstile
- 使用 service_role 冒充使用者
- 修改資料庫資料
- 修改 secrets
- db push 或 functions deploy
- 修改程式碼
- commit 或 push
- 在失敗後自動重試生成
- 輸出 JWT、API Key、完整 Prompt 或個人資料

一、部署狀態確認

唯讀確認：

1. wallpaper-generate：
   - status = ACTIVE
   - version = 28
   - verify_jwt = true

2. wallpaper-status 沒有被重新部署。

3. daily_lucky_context：
   - 剛好 1 筆 active row
   - version = shopkeeper-context-v1

4. GEMINI_API_KEY 與三個 SHOPKEEPER_* secret 名稱存在。
   不得輸出 value。

若任何條件不符合，立即停止。

二、瀏覽器與登入準備

1. 確認 localhost:5500 已啟動。
2. 使用 Playwright MCP 開啟：
   http://localhost:5500/wallpaper.html
3. 檢查目前瀏覽器是否已有有效 Supabase Session。
4. 不得輸出 access token、refresh token 或完整 user UUID。

若尚未登入或遇到 Turnstile：

- 立即停止自動操作
- 回報 NEED MANUAL LOGIN
- 請使用者在同一個 Playwright 瀏覽器視窗手動完成登入
- 不得嘗試繞過 Turnstile
- 不得建立新測試帳號

完成手動登入後才能繼續。

三、測試資料確認

透過 UI 確認目前使用者至少擁有：

- 1 個可選吉祥物
- 1 個已兌換 Gift

不得新增、兌換或修改測試資料。

若任一項不存在，停止並回報：
BLOCKED：缺少測試資料。

記錄測試開始時間，僅記錄吉祥物與 Gift 的顯示名稱，
不得輸出內部 user ID。

四、執行一次真實生成

1. 選擇現有吉祥物與 Gift。
2. 選擇一個有效桌布風格。
3. 依正常 UI 流程送出。
4. 只允許送出一次。
5. 記錄：
   - Request HTTP status
   - correlationId（可回報）
   - generationId（只遮蔽部分字元）
   - 前端狀態變化
   - Console error
   - Network error
6. 等待輪詢完成，但不得再次點擊生成。

若 Gemini quota、rate limit、timeout 或 Provider failure：
- 不要重試
- 保留 correlationId
- 繼續查詢後端紀錄與 fallback 狀態
- 將結果分類為 PROVIDER BLOCKED 或 FALLBACK VERIFIED

五、後端驗證

依此次 correlationId／generationId／測試開始時間，
唯讀查詢對應的 wallpaper_generations 紀錄。

不得輸出完整 Prompt 或完整 AI 文字內容，只驗證：

1. 是否只有一筆對應紀錄
2. generation status
3. metadata_json 是否包含：
   - shopkeeperSnapshot
   - shopkeeperVersion
   - source
   - promptSnapshot
   - contextVersion
   - builderVersion
4. shopkeeperSnapshot 是否包含非空：
   - luckyTheme
   - blessing
   - story
   - oneLiner
   - shopkeeperMessage
   - version
5. shopkeeperVersion 是否為：
   shopkeeper-context-v1
6. source 是否為：
   ai 或 fallback
7. 不得顯示上述欄位的完整文字內容，只回報：
   present / non-empty / version / source

六、Observability 驗證

唯讀查看此次 correlationId 對應的 Function logs，確認：

- correlationId 全程一致
- shopkeeper_context_agent_started
- shopkeeper_context_agent_succeeded
  或 shopkeeper_context_agent_fallback
- generation_service_succeeded
  或明確 failure event
- logs 不含 API Key、JWT、完整 Prompt 或原始 AI Response

若 CLI 無法讀取 logs，標記 MANUAL LOG CHECK，
不得因此假裝通過。

七、前端結果驗證

若生成成功：

- 結果圖片可以載入
- 圖片 URL 不為空
- 下載按鈕可見
- 不實際下載，除非驗收規格要求
- Console 沒有未處理錯誤

若生成失敗：

- UI 顯示可理解的錯誤
- 沒有卡在永久 loading
- 不執行第二次生成

八、Gate C 判定

PASS：
- 真實生成成功
- source = ai
- Shopkeeper Snapshot 完整落地
- correlationId 可追蹤
- 前端結果正常

CONDITIONAL PASS：
- source = fallback
- Snapshot 與完整生成流程仍正常
- 失敗原因是可識別的 Provider quota/timeout/rate limit

BLOCKED：
- 需要手動登入
- 缺少吉祥物或 Gift
- 無法取得必要測試資料或 logs

FAIL：
- Function 5xx 或無法啟動
- Snapshot 未寫入
- metadata 結構錯誤
- 前端永久 loading
- 發生程式缺陷

最後產出報告：
review/P2-AI-03-12-PostDeployment-GateC.md

報告不得包含 secrets、JWT、完整 Prompt、完整 AI 回應或個資。

完成後輸出：
- 登入／測試資料狀態
- HTTP 與生成結果
- source
- Snapshot 欄位驗證
- correlationId 追蹤結果
- 前端結果
- Provider 問題（如有）
- Gate C：PASS / CONDITIONAL PASS / BLOCKED / FAIL
- 下一步建議

不要 commit、push、deploy 或重試生成。