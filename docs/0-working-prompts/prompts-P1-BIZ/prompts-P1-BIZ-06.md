# Prompt Archive: P1-BIZ-06

## 原始需求（整理版）

請實作 `P1-BIZ-06`。

### Goal

建立 AI Wallpaper Generation Observability，讓每次 generation 可追蹤。

### 必要元件

- generation-tracing
- correlation-id
- generation-logger

### 必要追蹤欄位

- correlationId
- generationId
- jobId
- provider
- model
- promptVersion
- status
- durationMs
- createdAt

### 規則

- 所有 log 必須包含 correlationId
- 不可輸出完整 prompt / 敏感資訊 / secret / API key
- normalized error 需保留 correlationId + errorCode + timestamp

### 測試

- correlationId 建立與傳遞
- logger 含 correlationId
- provider failure traceable
- normalized error trace fields

### 驗證

- 必跑 `.\scripts\verify-local.ps1`
- module load smoke test
- 更新 review package（含 Business Flow Tracing）
- 不要 commit / push

