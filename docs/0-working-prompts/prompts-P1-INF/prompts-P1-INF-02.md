# Prompt Archive: P1-INF-02

## 原始需求（整理版）

請實作 `P1-INF-02`。

### Goal

建立 Wallpaper 核心資料的 RLS 與 Storage Policy。

### 核心範圍

- owner-only read
- 限制前端直接寫入敏感 status
- wallpapers bucket 非公開策略

### 驗證重點

- non-owner 讀取被拒絕
- client 無法直接改成功狀態
- storage policy 生效

### 限制

- 不做 business workflow / frontend
- 不要 commit / push

