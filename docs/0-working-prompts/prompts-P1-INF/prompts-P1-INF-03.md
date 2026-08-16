# Prompt Archive: P1-INF-03

## 原始需求（整理版）

請實作 `P1-INF-03`。

### Goal

建立 Provider Adapter 抽象層與錯誤正規化。

### 核心範圍

- adapter contract
- provider error normalize
- retryability 分類
- mock provider 驗證

### 測試要求

- contract tests
- success / failure mock tests
- error mapping tests

### 限制

- 不直接耦合 business layer 到 provider SDK
- 不要 commit / push

