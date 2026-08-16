請建立 P2-AI-02 + P2-AI-03 本機 Release Commit。

本次允許 git stage 與 commit，但禁止 push、db push、deploy、
修改遠端資料或建立 GitHub PR。

先閱讀：
1. P2-AI-03-Deployment-Preflight.md
2. P2-AI-03-GateReview.md
3. P2-AI-03-ReleaseScopeReview.md
4. AI Constitution

一、提交範圍

依 Deployment Preflight 第 5 節的 Release Commit 清單，
只 stage 下列類型：

- P2-AI-02 程式與測試
- P2-AI-03 程式與測試
- 所有必要 JS / Deno TS twins
- wallpaper-generate 必要 handler、client 與 index.ts
- 20260727000000_seed_daily_lucky_context_prompt.sql
- scripts/verify-local.ps1
- .env.example
- P2-AI-03 必要 Gate Review 文件

禁止使用：
- git add .
- git add -A
- git add js/services/shopkeeper/
- 任何目錄級或萬用字元 stage

所有檔案必須逐一使用完整路徑 stage。

二、明確排除

不要 stage：

- .vscode/mcp.json
- .playwright-mcp/**
- 所有測試截圖
- docs/acceptance/P2-AI-03-acceptance.md
  （它引用被排除的截圖，暫不提交）
- 無關文件與工作 Prompt
- 無關 spec 新增或刪除
- 無人店面相關檔案
- .env、API Key、secrets
- Deployment Preflight 報告中列為用途不明的檔案

三、提交前檢查

完成 stage 後，先執行：

1. git diff --cached --name-status
2. git diff --cached --check
3. 檢查 staged diff 是否包含 API Key、token、secret 或密碼
4. 確認 migration、JS/TS twins、必要 import 檔案沒有漏掉
5. 確認排除項目完全不在 staged files
6. 執行完整 verify-local.ps1

若測試不是全部通過、發現 secrets、缺少 twin/import，
或 staged scope 超出預期，立即停止，不要 commit。

四、建立 Commit

若全部通過，建立一個本機 commit，message：

feat(ai): add prompt builder and shopkeeper context agent

Commit body：

- add P2-AI-02 prompt architecture and repositories
- add P2-AI-03 Shopkeeper Context Agent and Gemini text provider
- seed daily_lucky_context prompt registry entry
- persist Shopkeeper snapshot metadata
- verify 207 automated tests

五、Commit 後驗證

執行：

1. git show --stat --oneline HEAD
2. git log -1 --name-status
3. git status --short
4. 再次確認排除檔案仍未提交
5. 回報 commit hash

最後輸出：
- Commit hash
- 已提交檔案分類與數量
- 測試結果
- 未提交／排除項目摘要
- 是否可以進入 Push Gate
- 是否可以進入 Deployment Gate

完成後停止。
不要 push、不要 db push、不要 deploy。
將report存檔至review/P2-AI-03-pleasecommit.md
