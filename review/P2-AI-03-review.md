# P2-AI-03 Review — Provider Resilience Agent (Gemini Primary / Replicate FLUX Fallback)

Source spec: [docs/working-prompts/prompts-provider resilience agent.md](../docs/working-prompts/prompts-provider%20resilience%20agent.md)

## Scope Delivered

- Deterministic, configuration-driven **Provider Resilience Agent** —
  application workflow, not an LLM agent — unifying:
  primary provider execution → error normalization → fallback-eligibility
  decision → bounded fallback attempt → structured events.
- New **Replicate FLUX provider adapter**, contract-compatible with the
  existing `GeminiProvider` (`generateWallpaper(input)`), including bounded
  polling for asynchronous predictions.
- Smallest possible integration point: the agent exposes
  `generateImage(input)` — the exact contract `wallpaper-provider-adapter.js`
  already expects from its injected `providerAdapter`. It is a **drop-in
  replacement**, so `generation-service.js`, `generation-orchestrator.js`,
  `wallpaper-provider-adapter.js`, Prompt Registry, Storage Service, frontend
  polling contract, and DB RLS are **unchanged**.
- All 9 required test scenarios implemented and passing.
- No live Replicate call made or tested (no token available this session) —
  wiring is env-var-driven only; see Known Limitations.

---

## New Files (Node/CommonJS + Deno ESM twin per module)

| Node (business logic, Node-tested) | Deno ESM twin (`supabase/functions/_shared/lib/`) |
|---|---|
| `js/services/ai/contracts/provider-error.js` | `provider-error.ts` |
| `js/services/ai/fallback/fallback-policy.js` | `fallback-policy.ts` |
| `js/services/ai/predictions/prediction-runner.js` | `prediction-runner.ts` |
| `js/services/ai/providers/replicate-flux-provider.js` | `replicate-flux-provider.ts` |
| `js/services/ai/providers/provider-registry.js` | `provider-registry.ts` |
| `js/services/ai/agents/provider-resilience-agent.js` | `provider-resilience-agent.ts` |

**Deno-only (Replicate REST client, no npm SDK, mirrors `gemini-client.ts`):**
- `supabase/functions/_shared/replicate-client.ts` — `loadReplicateProviderConfig()`
  (returns `null` if `REPLICATE_API_TOKEN` unset — graceful, no-fallback
  default) + `createDenoReplicateClient(apiToken)` (fetch-based REST calls to
  `api.replicate.com/v1`, `Authorization: Bearer` header never logged).

**New tests (all in already-globbed `__tests__` dirs — no glob changes needed):**
- `js/services/ai/__tests__/fallback-policy.test.js`
- `js/services/ai/__tests__/prediction-runner.test.js`
- `js/services/ai/__tests__/replicate-flux-provider.test.js`
- `js/services/ai/__tests__/provider-resilience-agent.test.js`
- `js/services/ai/__tests__/provider-registry.test.js`
- `js/services/ai/__tests__/provider-error-contract.test.js`
- `js/services/wallpaper/__tests__/provider-resilience-integration.test.js`
  (real `generation-orchestrator.js` + `generation-service.js` +
  `wallpaper-provider-adapter.js` + resilience agent, wired together with
  mocked repositories/storage — verifies no duplicate Job completion)

---

## Modified Files

- `supabase/functions/_shared/wallpaper-generate-handler.js` / `.ts` —
  `buildOrchestrator()` now always builds a `primaryAdapter`, conditionally
  builds a `fallbackAdapter` (only if `fallbackProvider` deps supplied),
  wraps both in `createProviderResilienceAgent({ registry, logger })`, and
  passes the **result unchanged** into
  `createWallpaperProviderAdapter({ providerAdapter, storageUploader, logger })`.
- `supabase/functions/wallpaper-generate/index.ts` — added
  `buildFallbackProviderDeps(correlationId)`: returns `{}` when
  `REPLICATE_API_TOKEN` is unset (today's default — no behavior change),
  otherwise constructs `createDenoReplicateClient` + `ReplicateFluxProvider`
  and spreads `{ fallbackProvider, fallbackProviderConfig }` into the deps
  passed to `handleGenerateRequest`.
- `.env.example` — added `REPLICATE_API_TOKEN`, `REPLICATE_MODEL`
  (updated to a model slug, e.g. `black-forest-labs/flux-2-dev`, in a
  follow-up change — originally `REPLICATE_MODEL_VERSION`),
  `REPLICATE_POLL_INTERVAL_MS=2000`, `REPLICATE_MAX_POLL_ATTEMPTS=30`, all
  documented as optional.
- `scripts/verify-local.ps1` — added `node --check` syntax lines for the 6
  new Node modules.

---

## Architecture

```text
buildOrchestrator()
   │
   ├── primaryAdapter  = new ProviderAdapter(GeminiProvider, ...)   (unchanged)
   └── fallbackAdapter = new ProviderAdapter(ReplicateFluxProvider) (only if configured)
                │
                ▼
   createProviderResilienceAgent({ registry: {primary, fallback}, logger })
                │  exposes generateImage(input)  ← same contract as a single ProviderAdapter
                ▼
   createWallpaperProviderAdapter({ providerAdapter: resilienceAgent, storageUploader, logger })
                │                                          ▲
                ▼                                          │ UNCHANGED
   generation-service.js → generation-orchestrator.js → Job/Usage/Points/Storage
```

No second orchestrator was created; the resilience agent sits entirely
**inside** the existing single integration seam.

---

## Fallback Policy (deterministic lookup, `fallback-policy.js`)

- **Never fallback** (business/user-caused): `INVALID_REQUEST`,
  `UNSUPPORTED_WALLPAPER_STYLE`, `UNSUPPORTED_PROMPT_TYPE`, `UNAUTHORIZED`,
  `UNAUTHORIZED_GENERATION_ACCESS`, `DAILY_LIMIT_EXCEEDED`,
  `PROVIDER_AUTH_FAILED`, `PROVIDER_BAD_REQUEST`, `CONTENT_REJECTED`.
- **Fallback-eligible** (infra/provider-level): `PROVIDER_TIMEOUT`,
  `PROVIDER_RATE_LIMIT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_UNKNOWN`,
  `PROVIDER_FAILURE`.
- **Special case**: `PROVIDER_INVALID_RESPONSE` is eligible *unless*
  `diagnostics.finishReason === "SAFETY"` (content-policy block — a business
  decision by the provider, never eligible). This is the one place the
  policy inspects more than just the error code, and it's covered by
  dedicated tests for both branches.

## Error Contract (`provider-error.js` / `toProviderErrorInfo`)

Pure function producing `{provider, model, httpStatus, providerStatus,
providerCode, providerMessage, retryable, correlationId}` from an error
object's own properties — **never discards the original error**; used only
to build structured log payloads (`generation_primary_failed`,
`generation_fallback_failed`).

## Bounded Execution

- Exactly one primary attempt, exactly one fallback provider (never a
  chain), each with its own pre-existing bounded retry (`ProviderAdapter`,
  unmodified).
- `prediction-runner.js`: bounded polling (`pollIntervalMs=2000`,
  `maxPollAttempts=30`, both overridable) via `waitUntilTerminal()`.
  Interface deliberately designed so a future `resolveFromWebhook()` can
  return the same `{terminal, status, output|error, raw}` shape without
  changing `ReplicateFluxProvider`.

## Replicate FLUX Provider

- Same contract shape as `GeminiProvider`: `constructor({config, client,
  logger, predictionRunner, fetchImpl})`, `async generateWallpaper(input)`.
- Downloads the provider's temporary output URL via injected `fetchImpl`
  and base64-encodes it — the temporary Replicate URL is **never** persisted
  or returned as the final wallpaper URL (requirement #11); the normalized
  `{provider, model, durationMs, image:{base64, mimeType}, ...}` result flows
  through the existing Storage Service exactly like a Gemini result.
- Error mapping: `PROVIDER_UNAVAILABLE` (create/download/prediction failed),
  `PROVIDER_TIMEOUT` (polling exhausted), `PROVIDER_INVALID_RESPONSE` (no
  output image).
- Emits `replicate_prediction_created` / `replicate_prediction_processing`.

## Observability & Security

- Structured events implemented: `generation_primary_started`,
  `generation_primary_failed`, `generation_fallback_started`,
  `replicate_prediction_created`, `replicate_prediction_processing`,
  `generation_fallback_succeeded`, `generation_fallback_failed`.
- Verified by test: no API token, `Authorization` header, base64 image
  content, or full prompt text is ever logged.
- `REPLICATE_API_TOKEN` sent only as a `Bearer` header, never logged.

---

## Testing

`.\scripts\verify-local.ps1` → syntax checks clean, **121/121 tests passing**
(up from 91 prior to this task; 30 new tests). All 9 required scenarios
covered:

1. Primary success (fallback never invoked)
2. Fallback-eligible primary failure → fallback invoked & succeeds
3. Non-fallback-eligible failure (e.g. `DAILY_LIMIT_EXCEEDED`) → fallback
   never invoked, original error rethrown unchanged
4. Replicate prediction success
5. Replicate prediction failure → `PROVIDER_UNAVAILABLE`
6. Replicate prediction timeout → `PROVIDER_TIMEOUT`
7. Invalid Replicate output (no image) → `PROVIDER_INVALID_RESPONSE`
8. Both providers failing → final error propagates, no crash
9. No duplicate Job completion — integration test against the **real**
   `generation-orchestrator.js`/`generation-service.js` confirms
   `markSuccess` and `markFailed` are each called exactly once per outcome,
   and `createJob`/`markRunning` exactly once

All Gemini/Replicate calls are mocked; no real network calls made.

### Bug found & fixed during verification

`provider-resilience-integration.test.js` initially passed a single ad-hoc
`{info, error, warn}` object as both the provider-layer logger and the
`generationLogger` param. `generation-service.js` / `generation-orchestrator.js`
actually require the `logInfo`/`logWarn`/`logError` interface produced by
`createGenerationLogger()` — a `TypeError: generationLogger.logInfo is not a
function` surfaced immediately. Fixed by splitting into
`silentProviderLogger()` (plain `info`/`error`, matches `ProviderAdapter`'s
expected shape) and `silentGenerationLogger()` (real
`createGenerationLogger({ sink: () => {} })`). No production code changed —
purely a test-double interface mismatch.

---

## Requirement Compliance (per spec)

| # | Requirement | Status |
|---|---|---|
| 1–4 | Receive request/context, resolve providers, execute primary, normalize error without discarding | ✅ |
| 5–7 | Fallback-policy evaluation, never/only-fallback rules | ✅ |
| 8–10 | Replicate FLUX adapter, async prediction (bounded polling), normalize into existing result contract | ✅ |
| 11 | Never persist temporary Replicate URL as final | ✅ |
| 12 | Preserve frontend polling / job status contract | ✅ (zero changes) |
| 13 | One primary + one fallback, bounded retry/timeout | ✅ |
| 14 | Structured events | ✅ all 7 implemented |
| 15 | No secret/prompt leakage in logs | ✅ tested |
| 16 | 9 unit test scenarios | ✅ all present, passing |
| 17 | Preserve Orchestrator/Prompt Registry/Storage/API contract/RLS | ✅ zero changes to those files |

---

## Known Limitations

- **No live Replicate account/token available this session.** Wiring is
  fully implemented and unit-tested with mocks, but the Replicate REST
  client (`replicate-client.ts`) and `ReplicateFluxProvider` have not been
  exercised against the real Replicate API. With `REPLICATE_API_TOKEN`
  unset (today's default), behavior is byte-for-byte identical to before
  this feature — no fallback is registered, primary errors rethrown
  unchanged.
- Bounded polling only; webhook-based prediction resolution is a follow-up
  (interface already shaped to support it without changing
  `ReplicateFluxProvider`).
- Not yet deployed/tested against a live Supabase Edge Function environment
  in this session (consistent with prior P2-AI-02 limitation).

## Real Provider Readiness

- [x] Mock Provider (Gemini + Replicate) PASS
- [x] Environment Variables documented (`.env.example`)
- [x] API Key / token never logged
- [x] Fallback provider swappable via env (absent = disabled)
- [x] Fallback-eligibility policy verified (never/only rules + SAFETY edge case)
- [x] Bounded retry/timeout/polling verified
- [x] Structured events verified
- [x] No duplicate Job completion verified (integration test)
- [ ] Ready for Real Replicate Manual Test (blocked on API token — see Known Limitations)
