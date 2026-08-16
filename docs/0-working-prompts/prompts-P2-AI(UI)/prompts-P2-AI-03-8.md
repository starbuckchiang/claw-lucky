請執行 P2-AI-02 + P2-AI-03 Push Gate，並在安全條件成立時推送。

本次允許 git fetch 與一般 git push。
禁止 force push、pull、merge、rebase、reset、修改檔案、
db push、Supabase deploy 或建立 PR。

目標 commit：
c411784
feat(ai): add prompt builder and shopkeeper context agent

一、Push 前檢查

1. 執行：
   git branch --show-current
   git remote -v
   git status --short
   git log -1 --oneline
   git fetch origin
   git status -sb

2. 確認：
   - HEAD 必須是 c411784
   - 目前分支必須有明確 upstream
   - origin URL 必須是預期的 claw-lucky repository
   - 本地 commit 不含 secrets
   - 未提交檔案保持原狀

3. 比較本地分支與 upstream：
   git rev-list --left-right --count HEAD...@{upstream}

判定：
- 遠端 ahead > 0 或分支 diverged：
  立即停止，不要 pull、merge、rebase 或 push。
- HEAD 不是 c411784：
  立即停止。
- upstream 不存在或 remote repository 不符：
  立即停止。
- 本地只比遠端 ahead，且其他條件都正常：
  可以執行一般 git push。

二、Push

只允許：

git push

禁止：
- git push --force
- git push --force-with-lease
- 修改遠端歷史
- 推送其他分支或 tag

三、Push 後驗證

1. 執行 git fetch origin
2. 確認遠端 upstream 已包含 c411784
3. 執行：
   git status -sb
   git log -1 --oneline @{upstream}
4. 確認原本未提交／未追蹤檔案仍完整存在
5. 不要因工作區不乾淨而刪除、stash 或 reset 任何檔案

最後輸出：
- 分支名稱
- Remote repository
- Push 前 ahead/behind
- Push 結果
- 遠端 commit hash
- 未提交檔案是否保持原狀
- 是否可以進入 Supabase Deployment Gate

完成後停止。
不要執行 db push 或 functions deploy。
將report存檔至review/P2-AI-03-pushgate.md