# Milestone 01 Capability Questions

1. 請說明目前 Generation Service 如何取得 Prompt？是否所有 Prompt 都來自 Prompt Registry？是否仍有任何 Prompt 寫死在 Business Layer？
2. 如果今天把 Gemini 換成 OpenAI，需要修改哪些檔案？
3. Generation Orchestrator 成功時完整流程是什麼？
4. Frontend 最後拿到哪些欄位？
5. 哪一層可以直接呼叫 AI Provider？
6. 目前有哪些測試？
7. 如果今天把 Gemini 換成 OpenAI，需要修改哪些檔案？

## Answers

1. **Generation Service 如何取得 Prompt？是否都來自 Prompt Registry？是否有寫死 Prompt？**  
   - `generation-service` 透過 `promptRegistryLoader.loadActivePrompt(promptType)` 取得 Prompt。  
   - 來源是 Prompt Registry Loader：要嘛來自 `prompt_versions` active 資料，要嘛來自其集中 fallback。  
   - Business Layer（production code）沒有寫死 prompt template；只有 Prompt Registry fallback 與測試 mock 有固定文字。

2. **Gemini 換 OpenAI 要改哪些檔案？**  
   - 新增/替換 provider 實作（建議 `js/services/ai/providers/openai-provider.js`）。  
   - 新增 provider 注入組裝點（目前尚未落地 runtime wiring，建議如 `js/services/ai/provider-factory.js`）。  
   - 後端環境變數改為 OpenAI（`AI_PROVIDER_NAME`、`AI_PROVIDER_MODEL`、`AI_PROVIDER_ENDPOINT`、`AI_PROVIDER_API_KEY`）。  
   - 建議更新對應測試（`js/services/ai/__tests__/*`、`js/services/wallpaper/__tests__/generation-service.test.js`）。  
   - 通常不需改 `generation-service` / `generation-orchestrator` / `prompt` 模組。

3. **Generation Orchestrator 成功完整流程**  
   - Validate User → Check Daily Usage → Get Generation Cost  
   - Create Job(Pending) → Mark Running  
   - Call `generationService.createWallpaperGeneration`  
   - Deduct Points（成功才扣）  
   - Record Daily Usage Success  
   - Mark Job Success  
   - 回傳成功 DTO。

4. **Frontend 最後拿到哪些欄位？**  
   - 成功 `ok: true`：  
     `generationId`, `status`, `provider`, `model`, `imageUrl`, `promptVersion`, `durationMs`, `createdAt`, `jobId`, `jobStatus`, `deductedPoints`, `usageDate`, `usageCount`。  
   - 失敗 `ok: false`：  
     `error.code`, `error.message`, `error.retryable`, `error.details`。

5. **哪一層可直接呼叫 AI Provider？**  
   - 只有 Provider Adapter 底下的 provider 實作層可直接呼叫。  
   - Frontend / Orchestrator / Generation Service / Repository 都不應直接呼叫。

6. **目前有哪些測試？**  
   - Provider Adapter 測試（contract、error mapping、retryability、mock success/failure）。  
   - Prompt Registry Loader 測試（active success、missing type、no active fallback、multiple active、防呆空 template、db failure、version）。  
   - Wallpaper 層測試：  
     - Orchestrator（Happy Path、Daily Limit、Success Deduct、Failure No Deduct、Job Failure、Repository Failure、Points Deduction Failure）  
     - Generation Service（Happy Path、Provider Timeout、Provider Failure、Prompt Missing、Invalid Response、Image Generation Failure）。  
   - `verify-local.ps1` 最近結果為全通過。

7. **Gemini 換 OpenAI 要改哪些檔案？（重複題）**  
   - 同第 2 題。


# Capability Acceptance

## Prompt Registry

- [X ] Prompt 不寫死

## Provider

- [X ] Provider 可替換

## DTO

- [X ] Frontend 不依賴 Provider

## Business

- [X ] 成功才扣點

## Architecture

- [X ] Provider 只有 Adapter 能呼叫

## Tests

- [X ] Unit Tests 全 PASS


