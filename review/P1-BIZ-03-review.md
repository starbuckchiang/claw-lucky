# P1-BIZ-03 Review

## Task Scope

- Task: `P1-BIZ-03`
- Goal: 完成 AI Wallpaper Generation 核心串接（Generation Service → Prompt Registry → Provider Adapter → AI Provider abstraction → Generation Result）
- 只實作本次範圍，未提前開始 `P1-BIZ-04`
- 未修改：
  - spec / plan / tasks
  - migration / RLS
  - frontend / worker / queue / polling / storage upload / expiration

## 新增檔案

1. `review/P1-BIZ-03-review.md`

## 修改檔案

1. `js/services/ai/provider-adapter.js`
2. `js/services/wallpaper/generation-service.js`
3. `js/services/wallpaper/generation-repository.js`
4. `js/services/wallpaper/response-dto.js`
5. `js/services/wallpaper/__tests__/generation-service.test.js`

## Workflow

Generation Orchestrator  
→ Generation Service  
→ Prompt Registry Loader（讀 active prompt）  
→ 建立 Prompt Context（variables + rendered prompt text）  
→ Provider Adapter（僅透過 adapter 呼叫 provider）  
→ Normalized Provider Result（含 imageUrl/provider/model/requestId/duration）  
→ Persist Generation Record  
→ Response DTO

## Provider Flow

Provider Adapter 目前支援注入 provider（mock 或其他實作，例如 Gemini adapter）：

- `provider.generateWallpaper(input)` 被 adapter 呼叫
- adapter 量測 `durationMs`
- adapter 正規化成功輸出：
  - `imageUrl`
  - `provider`
  - `model`
  - `providerRequestId`
  - `durationMs`
- 若 provider 回傳缺少 `imageUrl`，adapter 回傳 normalized `INVALID_RESPONSE`
- provider 原生例外會先經過 `normalizeProviderError`，不直接往上拋原生錯誤

## Error Handling（Normalized）

Generation Service 覆蓋：

- `PROMPT_NOT_FOUND`
- `PROVIDER_TIMEOUT`
- `PROVIDER_FAILURE`
- `INVALID_RESPONSE`
- `IMAGE_GENERATION_FAILURE`

## Image Result Output

成功時至少回傳：

- `generationId`
- `provider`
- `model`
- `imageUrl`
- `promptVersion`
- `durationMs`
- `status`
- `createdAt`

## Testing

更新檔案：`js/services/wallpaper/__tests__/generation-service.test.js`

覆蓋案例：

1. Happy Path
2. Provider Timeout
3. Provider Failure
4. Prompt Missing
5. Invalid Response
6. Image Generation Failure on persistence

全部使用 mock，未依賴真實 AI Provider 成功。

## Local Verification

已執行：

```powershell
.\scripts\verify-local.ps1
```

結果：

- Syntax Check: PASS
- Unit Tests: PASS
  - tests: 25
  - pass: 25
  - fail: 0

## Known Limitations

1. 目前 provider 仍以 injected mock/provider abstraction 為主，未綁定正式 Gemini SDK（符合本 Task 可 mock 的要求）。
2. `TD-001` 仍存在：`prompt_versions.version(TEXT)` vs `wallpaper_generations.prompt_version(UUID)`；本次未改 migration，持續使用 metadata workaround。
