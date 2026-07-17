# Prompt Archive: P1-BIZ-04

## 原始需求（整理版）

請實作 `P1-BIZ-04`。

### Goal

建立 Generation Status / Progress API（供前端 polling）。

### 必要 endpoints

- `GET /api/wallpapers/generations/{id}`
- `GET /api/wallpapers/generations/{id}/progress`

### 核心要求

- owner-only query
- status mapping（generation + job）
- normalized error DTO
- polling contract（recommendedPollIntervalMs + terminal）

### 測試

- owner pending/processing/succeeded/failed
- non-owner reject
- not found
- query failure
- terminal polling 行為
- payload 完整性

### 驗證

- 必跑 `.\scripts\verify-local.ps1`
- 需有 module load smoke test
- 產出 review package
- 不要 commit / push

