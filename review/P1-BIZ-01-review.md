# P1-BIZ-01 Review

## Task Scope

- Task: `P1-BIZ-01`
- 目標：建立 Wallpaper Generation Business Layer
- 僅完成本次允許範圍，未提前實作 `P1-BIZ-02`
- 未修改：
  - `spec.md`
  - `plan.md`
  - `tasks.md`
  - migrations / RLS
  - frontend / worker / queue / scheduler / storage upload

---

## 新增檔案

1. `js/services/wallpaper/generation-service.js`
2. `js/services/wallpaper/generation-repository.js`
3. `js/services/wallpaper/generation-validator.js`
4. `js/services/wallpaper/response-dto.js`
5. `js/services/wallpaper/__tests__/generation-service.test.js`

## 修改檔案

- 無

---

## Business Architecture

### 1) `generation-service`（Business Layer）

負責 orchestration：

1. 驗證輸入（Validator）
2. 載入 Prompt（Prompt Registry Loader）
3. 呼叫 Provider Adapter（不是 provider 原生）
4. 產生 normalized 結果
5. 持久化（Repository）
6. 回傳 DTO

依賴皆採注入：

- `promptRegistryLoader`
- `providerAdapter`
- `generationRepository`

### 2) `generation-validator`

- 驗證 request 必填欄位：
  - `userId`
  - `mascotId`
  - `giftId`
  - `wallpaperStyle`
  - `luckyTheme`
  - `blessing`
  - `promptType`
- 驗證支援風格：
  - `Retro`
  - `Cute`
  - `Japanese`
  - `Fantasy`
  - `Minimal`

### 3) `generation-repository`

- 僅負責 persistence，無 business logic
- 提供：
  - `createGenerationRepository({ insertGeneration })`
  - `createGenerationRepositoryFromSupabaseClient(...)`
- service 只呼叫 `createGenerationRecord(payload)`，不直接碰 query

### 4) `response-dto`

統一回傳格式：

- success DTO
- normalized error DTO

---

## Generation Flow

`createWallpaperGeneration(request)`

1. Generation Request  
2. Input Validation  
3. Prompt Registry Loader  
4. Provider Adapter  
5. Normalized Result  
6. Persist Generation  
7. Response DTO

符合要求：

- 不直接組 Prompt（透過 Prompt Registry）
- 不直接呼叫 Provider（透過 Provider Adapter）
- 不直接操作資料表（透過 Repository）
- Business Layer 不知道 Supabase Query 細節
- 錯誤皆為 normalized error

---

## Required Interface 實作

### `createWallpaperGeneration(request)`

request 欄位：

- `userId`
- `mascotId`
- `giftId`
- `wallpaperStyle`
- `luckyTheme`
- `blessing`
- `promptType`

success response 至少包含：

- `generationId`
- `status`
- `provider`
- `model`
- `promptVersion`
- `createdAt`

---

## Error Handling（Normalized）

覆蓋下列錯誤類型：

- `INVALID_REQUEST`
- `UNSUPPORTED_WALLPAPER_STYLE`
- `PROMPT_UNAVAILABLE`
- `PROVIDER_FAILURE`
- `PERSISTENCE_FAILURE`

provider 原生錯誤不直接外拋，會先轉為 normalized error。

---

## Testing

檔案：

- `js/services/wallpaper/__tests__/generation-service.test.js`

覆蓋案例：

1. happy path
2. invalid input
3. prompt fallback
4. provider failure
5. persistence failure

執行指令：

```bash
node --test "C:\Users\r0462\.openclaw\workspace\claw-lucky\js\services\ai\__tests__\*.test.js" "C:\Users\r0462\.openclaw\workspace\claw-lucky\js\services\prompt\__tests__\*.test.js" "C:\Users\r0462\.openclaw\workspace\claw-lucky\js\services\wallpaper\__tests__\*.test.js"
```

結果：

- tests: 17
- pass: 17
- fail: 0
- todo: 0

---

## 已知限制

1. 本次僅完成 Business Layer，未建立 API endpoint（符合 Task 限制）。
2. 既有 schema 中：
   - `prompt_versions.version` 為字串
   - `wallpaper_generations.prompt_version` 為 UUID
   
   因型別不一致，本實作將 `promptVersion` 寫入 `metadata_json.promptVersion`，`prompt_version` 欄位目前寫 `null`。  
   未修改 migration（依指示僅列為限制）。

