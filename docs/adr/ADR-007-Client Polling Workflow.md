# ADR-007: Client Polling Workflow

Status

Accepted

Date

2026-07-15

Authors

claw-lucky Team

---

## Context

AI Lucky Wallpaper 採用非同步 AI 圖片生成。

由於 AI 生圖通常需要數秒甚至數十秒，因此前端無法在單一 HTTP Request 中等待圖片完成。

需要建立一套統一的 Client Workflow，使前端：

- 建立 Generation
- 查詢生成狀態
- 在完成時停止 Polling
- 呈現最終結果

同時保持：

- Provider 無關
- UI Framework 無關
- HTTP Client 可替換

---

## Decision

Client 採用三層架構：

```text
UI
    │
    ▼
Wallpaper Generation Client
    │
    ▼
Wallpaper Polling Service
    │
    ▼
Wallpaper HTTP API Client
    │
    ▼
Generation Status API
```

Result 由：

```text
Wallpaper Result Presenter
```

統一整理後交給 UI。

---

## Responsibilities

### Wallpaper Generation Client

負責：

- 建立 generation
- 啟動 polling
- 收集結果
- 將結果交給 presenter

不得：

- 操作 DOM
- 呼叫 Provider
- 組 Prompt
- 查詢資料庫

---

### Wallpaper Polling Service

負責：

- 根據 API 持續 polling
- 判斷 terminal
- 控制 polling interval
- 回傳最終結果

不得：

- 自行決定 polling interval
- 修改 generation 狀態
- 操作 UI

---

### HTTP API Client

負責：

- POST generation
- GET generation progress
- HTTP request/response mapping
- Normalized Error Mapping

不得：

- 包含 Business Rule
- 包含 Polling Rule

---

### Result Presenter

負責：

將：

- Success
- Failure

轉成：

UI 可直接使用的 Result Model。

不得：

- 呼叫 API
- 修改資料
- 呼叫 Provider

---

## Polling Contract

Client 必須依照 API 回傳：

```text
recommendedPollIntervalMs
```

控制下一次 polling。

Client 不得：

```javascript
setTimeout(...,1500)
```

硬編碼 polling interval。

---

Polling 必須遵守：

```text
terminal = false

↓

Continue Polling
```

```text
terminal = true

↓

Stop Immediately
```

不得：

Infinite Polling。

---

## Result Contract

成功至少包含：

- imageUrl
- provider
- promptVersion

失敗：

全部使用：

Normalized Error DTO。

不得：

直接顯示：

Provider Exception。

---

## Error Handling

Client 僅處理：

- GENERATION_FAILED
- PROVIDER_FAILURE
- PROVIDER_TIMEOUT
- DAILY_LIMIT_EXCEEDED
- UNAUTHORIZED_GENERATION_ACCESS
- POLLING_FAILURE
- INVALID_STATUS_RESPONSE

所有 Error 必須由 API 或 Business Layer 正規化。

Client 不得解析 Provider Error。

---

## Layer Boundary

Client：

只能：

呼叫：

Generation API

Status API

不得：

- 查詢資料庫
- 呼叫 Provider
- 操作 Repository
- 使用 Service Role Key

---

## Consequences

### Benefits

- Frontend 與 AI Provider 解耦
- UI Framework 可替換
- Polling 規則集中管理
- Presenter 可重用
- HTTP Client 可替換
- API Contract 穩定

### Costs

- Client Layer 增加
- Polling Service 增加
- Presenter 增加

接受此成本。

---

## Alternatives Considered

### UI 直接 Poll API

Rejected。

原因：

Business Flow 散落於 UI。

---

### UI 自行控制 Polling Interval

Rejected。

原因：

容易與 API 規則不一致。

---

### Long Polling

Rejected for MVP。

原因：

AI 生圖時間不可預測。

---

### WebSocket / SSE

Deferred。

原因：

Polling 已足夠支援 MVP。

未來可在不修改 Client Contract 下替換。

---

## Deferred Improvements

不阻擋 MVP：

- AbortController
- Retry Policy
- Exponential Backoff
- WebSocket
- Server-Sent Events
- Offline Resume
- Visibility API（背景頁降低 polling）

---

## Related ADRs

- ADR-003 Generation Service
- ADR-004 Generation Orchestrator
- ADR-005 AI Generation Pipeline
- ADR-006 Generation Status API

---

## Related Tasks

- P1-BIZ-05
- P1-BIZ-06
- P2-BIZ-01

---

## Related Reviews

- docs/development/reviews/P1-BIZ-05.md

---

## Technical Debt

本 ADR 不新增 Technical Debt。

沿用：

- TD-001 Prompt Version Datatype Mismatch

---

## Final Decision

AI Lucky Wallpaper 採用獨立的 Client Polling Workflow。

Client 僅透過 Generation API 與 Status API 完成整個生成流程。

Polling Interval、Terminal 判斷、Result Mapping 與 Error Handling 全部由統一 Contract 控制，不得分散於 UI 或直接依賴 AI Provider。