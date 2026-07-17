Operational Readiness
「這個系統是不是已經具備維運能力？」
這和 Milestone 1（AI Pipeline）與 Milestone 2（End-to-End Flow）不一樣。

驗收一：Observability
## Observability

- [Y] 每個 Generation 都有 correlationId
- [Y] correlationId 全流程一致
- [Y] Structured Logging 已建立
- [Y] Error Trace 已建立
- [Y] Business Flow Trace 已建立

驗收二：Logging(Security)
## Logging

- [Y] Logger 使用 Structured Log
- [Y] 不輸出 Prompt 全文
- [Y] 不輸出 API Key
- [Y] 不輸出 Secret
- [Y] 不輸出 User ID

驗收三：Traceability
任何Generation是否可以一路追?是不是同一個correlationId?
Submit
↓
Generation
↓
Provider
↓
Success
↓
Status API
↓
Polling
↓
Presenter

驗收四：Business Flow Tracing
這一項不用真人叫Copilot跑Simulation。
[Y]Business Flow Tracing
[Y]Failure/Time-out Tracing

驗收五：Diagnostics

## 問copilot:如果 Provider Timeout，要怎麼查？
可以，現在用 Observability log 這樣查：

先用關鍵字找失敗事件
event = generation_orchestrator_generation_failed
payload.error.errorCode = PROVIDER_TIMEOUT
拿到該筆的 correlationId 後，串整條鏈路
依同一個 correlationId 查：

generation_orchestrator_started
generation_service_started
generation_service_provider_failure
generation_orchestrator_generation_failed
看診斷欄位

correlationId
errorCode
timestamp
-（若有）jobId, provider, model

目前限制：前端回應 DTO 沒有帶 correlationId，所以實務上通常用「發生時間 + errorCode=PROVIDER_TIMEOUT」先定位，再回查同時間窗的 correlationId。
如果你要，我可以下一步幫你補一個「查 Timeout 的標準操作步驟」到 docs/acceptance/Mileston-3.md。

驗收六：Quality
## Quality

- [Y] Syntax PASS
- [Y] Unit Tests PASS
- [Y] Smoke Test PASS
- [Y] Business Flow Simulation PASS

驗收七：Architecture
## Architecture

- [Y] Logging Layer 與 Business Layer 解耦
- [Y] Correlation 不修改 Business Rule
- [Y] Observability 不修改 DTO
- [Y] Observability 不修改 API Contract

驗收八：Capability
## Capability

- [Y] Correlation
- [Y] Structured Log
- [Y] Error Trace
- [Y] Business Trace
- [Y] Sensitive Data Masking

驗收九：Operational Readiness (milestone 3 新增)
## Operational Readiness

- [Y] 發生錯誤可追蹤
- [Y] 可定位 Provider Failure
- [Y] 可定位 Generation
- [Y] 可定位 Job
- [Y] 可定位 Prompt Version



驗收十：人工驗收（PM）
問 Copilot：
請示範一個 Provider Timeout 的完整 Trace。


## Provider Timeout 完整 Trace（範例）

以下示範同一筆請求在 Timeout 時，如何用 `correlationId` 串起完整鏈路。

### 1) Orchestrator 開始

```json
{"level":"info","event":"generation_orchestrator_started","correlationId":"gen_a1b2c3d4","timestamp":"2026-07-15T12:00:00.000Z","payload":{"status":"started","createdAt":"2026-07-15T12:00:00.000Z"}}

### 2) Generation Service 開始
{"level":"info","event":"generation_service_started","correlationId":"gen_a1b2c3d4","timestamp":"2026-07-15T12:00:00.050Z","payload":{"status":"started","createdAt":"2026-07-15T12:00:00.050Z"}}

### 3) Provider Timeout（Service 層）
{"level":"error","event":"generation_service_provider_failure","correlationId":"gen_a1b2c3d4","timestamp":"2026-07-15T12:00:30.120Z","payload":{"error":{"correlationId":"gen_a1b2c3d4","errorCode":"TIMEOUT","timestamp":"2026-07-15T12:00:30.120Z"},"provider":"mock-provider","model":"mock-model","status":"failed"}}

### 4) Workflow 失敗（Orchestrator 層）
{"level":"error","event":"generation_orchestrator_generation_failed","correlationId":"gen_a1b2c3d4","timestamp":"2026-07-15T12:00:30.180Z","payload":{"jobId":"job-001","error":{"correlationId":"gen_a1b2c3d4","errorCode":"PROVIDER_TIMEOUT","timestamp":"2026-07-15T12:00:30.180Z"},"status":"failed"}}

### 5) 前端收到的 Normalized Error（對使用者）
{
  "ok": false,
  "error": {
    "code": "PROVIDER_TIMEOUT",
    "message": "Provider request timed out.",
    "retryable": true
  }
}

### Trace 檢查重點
用同一個 correlationId 串查全鏈路
確認 errorCode 最終收斂為 PROVIDER_TIMEOUT
確認無洩漏 Provider 原始 exception / secret / API key

驗收十一：Release Decision
## Release Decision

Release Readiness

GO

Reason
- Architecture Approved
- Observability Complete
- Business Trace Complete
- Tests Passed

Current Limitation

Client Response尚未回傳 Correlation ID。

目前 Incident Investigation需依
Timestamp+ErrorCode+Generation Log定位。

Future將Correlation ID加入Response Header：
X-Correlation-Id