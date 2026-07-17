# P1-BIZ-06 Review

## Task Scope

- Task: `P1-BIZ-06`
- Goal: 建立 AI Wallpaper Generation Observability（可追蹤 correlationId / generation chain）
- 本次僅完成 observability，不提前開始 `P1-BIZ-07`
- 未修改：
  - API contract / DTO shape
  - migration / RLS
  - 既有 business outcome（成功/失敗規則）

## 新增檔案

1. `js/services/logging/correlation-id.js`
2. `js/services/logging/generation-logger.js`
3. `js/services/logging/generation-tracing.js`
4. `js/services/wallpaper/__tests__/generation-observability.test.js`
5. `review/P1-BIZ-06-review.md`

## 修改檔案

1. `js/services/wallpaper/generation-service.js`
2. `js/services/wallpaper/generation-orchestrator.js`
3. `scripts/verify-local.ps1`

## Required Capabilities Coverage

Observability trace 可記錄以下欄位（依成功流程可用資料填充）：

- `correlationId`
- `generationId`
- `jobId`
- `provider`
- `model`
- `promptVersion`
- `status`
- `durationMs`
- `createdAt`

## Logging Rules Coverage

- 所有 generation logger entry 都強制需要 `correlationId`
- `generation-logger` 會遮罩敏感欄位，不直接輸出：
  - prompt 全文（`prompt`, `promptText`, `promptTemplate`）
  - 使用者敏感資訊（`userId`）
  - secret / token / api key 類欄位

## Error Tracking Coverage

`generation-tracing.buildErrorTrace(...)` 提供統一錯誤追蹤欄位：

- `correlationId`
- `errorCode`
- `timestamp`

並在 orchestrator/service 失敗事件記錄中保留。

## Testing

新增檔案：`js/services/wallpaper/__tests__/generation-observability.test.js`

1. correlationId 建立
2. correlationId 全流程傳遞
3. logger 包含 correlationId
4. provider failure 可追蹤
5. normalized error 保留 correlationId

全部使用 mock dependency，未呼叫真實 AI。

## Business Flow Tracing

- **Generation Orchestrator Start**: 建立 trace，注入 `correlationId`
- **Generation Service Call**: 將同一 `correlationId` 傳遞到 generation service
- **Success Path**:
  - 記錄成功 event（含 generationId/jobId/provider/model/promptVersion/status/durationMs/createdAt）
- **Failure Path**:
  - 記錄失敗 event（含 correlationId + errorCode + timestamp）
  - 可追蹤 provider failure、daily limit、points failure、persistence failure 等失敗節點

## Local Verification Result

已執行：

```powershell
.\scripts\verify-local.ps1
node -e "require('./js/services/logging/correlation-id'); require('./js/services/logging/generation-logger'); require('./js/services/logging/generation-tracing'); console.log('module-load-smoke:ok');"
```

結果：

- Syntax Check: PASS
- Unit Tests: PASS
  - tests: 56
  - pass: 56
  - fail: 0
- Module Load Smoke Test: PASS (`module-load-smoke:ok`)

## Known Limitations

1. `ADR-007 Client Polling Workflow` 目前以文字檔形式存在（`docs/adr/ADR-007-Client Polling Workflow.txt`），尚未標準化為 `.md` 命名。
2. 目前 observability 以 structured log 為主，尚未接入外部 tracing backend（例如 OpenTelemetry exporter）。
