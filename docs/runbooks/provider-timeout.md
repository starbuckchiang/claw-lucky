# Provider Timeout Runbook

## 適用情境

- 前端收到：`error.code = PROVIDER_TIMEOUT`
- 或 log 出現：`generation_service_provider_failure`

## 快速檢查

1. 先找同時間窗內 `errorCode = PROVIDER_TIMEOUT` 或 `TIMEOUT` 的事件。
2. 取得 `correlationId`。
3. 用同一 `correlationId` 串查完整鏈路：
   - `generation_orchestrator_started`
   - `generation_service_started`
   - `generation_service_provider_failure`
   - `generation_orchestrator_generation_failed`
4. 確認 provider/model 與 timeout 發生時間點。

## 預期結果

- 失敗會被正規化成 `PROVIDER_TIMEOUT`
- 不應外洩 provider 原始 exception、API key、secret

## 升級條件

- 同 provider/model 在短時間大量 timeout
- timeout 持續超過 15 分鐘
- 影響範圍跨多個 user / 多個 job

