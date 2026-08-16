# P2-AI-04 Review — Wallpaper Provider Adapter Logger Wiring Fix

Source prompt: [docs/working-prompts/prompts-P2-AI-fix safelogger-info.md](../docs/working-prompts/prompts-P2-AI-fix%20safelogger-info.md)

## Scope Delivered

Fixed a production `TypeError: safeLogger.info is not a function` in the
wallpaper generation request path, plus hardened the adapter's logger
fallback against any future partially-shaped logger. This closes the loop
on the P2-AI-03 Provider Resilience Agent investigation chain (multiple
prior review/analysis sessions traced the symptom down to this exact
wiring gap).

## Root Cause

`buildOrchestrator()` (in both `wallpaper-generate-handler.js` and the
deployed `wallpaper-generate-handler.ts`) constructs the Provider Resilience
Agent correctly:

```ts
const rawProviderAdapter = createProviderResilienceAgent({
  ...
  logger: wrapLoggerForProvider(logger)   // ✅ wrapped
});
```

but 3 lines later, when building the Wallpaper Provider Adapter, passed the
**raw, unwrapped** `generationLogger` instead:

```ts
const providerAdapter = createWallpaperProviderAdapter({
  providerAdapter: rawProviderAdapter,
  storageUploader,
  logger              // ❌ raw generationLogger (logInfo/logWarn/logError)
});
```

`generationLogger` (from `createGenerationLogger()`) only exposes
`logInfo`/`logWarn`/`logError`. `wallpaper-provider-adapter.js`'s
`safeLogger` calls `.info(entry)`/`.error(entry)` — the same interface
`GeminiProvider`/`ReplicateFluxProvider`/the Resilience Agent all expect.
Because the previous fallback was all-or-nothing
(`logger || { info, warn, error }`), a truthy-but-wrongly-shaped logger was
used as-is, and:

- **Success path** → `safeLogger.info({event:"wallpaper_provider_adapter_succeeded",...})` throws.
- **Storage upload failure path** → `safeLogger.error({event:"wallpaper_provider_adapter_storage_upload_failed",...})` throws, masking the real storage error.

## Fix

### 1. Call-site fix (wiring)

- `supabase/functions/_shared/wallpaper-generate-handler.js`
- `supabase/functions/_shared/wallpaper-generate-handler.ts`

`logger` → `logger: wrapLoggerForProvider(logger)` — reuses the exact same
wrapper already used for the Resilience Agent / Gemini / Replicate; no
second wrapper implementation created. `wrapLoggerForProvider` is now also
exported (`module.exports` / `export function`) so tests can reuse the real
implementation instead of re-declaring an equivalent one.

### 2. Defensive hardening (adapter itself)

- `js/services/ai/wallpaper-provider-adapter.js`
- `supabase/functions/_shared/lib/wallpaper-provider-adapter.ts`

`safeLogger` changed from all-or-nothing to per-method validation:

```js
const safeLogger = {
  info: typeof logger?.info === "function" ? logger.info.bind(logger) : () => {},
  warn: typeof logger?.warn === "function" ? logger.warn.bind(logger) : () => {},
  error: typeof logger?.error === "function" ? logger.error.bind(logger) : () => {}
};
```

A partially-shaped logger (e.g. only `.error`, no `.info`) can never crash
this adapter again — each missing method silently no-ops instead of the
whole logger being discarded or blindly trusted.

No event names, payload shapes, `normalizeProviderError()` behavior,
provider/storage flow, or API response contract were changed. The
temporary raw-exception diagnostics added during the P2-AI-03 investigation
(`wallpaper_provider_adapter_raw_exception`, `gemini.provider.unhandled_exception`,
`provider.adapter.exhausted`, `generation_primary_failed_raw`,
`generation_fallback_failed_raw`, `generation_service_provider_failure_raw`,
`generation_fallback_eligibility_check`) were all preserved untouched.

## Testing

Added to `js/services/ai/__tests__/wallpaper-provider-adapter.test.js`
(existing file extended, no new test architecture):

- **Case A** — a correctly-shaped `generationLogger` (`logInfo`/`logWarn`/`logError`
  only) passed through the real `wrapLoggerForProvider()` → success path
  completes without throwing, `logInfo` receives `wallpaper_provider_adapter_succeeded`.
- **Case B** — an incomplete logger (`error` only, no `info`) passed
  directly → success path still completes, no crash.
- **Case C** — an incomplete logger (`info` only, no `error`) + a storage
  upload failure → original error (message, `retryable`) preserved
  unchanged, `failureCode` correctly normalized to `STORAGE_UPLOAD_FAILED`,
  never masked by a logger-induced `TypeError`.

`.\scripts\verify-local.ps1` (syntax check + `node --test`, the only
verification pipeline in this repo — confirmed via `package.json` /
`scripts/` inspection; no `deno.json`, no Deno CLI available locally for the
`.ts` twins) → **136/136 tests passing** (133 prior + 3 new), no
regressions.

## Residual / Out of Scope

- Full-project search for `createWallpaperProviderAdapter(`, `safeLogger.info/warn/error(`,
  `logger: logger`, `logger,` confirmed this was the **only** unwrapped-logger
  call site; all other call sites (tests, `generationLogger: logger` passed
  to `generation-service.js`/`generation-orchestrator.js`) already use the
  correct interface.
- `provider-resilience-agent.js`/`.ts`'s `safeLogger` still uses the
  all-or-nothing fallback (`logger || { info, error }`). Not fixed here —
  out of scope for this task and not currently exhibiting a bug (its one
  caller always passes a fully-wrapped logger via `wrapLoggerForProvider`).
  Flag if asked to harden defensively in a future task.

## Acceptance Checklist

- [x] Root cause identified and fixed at the call site (`buildOrchestrator()`)
- [x] Reused existing `wrapLoggerForProvider` — no duplicate wrapper created
- [x] Defensive per-method logger validation added (adapter side)
- [x] No changes to Gemini SDK call, Replicate call, fallback eligibility,
      `normalizeProviderError()`, or API response contract
- [x] No API keys/tokens/prompt/image data logged
- [x] Temporary raw-exception diagnostics preserved
- [x] Tests added (Case A/B/C) covering correct, partial, and
      failure-path logger scenarios
- [x] `verify-local.ps1` run — 136/136 passing, no regressions
- [ ] Deployed to Supabase (pending — not done in this session, per "stop
      after changes, no auto commit/push" instruction)
