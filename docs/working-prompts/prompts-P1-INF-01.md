# Prompt Archive: P1-INF-01

## 原始需求（整理版）

請實作 `P1-INF-01`。

### Goal

建立 AI Lucky Wallpaper Phase 1 核心資料表 migration。

### 核心範圍

- 建立 core tables（generation / jobs / usage / cost）
- 建立 prompt registry 相關 schema（prompt_versions）
- 補齊必要 constraints / indexes / FK

### 驗證重點

- migration 可在乾淨 DB 執行
- schema 與約束存在且正確

### 限制

- 不要做超出 INF-01 範圍的 API / UI / worker
- 不要 commit / push

