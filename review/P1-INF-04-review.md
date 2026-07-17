# P1-INF-04 Review

## Task 範圍

- Task: `P1-INF-04`
- 目標：建立 Prompt Registry Loader，從 `prompt_versions` 載入 active template 並回傳版本資訊
- 本次未包含：
  - Prompt Builder
  - API endpoint
  - Worker
  - Frontend
  - Database migration

---

## 前置檢查結果

### 1) `prompt_versions` migration 實際欄位

根據 `supabase/migrations/20260712040100_create_prompt_versions.sql`，可用欄位包含：

- `prompt_type`
- `version`
- `template`
- `is_active`
- `metadata_json`
- `created_at`

符合 Loader 查詢需求（`is_active = true` + 版本/模板/metadata 載入）。

### 2) 現有 Supabase client 建立方式

`js/config.js` 目前在前端建立 `window.supabaseClient`（publishable key）。

### 3) 現有共用 API/service 模組

- `js/api.js`（`window.Api`）
- `js/shop/shop-api.js`（IIFE + `window.supabaseClient`）
- 先前已新增 `js/services/ai/*`（CommonJS，Node 測試友善）

### 4) P1-INF-03 Provider Adapter 結構

- `js/services/ai/provider-adapter.js`
- `js/services/ai/error-normalizer.js`
- `js/services/ai/failure-codes.js`

採 CommonJS、可注入依賴、可做 contract tests。

---

## 新增檔案

1. `js/services/prompt/fallback-templates.js`
2. `js/services/prompt/prompt-registry-loader.js`
3. `js/services/prompt/__tests__/prompt-registry-loader.test.js`

---

## Loader API 摘要

### `createPromptRepositoryFromSupabaseClient({ supabaseClient, tableName })`

- 封裝對 `prompt_versions` 的讀取。
- 查詢條件：
  - `prompt_type = <input>`
  - `is_active = true`
- 僅 `SELECT`，不提供任何修改能力。

### `createPromptRegistryLoader({ repository, cache, now })`

回傳：

- `loadActivePrompt(promptType)`
- `clearCache()`
- `getCacheInfo()`

`loadActivePrompt(promptType)` 成功回傳結構：

- `promptType`
- `version`
- `template`
- `metadata`
- `source` (`database` / `fallback`)

支援 prompt type：

- `daily_lucky_context`
- `wallpaper_generation`

---

## Fallback 行為（集中管理）

集中在 `js/services/prompt/fallback-templates.js`，避免分散硬編碼。

### fallback 觸發

1. DB 查詢失敗（Supabase error / 例外）
2. 查無 active prompt

### 防禦性錯誤（不走 fallback）

1. 不支援的 `promptType`  
   - `PromptRegistryError(code: "UNSUPPORTED_PROMPT_TYPE")`
2. 同一 `promptType` 回傳多筆 active  
   - `PromptRegistryError(code: "MULTIPLE_ACTIVE_PROMPTS")`
3. `template` 為空字串或空白  
   - `PromptRegistryError(code: "INVALID_TEMPLATE")`

---

## Cache 決策

已實作輕量 in-memory cache（不引入外部服務）：

- TTL 明確（預設 60 秒）
- 可停用（`cache.enabled = false`）
- 僅快取 `source = "database"` 的成功結果
- 查詢失敗時不回傳過期 cache，不回傳不安全內容，直接使用集中 fallback

---

## 測試

檔案：`js/services/prompt/__tests__/prompt-registry-loader.test.js`

覆蓋案例：

1. active prompt load success
2. missing prompt type
3. no active prompt fallback
4. multiple active prompt defensive handling
5. invalid empty template
6. database query failure
7. version returned correctly

執行指令：

```bash
node --test "C:\Users\r0462\.openclaw\workspace\claw-lucky\js\services\prompt\__tests__\*.test.js"
```

測試結果：

- tests: 7
- pass: 7
- fail: 0
- todo: 0

---

## 合規與限制

- 未修改 `spec.md` / `plan.md` / `tasks.md`
- 未修改 migration（僅讀取既有 schema）
- 未建立 API endpoint / Worker / Frontend
- 未串接正式 AI Provider
- 未使用 TODO / placeholder / stub

