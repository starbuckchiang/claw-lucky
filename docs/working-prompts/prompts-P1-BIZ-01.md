# Prompt Archive: P1-BIZ-01

## 原始需求（整理版）

請實作 `P1-BIZ-01`。

### Goal

建立 Wallpaper Generation Service（Business Layer）。

### 必要流程

Input Validation  
→ Prompt Registry  
→ Provider Adapter  
→ Persist Generation（Repository）  
→ Response DTO

### 必要規則

- 不可直接組 prompt
- 不可直接呼叫 provider
- 不可直接操作 table / Supabase query
- 錯誤必須 normalized

### 測試

- happy path
- invalid input
- prompt fallback
- provider failure
- persistence failure

### 限制

- 不做 frontend / worker / queue
- 不修改 spec/plan/tasks/migration/RLS
- 不要 commit / push

