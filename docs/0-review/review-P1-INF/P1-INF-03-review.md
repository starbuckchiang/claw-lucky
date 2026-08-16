# P1-INF-03 Review

## Task 範圍

- Task: `P1-INF-03`
- 目標：建立 Provider Adapter 抽象介面與錯誤正規化
- 限制遵循：
  - 未實作 Prompt Registry
  - 未新增 API endpoint
  - 未實作 Worker / Frontend / Database migration
  - 未修改 `spec.md` / `plan.md` / `tasks.md`
  - 未 commit / push

## 實際資料夾與模組風格檢查結果

- 專案現況為瀏覽器端 JS（IIFE + `window.*`）為主。
- `js/services/ai` 原本不存在。
- 本次新增後端導向 CommonJS 模組於 `js/services/ai`，以便：
  - 安全隔離 Provider 設定（讀取 `process.env`）
  - 可用 Node 原生測試執行 contract tests

## 新增檔案

### AI Adapter 核心

1. `js/services/ai/failure-codes.js`
2. `js/services/ai/error-normalizer.js`
3. `js/services/ai/provider-adapter.js`
4. `js/config/ai-provider-config.js`

### 測試

5. `js/services/ai/__tests__/test-helpers.js`
6. `js/services/ai/__tests__/adapter-contract.test.js`
7. `js/services/ai/__tests__/error-normalization.test.js`
8. `js/services/ai/__tests__/retryability.test.js`
9. `js/services/ai/__tests__/mock-provider-success.test.js`
10. `js/services/ai/__tests__/mock-provider-failure.test.js`

## Adapter 介面摘要

`createProviderAdapter({ providerName, model, provider })` 回傳：

- `generateLuckyContext(input)`
- `generateWallpaper(input)`
- `classifyRetryability(error)`
- `normalizeProviderError(error)`

統一輸出欄位：

- `providerRequestId`
- `provider`
- `model`
- `result`
- `durationMs`
- `retryable`
- `failureCode`
- `failureMessage`

## Normalized Failure Codes

- `TIMEOUT`
- `RATE_LIMITED`
- `AUTH_ERROR`
- `INVALID_REQUEST`
- `CONTENT_REJECTED`
- `PROVIDER_UNAVAILABLE`
- `NETWORK_ERROR`
- `UNKNOWN_PROVIDER_ERROR`

## 設計決策與合規說明

1. 業務層不處理 provider 原生錯誤  
   - 由 `error-normalizer.js` 統一轉換錯誤語意與 retryability。

2. 不綁定單一 Provider  
   - Adapter 透過注入 `provider` 物件，不寫死特定廠商。

3. 支援 mock/fake provider contract tests  
   - `test-helpers.js` 提供可控制成功/失敗的 mock provider。

4. 祕密不暴露前端  
   - `ai-provider-config.js` 僅允許從 `process.env` 讀取 provider 設定。
   - 若非後端環境（無 `process.env`）會直接拋錯。

5. durationMs 標準化  
   - 在 `provider-adapter.js` 統一量測請求耗時。

## 測試與結果

執行指令：

```bash
node --test "C:\Users\r0462\.openclaw\workspace\claw-lucky\js\services\ai\__tests__\*.test.js"
```

結果摘要：

- tests: 5
- pass: 5
- fail: 0
- suites: 0
- cancelled: 0
- skipped: 0
- todo: 0

覆蓋項目：

- Adapter contract test
- normalized error mapping test
- retryability classification test
- mock provider success test
- mock provider failure test

## 已知限制

- 目前未串接正式 Provider（依需求刻意不串接）。
- 目前僅提供 Adapter 層與測試；實際 orchestrator/worker 串接在後續 Task。

