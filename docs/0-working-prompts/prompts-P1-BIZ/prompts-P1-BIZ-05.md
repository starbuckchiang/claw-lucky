# Prompt Archive: P1-BIZ-05

## 原始需求（整理版）

請實作 `P1-BIZ-05`。

### Goal

完成 Wallpaper Generation Client Flow（submit → polling → result）。

### 必要元件

- wallpaper-generation-client
- wallpaper-polling-service
- wallpaper-result-presenter

### Polling 規則

- 完全依 API 回傳 `recommendedPollIntervalMs`
- `terminal = true` 立即停止
- 不可 infinite loop

### 錯誤處理

- Generation Failed
- Provider Failure
- Timeout
- Daily Limit
- Unauthorized
- Polling Failure

### 測試

- happy path
- polling until success/failure
- daily limit
- unauthorized
- terminal stop

### 驗證

- 必跑 `.\scripts\verify-local.ps1`
- module load smoke test
- 不要 commit / push

