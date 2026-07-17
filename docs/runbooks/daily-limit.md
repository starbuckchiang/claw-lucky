# Daily Limit Runbook

## 適用情境

- 前端收到：`error.code = DAILY_LIMIT_EXCEEDED`

## 快速檢查

1. 以時間窗找 `generation_orchestrator_daily_limit_failed` 事件。
2. 取得 `correlationId` 確認請求進入點。
3. 確認是否有後續 generation/polling 行為（正常情況不應繼續）。

## 預期行為

- API 應直接回 `DAILY_LIMIT_EXCEEDED`
- 不應建立新的 generation job
- 不應進入 provider 呼叫

## 常見誤判

- 使用者時區認知與系統日界線不同
- 舊前端重試邏輯未正確停止（需確認 client 版本）

## 升級條件

- 大量使用者同時異常觸發 daily limit
- 與預期成功次數明顯不一致

