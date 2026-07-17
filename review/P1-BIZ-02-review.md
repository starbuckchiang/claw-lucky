# P1-BIZ-02 Review

## Task Scope

- Task: `P1-BIZ-02`
- Goal: 建立 Wallpaper Generation Orchestrator（Business Transaction Coordination）
- 只實作 P1-BIZ-02，未提前開始 P1-BIZ-03
- 未修改：
  - spec / plan / tasks
  - migration / RLS
  - frontend / worker / queue / polling API / image upload

## 新增檔案

1. `js/services/wallpaper/generation-orchestrator.js`
2. `js/services/wallpaper/usage-service.js`
3. `js/services/wallpaper/job-service.js`
4. `js/services/wallpaper/points-service.js`
5. `js/services/wallpaper/usage-repository.js`
6. `js/services/wallpaper/job-repository.js`
7. `js/services/wallpaper/points-repository.js`
8. `js/services/wallpaper/__tests__/generation-orchestrator.test.js`

## 修改檔案

- 無

## Workflow（實作流程）

Receive Request  
→ Validate User  
→ Check Daily Usage  
→ Create Generation Job (Pending)  
→ Update Job Status (Running)  
→ Call Generation Service  
→ If generation failed: Update Job Status (Failed) and return normalized error  
→ If generation success: Deduct Points  
→ Record Daily Usage Success  
→ Update Job Status (Success)  
→ Return normalized success response

## Business Architecture

### generation-orchestrator

- 只協調流程與狀態，不直接：
  - 組 Prompt
  - 呼叫 AI Provider
  - 操作 SQL
- 依賴注入：
  - `generationService`
  - `usageService`
  - `jobService`
  - `pointsService`

### usage-service

- 規則：
  - 每日上限檢查（預設 3）
  - 超限即回 `DAILY_LIMIT_EXCEEDED`
- 成功後記錄當日 usage +1
- 錯誤回 normalized `PERSISTENCE_FAILURE`

### job-service

- 管理 job 狀態：
  - `Pending`
  - `Running`
  - `Success`
  - `Failed`
- 對外只提供 create / markRunning / markSuccess / markFailed
- 錯誤回 normalized `JOB_CREATION_FAILURE` 或 `PERSISTENCE_FAILURE`

### points-service

- 驗證 user 存在
- 讀取 generation cost（失敗時 fallback default=10）
- 只在成功流程執行扣點
- 扣點失敗回 normalized `POINTS_DEDUCTION_FAILURE`

### repositories（無 Business Logic）

- `usage-repository.js`
- `job-repository.js`
- `points-repository.js`

均為 persistence 邊界抽象，不含業務規則。

## Error Handling（Normalized）

覆蓋：

- `DAILY_LIMIT_EXCEEDED`
- `JOB_CREATION_FAILURE`
- `GENERATION_FAILURE`
- `PERSISTENCE_FAILURE`
- `POINTS_DEDUCTION_FAILURE`

## Testing

檔案：`js/services/wallpaper/__tests__/generation-orchestrator.test.js`

案例覆蓋：

1. Happy Path
2. Daily Limit
3. Success Deduct Points
4. Failure No Deduct
5. Job Failure
6. Repository Failure
7. Points Deduction Failure

全部使用 mock（Generation Service / Service 層依賴 / Repository 抽象），未呼叫真實 Provider。

## Local Verification（Required）

已執行：

```powershell
.\scripts\verify-local.ps1
```

結果：

- Syntax Check: PASS
- Unit Tests: PASS
  - tests: 24
  - pass: 24
  - fail: 0

## 已知限制

1. 目前 orchestrator 為同步流程協調，未加入 queue/worker（依本 Task 限制）。
2. `prompt_version` 型別 mismatch（TD-001）仍維持既有 workaround，未在本 Task 變更 schema。
