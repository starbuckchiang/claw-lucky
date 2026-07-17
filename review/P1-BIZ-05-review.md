# P1-BIZ-05 Review

## Task Scope

- Task: `P1-BIZ-05`
- Goal: 完成 Wallpaper Generation Client Flow（submit → polling → terminal result）
- 本次僅實作 `P1-BIZ-05`，未提前開始 `P1-BIZ-06`
- 未實作：下載、Storage URL、Share、Face Swap、Worker、Queue

## 新增檔案

1. `js/services/wallpaper/wallpaper-generation-client.js`
2. `js/services/wallpaper/wallpaper-polling-service.js`
3. `js/services/wallpaper/wallpaper-result-presenter.js`
4. `js/services/wallpaper/__tests__/wallpaper-generation-client.test.js`
5. `js/services/wallpaper/__tests__/wallpaper-polling-service.test.js`
6. `review/P1-BIZ-05-review.md`

## 修改檔案

1. `scripts/verify-local.ps1`

## Client Flow

Submit Request  
→ `generationApi.createGeneration(request)`  
→ 取得 `generationId`  
→ `pollingService.pollUntilTerminal({ generationId })`  
→ 依 API 的 `recommendedPollIntervalMs` 輪詢 progress  
→ `terminal = true` 立即停止  
→ `resultPresenter` 輸出 success / normalized error

## Polling Flow

- 完全依 API 回傳 `recommendedPollIntervalMs`（未在前端硬編碼 1500/2500）
- 非 terminal 且 interval 無效（<=0）時，回傳 `INVALID_STATUS_RESPONSE`
- terminal 成功：回傳最終 status data
- terminal 失敗：回傳 normalized error（`failureCode` 優先，否則 `GENERATION_FAILED`）
- 內建 `maxPollAttempts` 防止 infinite loop（預設 120）

## API Integration

`wallpaper-generation-client.js` 內提供：

- `createWallpaperHttpApiClient(...)`
  - `POST /api/wallpapers/generations`
  - `GET /api/wallpapers/generations/{id}/progress`
  - 統一轉為 normalized DTO，不透出原始 exception
- `createWallpaperGenerationClient(...)`
  - 整合 submit + polling + presenter

## Result Handling

成功輸出至少含：

- `imageUrl`
- `provider`
- `promptVersion`（來自 submit response）

失敗輸出：

- 全部使用 normalized error DTO
- 不直接顯示 Provider exception

## Error Handling（本次覆蓋）

- `GENERATION_FAILED`
- `PROVIDER_FAILURE`
- `PROVIDER_TIMEOUT`
- `DAILY_LIMIT_EXCEEDED`
- `UNAUTHORIZED_GENERATION_ACCESS`
- `POLLING_FAILURE`
- `INVALID_STATUS_RESPONSE`

## Testing（Mock API）

`wallpaper-generation-client.test.js`

1. Happy Path
2. Daily Limit

`wallpaper-polling-service.test.js`

1. Polling Until Success
2. Polling Until Failure
3. Provider Timeout
4. Generation Failed without failureCode
5. Unauthorized
6. Polling Failure
7. Terminal Stop

全部使用 mock API，未依賴真實 AI Provider。

## Local Verification Result

已執行：

```powershell
.\scripts\verify-local.ps1
node -e "require('./js/services/wallpaper/wallpaper-generation-client'); require('./js/services/wallpaper/wallpaper-polling-service'); require('./js/services/wallpaper/wallpaper-result-presenter'); console.log('module-load-smoke:ok');"
```

結果：

- Syntax Check: PASS
- Unit Tests: PASS
  - tests: 45
  - pass: 45
  - fail: 0
- Module Load Smoke Test: PASS (`module-load-smoke:ok`)

## Known Limitations

1. 本次交付為 client flow 模組與測試，未綁定特定頁面 UI DOM（符合本 Task 不含下載/share/其他 UI 範圍）。
2. `promptVersion` 目前由 submit response 帶入前端結果呈現，status API 本身不含 `promptVersion`。

## Business Flow Simulation

- Success Flow: **PASS**
  - createGeneration → pending → processing → succeeded
  - terminal=true 後停止 polling
  - presenter 輸出 `imageUrl` / `provider` / `promptVersion`
- Provider Timeout Flow: **PASS**
  - terminal failed + `failureCode=PROVIDER_TIMEOUT`
  - presenter 回 normalized error
  - 未外洩 provider raw exception
- Daily Limit Flow: **PASS**
  - createGeneration 回 `DAILY_LIMIT_EXCEEDED`
  - 未啟動 polling
- Unauthorized Flow: **PASS**
  - polling 回 `UNAUTHORIZED_GENERATION_ACCESS`
  - client 立即停止 polling 並回 normalized error
- Polling Failure Flow: **PASS**
  - progress API network error → `POLLING_FAILURE`
  - 單次失敗即停止，無 infinite loop
- Invalid Status Flow: **PASS**
  - non-terminal 且 `recommendedPollIntervalMs <= 0`
  - 回 `INVALID_STATUS_RESPONSE`

測試檔：`js/services/wallpaper/__tests__/milestone-02-business-flow.test.js`
