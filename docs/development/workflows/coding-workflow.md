# Coding Workflow

Version: 1.0

---

# Purpose

定義 AI Lucky Wallpaper Studio 的標準開發流程。

每一個 Task 都必須遵循此流程。

---

# Standard Workflow

Task
↓

閱讀：

- Specification
- Plan
- Tasks

↓

確認 Dependencies 已完成

↓

Copilot Agent 實作

↓

Compile

↓

Unit Test

↓

Integration Test（若適用）

↓

ChatGPT Code Review

↓

修正 Review Comments

↓

Git Commit

↓

Pull Request

↓

Merge

---

# Before Coding Checklist

開始任何 Task 前：

- [ ] 對應 Specification 已閱讀
- [ ] Plan 已閱讀
- [ ] Acceptance Criteria 已理解
- [ ] Dependencies 已完成
- [ ] Files to modify 已確認
- [ ] Migration 命名已確認

---

# During Coding Rules

每個 Task：

- 單一責任
- 不加入未核准需求
- 不順便重構 unrelated code
- 不修改其他 Task 範圍

若發現需要修改：

- Plan
- Specification

必須先停止 Coding。

---

# Testing

至少完成：

- Compile
- Unit Test
- Manual Test

若有 API：

- Request
- Response
- Error Cases

若有 DB：

- Migration
- Rollback

若有 RLS：

- owner
- non-owner

---

# Before Merge

確認：

- [ ] 所有測試通過
- [ ] 無 Debug Code
- [ ] 無 Console Log
- [ ] 無 TODO
- [ ] ChatGPT Code Review 完成