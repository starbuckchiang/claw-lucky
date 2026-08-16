請執行 P2-AI-03 Release Scope Review，只讀檢查，不要修改、
commit、push、執行 migration 或 deploy。

1. 列出目前所有 tracked modified 與 untracked files
2. 將檔案分類為：
   - P2-AI-02
   - P2-AI-03
   - 測試／migration
   - 無關修改
   - 無法判定
3. 確認 P2-AI-03 是否依賴尚未部署的 P2-AI-02
4. 判斷是否必須將 P2-AI-02、P2-AI-03 一起部署
5. 唯讀查詢遠端 prompt_versions：
   - prompt_type = daily_lucky_context
   - 列出 version、is_active、created_at
   - 不要輸出完整 prompt 內容，只回報 schema 是否包含
     luckyTheme、blessing、story、oneLiner、
     shopkeeperMessage、version
6. 確認 migration 遇到以下狀況的結果：
   - 遠端完全沒有資料
   - 遠端已有正確 active row
   - 遠端已有錯誤的 active row
   - 遠端有多筆 active row
7. 檢查正式部署是否需要分別執行：
   - supabase db push
   - supabase functions deploy wallpaper-generate
8. 提出安全、依賴順序正確且可回復的部署步驟
9. 不得顯示 secrets，不得修改遠端資料

最後輸出：
- Release Scope
- 遠端 Prompt Registry 狀態
- Migration 行為矩陣
- 部署前阻擋項
- Release Gate：PASS / CONDITIONAL PASS / FAIL

完成後停止，等待確認。