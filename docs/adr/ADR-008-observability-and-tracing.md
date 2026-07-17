# ADR-008: Observability and Tracing

Status

Accepted

Date

2026-07-15

Authors

claw-lucky Team

---

## Context

AI Lucky Wallpaper 已完成：

- Generation Service
- Generation Orchestrator
- AI Generation Pipeline
- Generation Status API
- Client Generation Workflow

系統已具備完整的 AI Generation Flow。

然而，若缺乏統一的 Observability，將難以：

- 追蹤單一 Generation
- 診斷 Provider Failure
- 分析 Performance
- 協助客服定位問題
- 建立後續 Metrics

因此需要建立統一的 Tracing 與 Structured Logging。

---

## Decision

採用 Correlation ID + Structured Logging。

每一個 Generation Flow 必須擁有唯一：

```text
correlationId
```

並於整個流程中保持一致。

Tracing Flow：

```text
Client

↓

Generation Orchestrator

↓

Generation Service

↓

Provider Adapter

↓

Status API

↓

Client Polling

↓

Result
```

所有 Log 必須能以同一個 correlationId 串聯。

---

## Correlation ID Policy

每一筆 Generation：

建立：

```text
correlationId
```

之後所有：

- Service
- Logger
- Error
- Trace

皆必須沿用同一個 ID。

不得：

重新產生新的 Correlation ID。

---

## Structured Logging

Logger 必須輸出結構化資料。

至少包含：

- correlationId
- generationId
- jobId
- provider
- model
- promptVersion
- status
- durationMs
- timestamp

不得依賴自由格式文字作為主要資訊來源。

---

## Sensitive Data Policy

Logger 不得輸出：

- Prompt 全文
- Prompt Template
- User ID
- Access Token
- Refresh Token
- API Key
- Secret

若需要記錄：

必須遮罩或移除。

例如：

```text
prompt: [REDACTED]
```

---

## Error Tracing

所有 Normalized Error 必須保留：

- correlationId
- errorCode
- timestamp

不得直接記錄：

- Provider Stack Trace
- SQL Error
- Internal Exception

Provider 原始例外僅允許在內部除錯環境使用。

---

## Layer Responsibilities

### Correlation ID

負責：

- 建立唯一 Trace ID
- 傳遞整個 Flow

不得：

修改 Business Logic。

---

### Generation Logger

負責：

- Structured Log
- Sensitive Data Masking
- Event Logging

不得：

包含 Business Rule。

---

### Generation Tracing

負責：

- Success Trace
- Failure Trace
- Performance Trace

不得：

修改 Generation 狀態。

---

## Trace Events

至少支援：

- GenerationStarted
- GenerationSubmitted
- GenerationSucceeded
- GenerationFailed
- ProviderRequestStarted
- ProviderRequestFinished
- ProviderTimeout
- PollingStarted
- PollingFinished

事件名稱需保持穩定，不得隨意更改。

---

## Observability Contract

任何 Generation Flow 至少應能回答：

- 哪一位使用者發起（遮罩後）
- 哪一個 Generation
- 哪一個 Job
- 使用哪個 Provider
- 使用哪個 Model
- 使用哪個 Prompt Version
- 花費多久
- 最終狀態
- 若失敗，Error Code 為何

---

## Consequences

### Benefits

- 問題容易定位
- 客服可依 Correlation ID 查詢
- Provider Failure 易分析
- Performance 可統計
- 未來容易串接 Metrics

### Costs

- 增加 Logging Layer
- Trace Data 增加
- Correlation ID 傳遞成本

接受此成本。

---

## Alternatives Considered

### console.log

Rejected。

原因：

無法結構化。

---

### 每個 Service 自行產生 Log

Rejected。

原因：

Correlation 無法串聯。

---

### 不建立 Correlation ID

Rejected。

原因：

無法追蹤跨 Service Flow。

---

## Deferred Improvements

不阻擋 MVP：

- OpenTelemetry
- Metrics Export
- Distributed Tracing
- Trace Sampling
- Log Level Policy
- X-Correlation-Id Response Header
- Dashboard Integration
- Alert Rule

---

## Related ADRs

- ADR-003 Generation Service
- ADR-004 Generation Orchestrator
- ADR-005 AI Generation Pipeline
- ADR-006 Generation Status API
- ADR-007 Client Generation Workflow

---

## Related Tasks

- P1-BIZ-06
- P2-OPS-01

---

## Related Reviews

- docs/development/reviews/P1-BIZ-06.md

---

## Technical Debt

本 ADR 不新增 Technical Debt。

沿用：

- TD-001 Prompt Version Datatype Mismatch

---

## Final Decision

AI Lucky Wallpaper 採用 Correlation ID 與 Structured Logging 作為統一 Observability 基礎。

所有 Generation Flow 必須保持完整 Trace，並以 Correlation ID 串聯所有 Service、Error 與 Event。

Observability 不得改變既有 Business Flow，僅提供診斷、追蹤與維運能力。