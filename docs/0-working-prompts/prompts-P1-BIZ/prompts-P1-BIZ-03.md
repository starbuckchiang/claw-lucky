# Prompt Archive: P1-BIZ-03

## 原始需求（整理版）

請實作 `P1-BIZ-03`。

### Goal

完成 AI Wallpaper Generation pipeline 串接（Orchestrator → Service → Prompt Registry → Provider Adapter → Result）。

### 必要責任

- Generation Service 取得 active prompt、建 prompt context、呼叫 adapter、回 normalized response
- Provider Adapter 回 image result contract

### 必要錯誤

- PROMPT_NOT_FOUND
- PROVIDER_TIMEOUT
- PROVIDER_FAILURE
- INVALID_RESPONSE
- IMAGE_GENERATION_FAILURE

### 測試

- happy path
- provider timeout/failure
- prompt missing
- invalid response

### 驗證

- 必跑 `.\scripts\verify-local.ps1`
- 不要 commit / push

