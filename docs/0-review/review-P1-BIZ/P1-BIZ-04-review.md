# P1-BIZ-04 Review

## Task Scope

- Task: `P1-BIZ-04`
- Goal: 建立 Wallpaper Generation Status / Progress API（供前端 polling）
- 本次僅實作 `P1-BIZ-04`，未提前開始 `P1-BIZ-05`
- 未修改：
  - `spec.md` / `plan.md` / `tasks.md`
  - migration / RLS
  - frontend polling UI / SSE / worker / queue / storage upload / signed URL

## 新增檔案

1. `js/services/wallpaper/progress-response-dto.js`
2. `js/services/wallpaper/generation-query-repository.js`
3. `js/services/wallpaper/generation-query-service.js`
4. `js/api/wallpaper-generation-status-controller.js`
5. `js/services/wallpaper/__tests__/generation-query-service.test.js`
6. `js/services/wallpaper/__tests__/wallpaper-generation-status-controller.test.js`
7. `review/P1-BIZ-04-review.md`

## 修改檔案

1. `scripts/verify-local.ps1`

## API Contract

提供兩個 controller handler（對應需求 endpoints）：

- `GET /api/wallpapers/generations/{id}` → `getGeneration(request)`
- `GET /api/wallpapers/generations/{id}/progress` → `getGenerationProgress(request)`

成功回應 `200`，`body` 內回傳：

- `generationId`
- `jobId`
- `status`
- `progressPercent`
- `progressStage`
- `estimatedRemainingSeconds`
- `provider`
- `model`
- `imageUrl`
- `failureCode`
- `failureMessage`
- `createdAt`
- `updatedAt`
- `recommendedPollIntervalMs`
- `terminal`

錯誤一律 normalized error DTO，並映射 HTTP status：

- `INVALID_GENERATION_ID` → 400
- `GENERATION_NOT_FOUND` → 404
- `UNAUTHORIZED_GENERATION_ACCESS` → 403
- `QUERY_FAILURE` → 503
- `INVALID_STATUS_RESPONSE` → 500

## Ownership Enforcement

- Query service 會比對 `requesterUserId` 與資料列 `userId`
- 非 owner 回傳 `UNAUTHORIZED_GENERATION_ACCESS`
- 無 auth context 也回傳 `UNAUTHORIZED_GENERATION_ACCESS`
- 僅查詢，不提供任何狀態更新能力

## Status Mapping

Generation DB status：

- `pending` / `processing` / `succeeded` / `failed` / `expired`

Job DB status（fallback mapping）：

- `queued` → `pending`
- `processing` → `processing`
- `succeeded` → `succeeded`
- `failed` → `failed`
- `cancelled` → `failed`（並視為 terminal）

無法映射時回傳 `INVALID_STATUS_RESPONSE`。

## Polling Behavior

- 非 terminal：
  - `processing` 推薦 `1500ms`
  - `pending` 推薦 `2500ms`
- terminal（`succeeded` / `failed` / `expired` / `job cancelled`）：
  - `recommendedPollIntervalMs = 0`
  - `terminal = true`

## Normalized Errors

本次覆蓋：

- `INVALID_GENERATION_ID`
- `GENERATION_NOT_FOUND`
- `UNAUTHORIZED_GENERATION_ACCESS`
- `QUERY_FAILURE`
- `INVALID_STATUS_RESPONSE`

錯誤不透出 Supabase 原始錯誤給前端。

## Tests

檔案：`js/services/wallpaper/__tests__/generation-query-service.test.js`

1. owner 查詢 pending generation
2. owner 查詢 processing generation
3. owner 查詢 succeeded generation
4. owner 查詢 failed generation
5. 非 owner 查詢被拒絕
6. generation 不存在
7. repository query failure
8. terminal state 不建議繼續 polling
9. progress payload 欄位完整

檔案：`js/services/wallpaper/__tests__/wallpaper-generation-status-controller.test.js`

- endpoint handler 200 回應
- unauthorized 403 映射

全部採 mock repository / mock service，未依賴真實 Supabase。

## Local Verification Result

已執行：

```powershell
.\scripts\verify-local.ps1
node -e "require('./js/services/wallpaper/generation-query-service'); require('./js/services/wallpaper/generation-query-repository'); require('./js/services/wallpaper/progress-response-dto'); require('./js/api/wallpaper-generation-status-controller'); console.log('module-load-smoke:ok');"
```

結果：

- Syntax Check: PASS
- Unit Tests: PASS
  - tests: 36
  - pass: 36
  - fail: 0
- Module Load Smoke Test: PASS (`module-load-smoke:ok`)

## Known Limitations

1. 本次提供 controller/handler 模組與 service/repository，未綁定特定 Node HTTP framework router（依現有專案結構保持框架中立）。
2. `provider`/`imageUrl` 目前由 generation metadata 欄位讀取；若歷史資料未寫入 metadata 將回傳 `null`（符合需求允許未完成可為 `null`）。
