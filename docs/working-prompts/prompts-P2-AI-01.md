# Prompt Archive: P2-AI-01

## 原始需求（整理版）
請實作 `P2-AI-01`，並整理存檔至 `working-prompts`。

## 開始前閱讀
- `specs/001-ai-lucky-wallpaper/spec.md`
- `specs/001-ai-lucky-wallpaper/tasks.md`
- `docs/development/context.md`
- `ADR-001 Provider Adapter`
- `ADR-002 Prompt Registry`
- `ADR-003 Generation Service`
- `ADR-004 Generation Orchestrator`
- `ADR-005 AI Generation Pipeline`
- `ADR-006 Generation Status API`
- `ADR-007 Client Generation Workflow`
- `ADR-008 Observability and Tracing`

## 範圍限制
只允許完成：
- `P2-AI-01`

不得提前開始：
- `P2-AI-02`
- `P2-STORAGE-01`
- `P2-HISTORY-01`

## Goal
將 Mock AI Provider 替換為可呼叫的真實 AI Image Provider（第一版 Gemini），完全沿用既有 Provider Adapter 架構，不修改 Business Layer。

## Scope
僅完成 Provider Integration。不得做 Storage/Download/History/Share/Face Swap/Queue/Worker。

## Supported Provider
第一版 Gemini，且 Provider 設計需可擴充 OpenAI Images/Azure OpenAI/Stability/Replicate。不得修改 Generation Service。

## Architecture
不可破壞既有鏈路。僅 Provider Adapter 可以知道 Gemini SDK。不得在 Generation Service 直接 new Gemini client。

## Configuration
必須環境變數化：
MODEL / TIMEOUT / MAX_RETRY / IMAGE_SIZE / SAFETY_LEVEL / API KEY。

## Prompt
沿用 Prompt Registry。Provider 僅接受 Rendered Prompt，不得重組 prompt。

## Provider Response
需 Normalized：
provider / model / finishReason / image / usage(若支援) / durationMs / rawResponse(debug only)。

## Provider Error
需 Normalized：
PROVIDER_TIMEOUT / PROVIDER_RATE_LIMIT / PROVIDER_AUTH_FAILED / PROVIDER_BAD_REQUEST / PROVIDER_UNAVAILABLE / PROVIDER_UNKNOWN。

## Retry
僅 Provider Adapter 可 retry，遵守 MAX_RETRY。Business Layer 不得 retry。

## Observability
保留 correlationId。provider call 必須 structured log。不得記錄 prompt 全文與 secret。

## Security
API KEY 僅 server side。不得出現在 client。不得 commit `.env`。

## Testing
至少涵蓋：
- Mock Gemini Success
- Mock Gemini Timeout
- Mock Gemini Rate Limit
- Mock Gemini Auth Failure
- Mock Gemini Unknown Failure
- Retry Success
- Retry Failure
- Normalized Response
- Normalized Error
- Correlation Propagation

全部 Mock SDK，不可呼叫真實 Gemini。

## Manual Verification
新增 `docs/testing/provider-integration.md`，說明如何用 `USE_REAL_PROVIDER=true` 手動測試真實 Gemini（不自動執行）。

## Local Verification
完成後執行：
- `.\scripts\verify-local.ps1`
- Module Load Smoke Test

## Review Package
更新：
- `review/P2-AI-01-review.md`

至少包含：
Architecture / Provider Integration / Configuration / Response Mapping / Error Mapping / Retry Policy / Observability / Security / Testing / Known Limitations

## Constraints
不得修改：
- `spec.md`
- `plan.md`
- `tasks.md`
- ADR
- Migration
- RLS
- Business Rule
- API Contract
- DTO Shape

## 交付限制
- 完成後停止
- 不要 Commit
- 不要 Push
- 等待 ChatGPT Review