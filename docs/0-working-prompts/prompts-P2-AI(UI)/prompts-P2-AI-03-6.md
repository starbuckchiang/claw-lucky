請執行 P2-AI-02 + P2-AI-03 Deployment Preflight。

本次只能唯讀檢查，不得修改檔案、不得 stage、commit、push、
db push 或 deploy。

1. 重新執行完整 verify-local.ps1，確認 207/207 或更多測試通過。

2. 執行並分析：
   supabase migration list
   supabase db push --dry-run

3. 列出 db push 實際準備套用的全部 migration。
   如果除了預期的
   20260727000000_seed_daily_lucky_context_prompt.sql
   之外還有其他 pending migration，標記為 BLOCKED 並逐一說明。

4. 檢查 wallpaper-generate 的完整 Deno import graph：
   - 確認所有 P2-AI-02/P2-AI-03 必要 .ts 模組都存在
   - 確認沒有 import 本機才存在但部署時不會被包含的檔案
   - 確認沒有 unresolved import

5. 產生「建議納入 release commit」的精確檔案清單。
   只能包含：
   - P2-AI-02 程式與測試
   - P2-AI-03 程式與測試
   - 必要 migration
   - verify-local.ps1
   - .env.example
   - 對應必要 Gate Review 文件

6. 明確排除：
   - .vscode/mcp.json
   - .playwright-mcp/**
   - 測試截圖
   - 無關文件
   - 無關 spec 刪除
   - secrets、.env、API Key
   - 其他無法確認用途的修改

7. 檢查 release commit 清單是否完整包含 JS 與 Deno TS twins，
   並確認沒有只提交其中一側。

8. 提出部署前本機 commit 建議：
   - 建議 commit message
   - 精確 git add 指令
   - commit 後驗證指令
   不要實際執行。

最後輸出：
- 測試結果
- Pending Migration 清單
- db push dry-run 結果
- Deno import graph 結論
- Release commit 檔案清單
- 明確排除清單
- Deployment Preflight：PASS / CONDITIONAL PASS / FAIL

完成後停止，等待確認。