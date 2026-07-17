# Task Runner Prompt

請實作指定 Task。

開始前請先閱讀：

- specs/001-ai-lucky-wallpaper/spec.md
- specs/001-ai-lucky-wallpaper/plan.md
- specs/001-ai-lucky-wallpaper/tasks.md
- .specify/memory/constitution.md

Task：

{{TASK_ID}}

只允許完成：

{{TASK_ID}}

不得提前實作其他 Task。

---

Implementation Rules

- Follow Specification.
- Follow Plan.
- Follow Tasks.
- Follow Constitution.

不得：

- 修改 Spec
- 修改 Plan
- 修改 Tasks
- 修改其他 Phase
- 新增未核准需求
- 順便重構 unrelated code

---

Definition of Done

只有符合以下條件才算完成：

- 所有 Acceptance Criteria 完成
- 所有 Deliverables 完成
- Compile 通過
- Tests 通過
- Migration 可執行（若適用）

完成後停止。

不要開始下一個 Task。

不要 commit。

不要 push。

請輸出：

- 新增檔案
- 修改檔案
- 測試方式
- 已知限制

完成實作後：

1. 執行 .\scripts\verify-local.ps1
2. 若驗證失敗，自行修正並重新驗證
3. 全部通過後，產生 Review Package
4. 不要 Commit
5. 不要 Push
6. 等待 ChatGPT Review