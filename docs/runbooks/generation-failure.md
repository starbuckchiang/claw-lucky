# Generation Failure Runbook

## 適用情境

- 前端收到：`error.code = GENERATION_FAILURE`
- 或 orchestrator 記錄：`generation_orchestrator_generation_failed`

## 快速檢查

1. 從失敗事件取得 `correlationId`、`jobId`。
2. 以 `correlationId` 追整條流程：
   - `generation_orchestrator_started`
   - `generation_service_started`
   - service 層失敗事件（例如 `provider_failure` / `prompt_unavailable` / `persistence_failure`）
   - `generation_orchestrator_generation_failed`
3. 看 `payload.error.errorCode` 判斷根因（如 `PROVIDER_FAILURE`、`PROMPT_NOT_FOUND`、`IMAGE_GENERATION_FAILURE`）。

## 判斷準則

- `GENERATION_FAILURE` 是 orchestrator 對外包裝碼
- 根因以內層 `errorCode` 為準

## 升級條件

- 相同根因連續發生（例如 5 分鐘內 > 10 次）
- 涉及資料持久化失敗（`IMAGE_GENERATION_FAILURE`）且無法自動恢復

