# Prompt Archive: P1-BIZ-02

## 原始需求（整理版）

請實作 `P1-BIZ-02`。

### Goal

建立 Wallpaper Generation Orchestrator，協調完整生成交易流程。

### 必要流程

Validate User  
→ Check Daily Usage  
→ Create Job  
→ Call Generation Service  
→ Update Job Status  
→ Success 才扣點

### 必要規則

- 超過 Daily Limit 立即返回
- Job status: Pending / Running / Success / Failed
- failure 不扣點
- 全部錯誤 normalized

### 測試

- happy path
- daily limit
- success deduct points
- failure no deduct
- job/repository failure

### 驗證

- 必跑 `.\scripts\verify-local.ps1`
- 不要 commit / push

