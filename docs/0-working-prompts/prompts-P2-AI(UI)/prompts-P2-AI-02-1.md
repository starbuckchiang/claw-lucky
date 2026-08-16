你現在開始執行 P2-AI-02：Deterministic Wallpaper Prompt Builder。

在進行任何程式修改前，請先讀取並遵循以下文件：

C:\Users\r0462\.openclaw\workspace\claw-lucky\specs\002-p2-ai-prompt-builder\AI constitution.md

同時檢查專案內既有的：
- .specify/memory/constitution.md
- specs/002-p2-ai-prompt-builder/spec.md
- 與 Prompt Registry、Generation Service、Generation Orchestrator 相關的現有程式碼

本次工作的最高優先原則如下：

1. Prompt engineering 是內部實作細節，使用者不應填寫 Lucky Theme 或祝福語。
2. 變色龍店長是 Lucky Theme、Blessing、Story 的來源。
3. Wallpaper Prompt Builder 是唯一允許組裝圖片 Prompt 的入口。
4. 吉祥物一致性高於藝術自由度。
5. 已知資料必須 deterministic，不可讓模型猜測。
6. 所有 AI 輸入輸出必須使用明確 Schema。
7. 缺少必要資料時必須失敗，不得生成不完整 Prompt。
8. Prompt、Schema 與 Agent 輸出都必須有版本。
9. 日期必須由系統依 Asia/Taipei 產生，不可由模型推測。
10. 不得讓 UI 直接呼叫 Image Provider 或自行拼接 Prompt。

第一階段只進行分析，不修改程式。

請完成以下事項：

A. 摘要 AI Constitution 中與 P2-AI-02 直接相關的約束。
B. 找出目前實際組裝 wallpaper prompt 的完整呼叫路徑。
C. 找出目前 Lucky Theme、Blessing、Date、Mascot、Gift 分別從哪裡取得。
D. 指出造成以下問題的具體程式位置：
   - 選企鵝卻生成狐狸
   - Lucky Theme 由使用者輸入
   - 變色龍店長祝福流程缺失
   - 日期月份錯誤
E. 列出預計修改與新增的檔案。
F. 提出最小可行實作計畫，明確區分：
   - 本 Task 要做
   - 後續 Shopkeeper Context Agent 才做
   - UI Workflow Task 才做
G. 列出可能破壞既有 Generation Pipeline 的風險。
H. 在得到我的確認前，不要修改任何檔案。

回覆格式：

1. Constitution Compliance Summary
2. Current Prompt Flow
3. Root Cause Findings
4. Proposed File Changes
5. Implementation Plan
6. Out of Scope
7. Risks
8. Questions Requiring Product Decision

不要只重述需求，必須引用實際檔案、函式與呼叫關係。

最後請回答:
最終送到 Gemini 的 prompt 是在哪一行形成的？