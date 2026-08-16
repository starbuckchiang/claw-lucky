請執行 P2-AI-03 Deployment Provenance Review。

本次只能唯讀調查。
禁止修改檔案、commit、push、db push、functions deploy、
設定 secrets、重新執行 workflow 或修改任何遠端資料。

已知狀態：
- Git commit c411784 已於 main push 成功
- 遠端 migration 20260727000000 已被套用
- daily_lucky_context created_at 約為
  2026-07-27 06:33:41 UTC
- 但本次 Gate A 並未執行 db push

一、檢查 GitHub 自動部署設定

1. 檢查：
   .github/workflows/**
   supabase/config.toml
   package.json
   其他 deployment scripts

2. 搜尋是否存在：
   - supabase db push
   - supabase functions deploy
   - GitHub push main 自動觸發
   - migration deployment
   - Supabase deployment action

3. 若 gh CLI 可用，唯讀查詢：
   gh run list
   gh run view <與 c411784 對應的 run>

只查看，不得 rerun、cancel 或修改 workflow。

二、確認 Edge Function 現況

1. 唯讀執行：
   supabase functions list

2. 回報 wallpaper-generate：
   - 是否存在
   - status
   - version
   - updated_at
   - 最近更新時間是否晚於 c411784 push 時間

3. 若 Supabase CLI 支援唯讀查看部署資訊或 logs，
   只查看最近部署時間與版本，不觸發函式、不輸出敏感資料。

4. 不要假設 migration 已套用就代表 Function 也已部署。

三、檢查 Secrets 狀態

唯讀執行：
supabase secrets list

只回報以下名稱是否存在，不得輸出 value：
- GEMINI_API_KEY
- SHOPKEEPER_MODEL
- SHOPKEEPER_TIMEOUT_MS
- SHOPKEEPER_MAX_RETRY

四、判定 migration 來源

依證據分類：
- GitHub Actions 自動套用
- Supabase 自動整合套用
- 本機先前操作套用
- 其他已識別來源
- 無法判定

不得只用猜測下結論；必須附上時間與 workflow／log 證據。

五、Gate B 判定

- 如果 c411784 push 已自動部署 wallpaper-generate：
  不要再次 deploy，標記為 ALREADY DEPLOYED，
  下一步應改做部署後驗證。

- 如果 migration 自動套用，但 Function 尚未部署：
  標記 READY FOR MANUAL FUNCTION DEPLOYMENT。

- 如果自動流程仍在執行或狀態不明：
  標記 BLOCKED，等待流程完成或人工確認。

最後輸出：
- Migration 來源判定與證據
- GitHub Actions 狀態
- wallpaper-generate 遠端版本與更新時間
- Secrets 名稱存在性
- 是否已自動部署 Function
- Gate B：ALREADY DEPLOYED / READY / BLOCKED
- 建議下一步

完成後停止，不要進行任何部署。
將report存檔至review/P2-AI-03-10-ProvenanceReview.md