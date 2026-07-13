# ADR-005: AI Generation Pipeline

Status

Accepted

Date

2026-07-13

Authors

claw-lucky Team

---

# Context

AI Lucky Wallpaper 已完成：

- Provider Adapter
- Prompt Registry
- Generation Service
- Generation Orchestrator

目前需要正式定義：

AI Generation Pipeline 的輸入、輸出與責任邊界。

未來：

- Gemini
- OpenAI
- Claude
- Azure OpenAI

皆須遵守相同 Pipeline。

---

# Decision

採用統一的 AI Generation Pipeline。

Business Layer 永遠只與：

Generation Service

互動。

Generation Service 不直接：

- 呼叫 Provider SDK
- 組 Prompt
- 操作 Database

所有 Provider 必須透過：

Provider Adapter。

---

# Pipeline

```text
Generation Orchestrator
        │
        ▼
Generation Service
        │
        ▼
Prompt Registry
        │
        ▼
Prompt Context
        │
        ▼
Provider Adapter
        │
        ▼
AI Provider
        │
        ▼
Normalized Image Result
        │
        ▼
Repository
        │
        ▼
Response DTO
```

---

# Prompt Contract

Generation Service

不得自行建立 Prompt。

Prompt 必須：

由：

Prompt Registry

提供。

流程：

Prompt Version

↓

Template

↓

Variables

↓

Rendered Prompt

↓

Provider

Business Layer

不得知道 Prompt Template。

---

# Provider Contract

Provider Adapter

必須提供：

generateWallpaper(input)

輸入：

- prompt
- promptVersion
- metadata

輸出：

- imageUrl
- provider
- model
- providerRequestId
- durationMs

Provider 原生 SDK

不得直接暴露給 Business Layer。

---

# Image Result Contract

Generation Service

必須回傳統一 DTO。

至少：

- generationId
- provider
- model
- imageUrl
- promptVersion
- durationMs
- status
- createdAt

Frontend

不得依賴：

Gemini

OpenAI

Claude

回傳格式。

---

# Error Contract

所有 Provider Error

必須：

Normalize。

至少：

- PROVIDER_TIMEOUT
- PROVIDER_FAILURE
- INVALID_RESPONSE
- IMAGE_GENERATION_FAILURE

Provider Exception

不得直接回傳。

---

# Repository Contract

Repository

只負責：

Persistence。

不得：

- Retry
- Prompt
- Provider
- AI Logic

---

# Extensibility

未來：

Pipeline

可支援：

- Face Swap
- Multi Image
- Streaming
- Vision
- Video Generation

Business Layer

不得修改。

僅需：

新增：

Provider Adapter

即可。

---

# Consequences

Benefits

- Provider 可替換
- Prompt 可版本化
- Frontend 不依賴 Provider
- Business Layer 穩定
- Repository 不受 AI 影響

Costs

- 增加 Adapter Layer
- DTO 維護成本增加

接受此成本。

---

# Alternatives Considered

## Business Layer 直接呼叫 Gemini

Rejected。

原因：

Provider 耦合。

---

## Prompt 直接寫在程式

Rejected。

原因：

Prompt 無法版本管理。

---

## Frontend 直接依 Provider 回傳

Rejected。

原因：

Provider 更換成本過高。

---

# Related ADR

- ADR-001 Provider Adapter
- ADR-002 Prompt Registry
- ADR-003 Generation Service
- ADR-004 Generation Orchestrator

---

# Related Tasks

- P1-INF-03
- P1-INF-04
- P1-BIZ-01
- P1-BIZ-02
- P1-BIZ-03

---

# Technical Debt

沿用：

TD-001

不新增。

---

# Final Decision

AI Lucky Wallpaper 採用統一的 AI Generation Pipeline。

未來所有 AI Provider、

Prompt、

Image Generation、

Business Layer、

Frontend

皆必須遵守本 Pipeline Contract。

不得跨越 Layer 直接互相依賴。