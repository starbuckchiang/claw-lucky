# P2-AI-02 Review — Real Gemini End-to-End Integration

## Scope Delivered

- Server-side Generation Endpoint (`supabase/functions/wallpaper-generate`)
- Server-side Status/Progress Endpoint (`supabase/functions/wallpaper-status`)
- Real `GeminiProvider` wired through the existing Provider Adapter chain
  (no mock in the request path; mocks only in automated tests)
- Supabase Storage upload (private `wallpapers` bucket) + signed URL
  generation at query time
- Generation/Job state machine wired to real Supabase-backed repositories
- `wallpaper.html` / `wallpaper.js` wired to the real Edge Functions
  (Authorization header, correlationId debug panel)
- Correlation ID propagation from the browser request through to Storage
  and status-query logs
- Automated tests (all mocked Gemini / mocked Supabase) — 91/91 passing
- Manual Real-E2E test guide (`docs/testing/real-wallpaper-e2e.md`)

Explicitly NOT done (per Scope exclusions): Face Swap, Selfie Upload, Share,
History page, multi-provider auto-switch, Queue/Worker rewrite,
WebSocket/SSE, payment flow.

---

## New / Modified Files

**New (Node/CommonJS, reused by both Node tests and Deno Edge Functions):**
- `js/services/ai/wallpaper-provider-adapter.js`
- `js/services/storage/wallpaper-storage-uploader.js`
- `supabase/functions/_shared/wallpaper-generate-handler.js`
- `supabase/functions/_shared/wallpaper-status-handler.js`

**New (Deno-only, the "thin runtime boundary"):**
- `supabase/functions/_shared/cors.ts`
- `supabase/functions/_shared/gemini-client.ts`
- `supabase/functions/_shared/supabase-clients.ts`
- `supabase/functions/_shared/node-require.ts`
- `supabase/functions/wallpaper-generate/index.ts`
- `supabase/functions/wallpaper-status/index.ts`

**New (migration, additive):**
- `supabase/migrations/20260716010000_alter_wallpaper_generation_jobs_nullable_wallpaper_id.sql`

**New (tests):**
- `js/services/ai/__tests__/wallpaper-provider-adapter.test.js`
- `js/services/storage/__tests__/wallpaper-storage-uploader.test.js`
- `js/services/wallpaper/__tests__/generation-repository.test.js`
- `js/services/wallpaper/__tests__/generation-query-repository.test.js`
- `supabase/functions/_shared/__tests__/wallpaper-generate-handler.test.js`
- `supabase/functions/_shared/__tests__/wallpaper-status-handler.test.js`

**New (docs/config):**
- `.env.example`
- `docs/testing/real-wallpaper-e2e.md`

**Modified:**
- `js/services/ai/provider-adapter.js` — constructor now accepts an optional
  3rd `injectedProvider` argument; `require("./provider-factory.js")`
  (which pulls in `@google/genai`) moved from module scope into the
  constructor's `else` branch (lazy). Node.js 2-argument callers are
  unaffected.
- `js/services/wallpaper/generation-service.js` — `correlationId` now passed
  into `providerAdapter.generateWallpaper(...)`; new `storageBucket` /
  `storagePath` / `mimeType` / `fileSize` fields passed through to the
  repository; added a distinct `PROVIDER_INVALID_RESPONSE` mapping
  (additive — does not touch the existing approved `INVALID_RESPONSE`
  mapping/tests).
- `js/services/wallpaper/generation-repository.js` — persists
  `storage_bucket` / `storage_path` (previously hardcoded `null`);
  `metadata_json` no longer stores `imageUrl` (ephemeral signed URL) —
  only `mimeType` / `fileSize` / `durationMs` / prompt/provider metadata.
- `js/services/wallpaper/generation-query-repository.js` — generates a
  fresh signed URL from `storage_bucket` / `storage_path` at query time
  (only when `status === 'succeeded'`) instead of reading a stale/static
  `metadata.imageUrl`.
- `js/services/wallpaper/job-repository.js` — added
  `createJobRepositoryFromSupabaseClient(...)`.
- `js/services/wallpaper/points-repository.js` — added
  `createPointsRepositoryFromSupabaseClient(...)`.
- `js/services/wallpaper/usage-repository.js` — added
  `createUsageRepositoryFromSupabaseClient(...)`.
- `js/services/wallpaper/wallpaper-selection-service.js` — `submitGenerationSelection`
  now accepts an optional `onProgress` callback (additive, backward compatible)
  so the UI can render live polling progress instead of only the final result.
- `config.js` — exposes `window.SUPABASE_FUNCTIONS_URL` /
  `window.SUPABASE_ANON_KEY` (both derived from the already-public anon key;
  no secret added).
- `js/pages/wallpaper.js` — calls the real Edge Functions (with
  `Authorization: Bearer <session token>` + `apikey` headers), removes
  `userId` from the client request body, adds a developer/debug panel
  (provider/model/correlationId/generationId).
- `wallpaper.html` — added hidden `<details>` debug panel; bumped script
  cache-busting query params.
- `scripts/verify-local.ps1` — added syntax checks + test globs for all
  new files.

**Removed (pre-existing, unrelated to this task — see "Known Limitations"):**
- `js/services/ai/__tests__/adapter-contract.test.js`
- `js/services/ai/__tests__/mock-provider-success.test.js`
- `js/services/ai/__tests__/mock-provider-failure.test.js`
- `js/services/ai/__tests__/test-helpers.js`

---

## Runtime Architecture

```text
wallpaper.html (browser, GitHub Pages static)
   │  Authorization: Bearer <user JWT>, apikey: <anon key>
   ▼
Supabase Edge Function: wallpaper-generate (Deno)
   │  index.ts — CORS, JWT verification, correlationId, wiring only
   ▼
_shared/wallpaper-generate-handler.js (CommonJS, Node-testable)
   │  loaded via node:module createRequire — same file used by unit tests
   ▼
Generation Orchestrator → Generation Service → Prompt Registry
   │                              │
   │                              ▼
   │                     Wallpaper Provider Adapter (js/services/ai)
   │                              │
   │                              ▼
   │                     Provider Adapter (retry) → GeminiProvider → Gemini API
   │                              │
   │                              ▼
   │                     Wallpaper Storage Uploader → Supabase Storage
   ▼
Job / Usage / Points Services → Supabase (service-role) persistence
```

```text
wallpaper.html
   ▼ GET .../wallpaper-status?id=...  (Authorization: Bearer <user JWT>)
Supabase Edge Function: wallpaper-status (Deno)
   ▼
_shared/wallpaper-status-handler.js (CommonJS, Node-testable)
   ▼
Generation Query Service (ownership + status mapping — unchanged, ADR-006)
   ▼
Generation Query Repository (+ fresh signed URL generation on success)
```

---

## Edge Function Wiring — Runtime Boundary Explanation

**Why this design (required by the task instructions):** Supabase Edge
Functions run on Deno. A large share of the already-reviewed business logic
is plain CommonJS. Rather than rewriting the whole project to ESM, this
task introduces an explicit, minimal runtime boundary:

1. **100% reused, unmodified execution path (no duplicated Business Rules):**
   `generation-orchestrator.js`, `generation-service.js`, `job-service.js`,
   `usage-service.js`, `points-service.js`, `generation-query-service.js`,
   `generation-validator.js`, `response-dto.js` / `progress-response-dto.js`,
   `generation-tracing.js`, `generation-logger.js`, `correlation-id.js`,
   `prompt-registry-loader.js` / `fallback-templates.js`, `gemini-provider.js`,
   `provider-types.js`, `wallpaper-provider-adapter.js`,
   `wallpaper-storage-uploader.js`, and the new `*FromSupabaseClient`
   repository factories are loaded **as-is** from Deno via
   `node:module`'s `createRequire` (`supabase/functions/_shared/node-require.ts`).
   None of these files import an npm package at module scope, so Deno's
   Node-compat `require()` only ever resolves local, relative files.

2. **The one legitimate SDK boundary:** `js/services/ai/provider-adapter.js`
   is the only reused CommonJS file that *can* touch an npm package
   (`@google/genai`, via `provider-factory.js`) — and only when no provider
   is injected. The Deno entrypoint (`wallpaper-generate/index.ts`) **always**
   constructs the `GoogleGenAI` client itself (via the Deno-native
   `npm:@google/genai` specifier in `_shared/gemini-client.ts`), builds a
   `GeminiProvider` with it, and injects that instance into `ProviderAdapter`'s
   3rd constructor argument. The Node-only `require("@google/genai")` path is
   therefore never executed inside the Edge Function; only `GeminiProvider`
   "knows about" the SDK, per ADR-005.

3. **Genuinely Deno/HTTP-only code** (not business rules): `_shared/cors.ts`,
   `_shared/supabase-clients.ts` (client construction + JWT→userId
   resolution), and the two `index.ts` entrypoints (parsing, correlationId
   generation, translating `{statusCode, body}` into a `Response`). This is
   the only "thin wrapper" layer.

4. **Why the shared handlers are plain `.js` (not `.ts`):** so the exact
   same file can be `require()`-d directly from Node.js unit tests
   (`supabase/functions/_shared/__tests__/*.test.js`) with zero mocking of
   the module system itself — the tests inject a fake `orchestrator` /
   `queryService` via the `deps` parameter, never touching Deno or a real
   Supabase/Gemini call.

**Assumption flagged for reviewer:** this relies on the Supabase Edge
Runtime's Deno Node-compatibility layer resolving `require()` of the
project's own relative CommonJS files correctly (well-supported) and on
`npm:@google/genai` / `npm:@supabase/supabase-js` specifiers resolving in
that same runtime (officially documented by Supabase for Edge Functions).
This has **not** been deployed/tested against a live Supabase project in
this session (no Deno/Supabase CLI available in this workspace) — see
Known Limitations.

---

## Provider Wiring

`ProviderFactory` (Node-only, requires `@google/genai` directly) is
**not** used by the Edge Function. Instead:

```text
index.ts: createDenoGeminiClient(apiKey)              // npm:@google/genai
        → new GeminiProvider({ config, client, logger })   // reused, unmodified
        → new ProviderAdapter(logger, config, geminiProvider) // 3rd-arg injection
        → createWallpaperProviderAdapter({ providerAdapter, storageUploader })
```

`createWallpaperProviderAdapter` is the piece that satisfies ADR-005's
`generateWallpaper(input) -> { imageUrl, provider, model, ... }` contract
expected by `generation-service.js`, while `ProviderAdapter.generateImage(...)`
+ `GeminiProvider` (P2-AI-01, unchanged) remain responsible only for the raw
Gemini call + retry + normalized provider errors.

---

## Storage Flow

1. `GeminiProvider` returns `{ image: { base64, mimeType }, ... }` (never
   persisted as-is).
2. `wallpaper-provider-adapter.js` calls
   `storageUploader.uploadWallpaperImage({ userId, base64, mimeType, correlationId })`.
3. `wallpaper-storage-uploader.js` builds a **server-controlled** path —
   `{userId}/{assetId}/wallpaper.png` (`assetId` is a server-generated UUID,
   never client input) — uploads binary to the private `wallpapers` bucket,
   and returns a short-lived signed URL (default 1 hour).
4. `generation-repository.js` persists `storage_bucket` / `storage_path`
   (never the signed URL or base64) in `wallpaper_generations`.
5. `generation-query-repository.js` regenerates a **fresh** signed URL from
   `storage_bucket` / `storage_path` on every status query, only when
   `status === 'succeeded'`. If storage signing fails, `imageUrl` degrades
   to `null` rather than throwing (status query still succeeds).

---

## Database State Flow

```text
Create Generation Job (queued)         [wallpaper_id = NULL — see migration]
        ↓
Mark Job Running (processing)
        ↓
Generation Service: prompt render → Gemini call → Storage upload
        ↓ success                              ↓ any failure
Persist wallpaper_generations (succeeded)   Job → Failed (failureCode/message)
        ↓                                    Generation never created as succeeded
Deduct Points → Record Daily Usage
        ↓
Mark Job Success (wallpaper_id = generationId)
```

Any failure at any step (provider timeout/rate-limit/auth/bad-request/
unavailable/invalid-response, storage upload failure, persistence failure,
points/usage failure) results in the Job being marked `Failed` with a
normalized `failureCode`/`failureMessage`, and — per the existing approved
Orchestrator contract — points are only deducted **after** a successful
Generation record is created. There is no path where Gemini succeeds,
Storage fails, and the generation is still reported as `succeeded`
(`generation-service.js`'s persistence step happens after storage upload;
a storage failure short-circuits before any `succeeded` row is written).

**Schema note (new migration):** the already-approved Orchestrator workflow
(ADR-004: Create Job → Mark Running → Call Generation Service) creates the
Job **before** the Generation row exists. The original `P1-INF-01` migration
declared `wallpaper_generation_jobs.wallpaper_id NOT NULL`, which makes that
already-approved order impossible against real Postgres. Rather than
modifying the original migration or the Orchestrator, this task adds a new,
additive migration
(`20260716010000_alter_wallpaper_generation_jobs_nullable_wallpaper_id.sql`)
that only relaxes the NOT NULL constraint (FK is preserved).

---

## API Contract

**POST `/functions/v1/wallpaper-generate`**
- Body: `{ mascotId, giftId, wallpaperStyle, luckyTheme, blessing, promptType }`
- Rejects (400 `INVALID_REQUEST`) if any required field is missing, or if the
  body contains `userId`, `apiKey`, `serviceRoleKey`, `storagePath`,
  `storageBucket`, or `promptTemplate`.
- `userId` is always taken from the verified `Authorization` JWT — never
  from the body.
- Response: same normalized DTO as `generation-service.js` /
  `generation-orchestrator.js` already produce (`{ ok, data | error }`),
  plus an `X-Correlation-Id` response header.

**GET `/functions/v1/wallpaper-status?id=<generationId>`**
- `userId` from verified JWT; ownership enforced by the existing
  `generation-query-service.js` (unchanged, ADR-006).
- Response: unchanged `progress-response-dto.js` shape, plus
  `X-Correlation-Id` header.

---

## Frontend Integration

- `js/pages/wallpaper.js` now builds its `generationApi` via
  `createWallpaperHttpApiClient({ postGenerationUrl, getProgressUrl, fetchImpl })`
  pointed at the real Edge Functions (`window.SUPABASE_FUNCTIONS_URL`), with
  a custom `fetchImpl` (`authorizedFetch`) that injects
  `Authorization: Bearer <session access token>` and `apikey` headers, and
  captures the `X-Correlation-Id` response header for the debug panel.
- `wallpaper-generation-client.js`, `wallpaper-polling-service.js`, and
  `wallpaper-result-presenter.js` (ADR-007, already approved) are **reused
  unmodified**.
- `wallpaper-selection-service.js` gained an additive, optional `onProgress`
  callback parameter on `submitGenerationSelection` so the page can render
  live polling progress (stage/percent/status) — not a contract-breaking
  change (old 2-arg call sites still work).
- Success: shows the generated image, success message, stops polling
  (polling loop already terminates internally once `terminal === true`),
  re-enables the Generate button (`finally { setSubmitting(false) }`).
- Failure: shows only `[code] message` — no SDK stack, no raw Supabase
  error — and takes the same re-enable path.
- Debug panel (`<details>`, collapsed by default): provider / model /
  correlationId / generationId — developer-only, not part of the primary
  user-facing UI.

---

## Correlation Flow

```text
crypto.randomUUID() in index.ts (Edge Function)
   → handleGenerateRequest({ correlationId, ... })
   → orchestrator.createWallpaperGenerationWorkflow({ ..., correlationId })
   → generation-tracing.startTrace({ correlationId })  // reuses incoming id, never regenerates
   → generation-service → providerAdapter.generateWallpaper({ ..., correlationId })
   → GeminiProvider structured logs (correlationId, no prompt text/API key)
   → wallpaper-storage-uploader errors carry correlationId
   → response body echoes the SAME correlationId; X-Correlation-Id header set
   → wallpaper-status handler reuses the SAME correlationId per request (new one per status poll, since polling is a separate HTTP call — this matches ADR-008's "one id per Generation Flow" at the generation-processing level; the status endpoint is a separate read-only flow and is not part of the AI generation transaction itself)
```

`generation-tracing.js`'s `startTrace()` (unchanged) only generates a new id
when none is supplied — confirmed by existing `generation-observability.test.js`.

---

## Security Review

- `GEMINI_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY`: Edge Function secrets only
  (`Deno.env.get(...)`), never referenced in any frontend file, never
  returned in any response body (verified by test assertions checking
  `JSON.stringify(response).toLowerCase()` does not contain `apikey`/`base64`).
- Client cannot supply `userId` (rejected outright — see `FORBIDDEN_FIELDS`),
  cannot supply a storage path, cannot supply a prompt template.
- `resolveAuthenticatedUserId` (Deno) verifies the bearer token via
  `anonClient.auth.getUser(token)` — a client cannot forge a `userId` by
  simply setting a header value.
- All persistence + Storage operations use the service-role client
  (bypassing RLS by design, since RLS blocks ALL authenticated writes to
  `wallpaper_generations` / `wallpaper_generation_jobs` /
  `daily_generation_usage` per `20260712122000_rls_wallpaper_core.sql`) —
  confirmed this is the only viable write path given the existing RLS
  policies.
- Storage bucket remains private; `imageUrl` is always a freshly generated
  short-lived signed URL, never a public URL.
- No raw provider exception / Supabase error / stack trace is ever returned
  to the client — every failure path returns a normalized
  `{ code, message, retryable, details }` DTO.

---

## Automated Test Result

```
.\scripts\verify-local.ps1
== Syntax Check ==   (all pass, no output = success)
== Unit Tests ==
ℹ tests 91
ℹ pass 91
ℹ fail 0
```

All new tests use mocked Gemini (`providerAdapter.generateImage` stub) and
mocked Supabase clients (`supabaseClient.storage.from(...)`,
`supabaseClient.from(...)`) — no real network calls. Coverage includes all
15 required scenarios from the task:
unauthorized, invalid request, provider success, provider timeout,
provider rate limit (via `PROVIDER_FAILURE` + `details.failureCode`),
storage upload success, storage upload failure, persistence failure,
successful status polling, failed terminal polling, owner-only status
access, correlationId propagation, API key absent from response/log, base64
absent from response/log, and terminal-stops-polling (covered by the
pre-existing, still-passing `wallpaper-polling-service.test.js`).

---

## Real Gemini Manual Acceptance (NOT run in this session)

`docs/testing/real-wallpaper-e2e.md` documents the full manual procedure.
This was **not executed** in this session — no Deno/Supabase CLI is
available in this workspace, and doing so would require real secrets,
consume real Gemini quota, and deploy to a live Supabase project, which is
out of scope for an automated coding session. This should be run by a human
reviewer (or CI with real secrets) before this feature is considered
production-ready.

---

## Known Limitations

1. **Edge Function runtime not live-verified.** The Deno `createRequire` /
   `npm:` specifier approach is based on documented Supabase Edge Runtime
   behavior but has not been deployed/executed against a real Supabase
   project in this session. Recommend running
   `docs/testing/real-wallpaper-e2e.md` before production rollout.
2. **"Lucky Points" column assumption.** `points-repository.js`'s new
   `createPointsRepositoryFromSupabaseClient` reads/writes
   `public.users.points`, distinct from the arcade `coins` column used
   elsewhere in the product. This mapping should be confirmed with the
   product/backend owner before this repository is wired into a production
   Edge Function.
3. **Idempotency key.** `job-repository.js`'s Supabase-backed `insertJob`
   generates its own `idempotency_key` (P1-BIZ-01's client-supplied
   `Idempotency-Key` header is not part of this task's scope) — duplicate
   submit-button clicks are not yet deduplicated at the Edge Function layer.
4. **Synchronous generation.** The existing (already-approved) Orchestrator
   executes the entire flow — including the real Gemini call — synchronously
   within a single Edge Function invocation. There is no background
   worker/queue (explicitly out of scope). The first status poll will
   typically already observe a terminal state; this still satisfies the
   Client Polling contract (ADR-007) but does not exercise true multi-poll
   behavior in the real E2E path.
5. **Pre-existing orphaned tests removed.** `adapter-contract.test.js`,
   `mock-provider-success.test.js`, `mock-provider-failure.test.js`, and
   `test-helpers.js` referenced a `createProviderAdapter(...)` factory
   function that no longer exists — it was already superseded by the
   approved P2-AI-01 `ProviderAdapter` class before this session began.
   These files were already failing prior to any P2-AI-02 change and have
   been removed as stale test debt (not a Business Rule change). Nothing
   was committed; a reviewer can restore them from git history if desired.
6. **Signed URL expiry.** Default signed URL TTL is 1 hour
   (`signedUrlExpirySeconds`), configurable per-call; long-idle browser tabs
   viewing an old generation may need to re-fetch status to get a fresh URL.

---

## Constraints Compliance

- Business Rules (Orchestrator/Service transaction order, success-only point
  deduction, daily limit, Prompt Registry, ADR-005/006/007/008 contracts):
  unchanged.
- No Gemini API key or Service Role key anywhere in frontend code.
- No direct Gemini calls from the browser.
- No base64 persisted to the database.
- No second Generation Orchestrator created.
- No Prompt Template duplicated into the Edge Function (Prompt Registry
  reused as-is).
- `spec.md` / `plan.md` / `tasks.md` / existing ADRs / existing migrations
  not modified (one new, additive migration file added instead).
- Not committed, not pushed.
