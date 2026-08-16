# Prompt Archive: P1-INF-04

## 原始需求（整理版）

請實作 `P1-INF-04`。

### Goal

建立 Prompt Registry Loader，集中管理 prompt 載入與 fallback。

### 核心範圍

- 讀取 active prompt（依 prompt_type）
- fallback template 策略
- 回傳 prompt version
- cache（若有）行為一致

### 測試要求

- active prompt success
- prompt missing / fallback
- invalid template / query failure

### 限制

- 不把 prompt 硬編碼散落在 business layer
- 不要 commit / push

