# ADR-003: Wallpaper Generation Service Architecture

Status

Accepted

Date

2026-07-12

Authors

claw-lucky Team

---

# Context

AI Lucky Wallpaper 需要建立一個可維護且可測試的 Business Layer。

系統必須：

- 不直接依賴 AI Provider
- 不直接依賴 Database Query
- 不直接組 Prompt
- 能夠支援未來新增 Provider
- 能夠支援 Job Queue
- 能夠支援 Worker

因此需要建立統一的 Generation Service。

---

# Decision

採用 Orchestration Service Pattern。

Generation Service 僅負責協調流程。

Business Flow：

Generation Request

↓

Validator

↓

Prompt Registry

↓

Provider Adapter

↓

Repository

↓

Response DTO

Generation Service 不負責：

- SQL
- Prompt Template
- Provider API
- Image Storage
- Frontend

---

# Responsibilities

## Generation Service

負責：

- Business Flow
- Orchestration
- Error Mapping
- Dependency Coordination

不得：

- 實作 SQL
- 呼叫 Supabase Query
- 呼叫 Provider SDK
- 建立 Prompt

---

## Repository

負責：

Persistence。

不得：

包含：

- Business Rules
- Prompt Logic
- AI Logic

---

## Validator

負責：

Input Validation。

可供：

- API
- Worker
- CLI

共用。

---

## Response DTO

統一：

Success

Failure

Response。

Frontend 不依賴 Provider。

---

# Consequences

優點：

- Business Layer 可測試
- Mock 容易
- Provider 可替換
- Prompt 可替換
- Database 可替換
- 容易支援 Worker

缺點：

- 初期檔案數增加
- 需要 Dependency Injection

接受此成本。

---

# Alternatives Considered

## Service 直接呼叫 Provider

Rejected。

原因：

Business Layer 將直接耦合 Provider。

---

## Service 直接操作 Supabase

Rejected。

原因：

Business Logic 與 Persistence 耦合。

---

## Prompt 直接在 Service 組裝

Rejected。

原因：

Prompt 無法版本管理。

---

# Related ADR

- ADR-001 Provider Adapter
- ADR-002 Prompt Registry

---

# Related Tasks

- P1-INF-03
- P1-INF-04
- P1-BIZ-01

---

# Future Work

未來：

Generation Service

可加入：

- Job Queue
- Retry Policy
- Event Bus
- Domain Events

目前：

維持 MVP 架構。