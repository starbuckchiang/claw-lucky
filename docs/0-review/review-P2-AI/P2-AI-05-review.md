# P2-AI-05 Review — IMAGE_GENERATION_FAILURE Persistence Diagnostics

Source: production log analysis for correlationId `e505573d-e5ae-499a-a725-5e5f8b25b7e0`
(`generation_service_persistence_failure` / `generation_orchestrator_generation_failed`,
both `errorCode: IMAGE_GENERATION_FAILURE`).

## Scope Delivered

Confirms real progress on the P2-AI-03/04 provider + logger fixes: this
failure occurs **after** Gemini successfully generated an image and passed
the `imageUrl` validation — the failure point moved to
`generationRepository.createGenerationRecord()` (writing to
`wallpaper_generations`). Previously this path had zero diagnostic detail;
this task applies the exact same diagnostic pattern already proven for
`job-repository.js`/`job-service.js` (JOB_CREATION_FAILURE fix) to its
sibling `generation-repository.js`/`generation-service.js` pair, which had
never received that treatment.

## Root Cause

`generation-repository.js`'s `insertGeneration()` only did `if (error) throw error;`
— no `table`/`operation` context attached (unlike `job-repository.js`,
which already had `withDiagnosticContext()`). `generation-service.js`'s
catch block around `createGenerationRecord()` only logged a fixed
`IMAGE_GENERATION_FAILURE` trace and returned `details: { reason: error?.message }`
— dropping `code`/`details`/`hint`/`table`/`operation` entirely. The
orchestrator's `generation_orchestrator_generation_failed` log line also
never surfaced `generationResult.error.details`.

## Fix

- **`js/services/wallpaper/generation-repository.js`** / **`supabase/functions/_shared/lib/generation-repository.ts`** —
  added `withDiagnosticContext(error, table, operation)` (mirrors
  `job-repository.js`'s precedent exactly); `insertGeneration`'s error path
  now attaches `.table = "wallpaper_generations"` / `.operation = "insertGeneration"`
  to the raw Postgres error before throwing.
- **`js/services/wallpaper/generation-service.js`** / **`supabase/functions/_shared/lib/generation-service.ts`** —
  added `extractSafeErrorDiagnostics(error)` (mirrors `job-service.js`'s
  precedent); the persistence-failure catch block now logs
  `diagnostics: { reason, code, details, hint, table, operation }` in the
  `generation_service_persistence_failure` payload and returns the same
  object as the DTO's `details` (previously only `{ reason }`).
- **`js/services/wallpaper/generation-orchestrator.js`** / **`supabase/functions/_shared/lib/generation-orchestrator.ts`** —
  `generation_orchestrator_generation_failed` log payload now includes
  `diagnostics: generationResult.error.details || null`, matching the
  existing `generation_orchestrator_job_creation_failed` precedent (this is
  a generic passthrough — applies to whatever `details` shape any failure
  code already returns, not persistence-specific).

No error codes, HTTP status mapping, business logic, or API response
contract changed — purely additive diagnostic fields on top of the existing
normalized error shape.

## Testing

- `js/services/wallpaper/__tests__/generation-repository.test.js` — new
  test: `insertGeneration` attaches safe diagnostic context (table/operation)
  to a raw Supabase error.
- `js/services/wallpaper/__tests__/generation-service.test.js` — extended
  the existing "Image Generation Failure on persistence" test to assert
  `details.reason` is preserved; added a new test asserting full
  `code`/`table`/`operation`/`hint` passthrough from the repository error.

`.\scripts\verify-local.ps1` → **138/138 tests passing** (136 prior + 2
new), no regressions. Verified via actual test log output that the fix
produces the intended payload, e.g.:

```json
{
  "event": "generation_service_persistence_failure",
  "diagnostics": {
    "reason": "duplicate key value violates unique constraint",
    "code": "23505",
    "details": "Key (id)=(gen-1) already exists.",
    "hint": null,
    "table": "wallpaper_generations",
    "operation": "insertGeneration"
  }
}
```

## Lesson / Process Note

When a diagnostics fix is applied to one repository/service pair (e.g.
`job-*`), sibling pairs (`generation-*`, `usage-*`, `points-*`) must be
checked individually for the same gap — they are separate files that do
not automatically inherit the fix. `usage-repository.js`/`usage-service.js`
and `points-repository.js`/`points-service.js` have **not** been audited
for this same gap yet (out of scope for this task; flagged for a future
pass if similar opaque failures are observed from those paths).

## Acceptance Checklist

- [x] Root cause identified (missing diagnostic context on the
      `wallpaper_generations` insert path only, distinct from the earlier
      provider/logger issues)
- [x] Fix mirrors the already-reviewed `job-repository.js`/`job-service.js`
      pattern exactly — no new abstraction invented
- [x] No business logic / error code / HTTP mapping changes
- [x] No API keys/tokens/prompt/image data logged
- [x] Tests added for both the repository and service layers
- [x] `verify-local.ps1` run — 138/138 passing, no regressions
- [ ] `usage-repository.js`/`points-repository.js` audited for the same gap (not done — future work)
- [ ] Deployed to Supabase (pending — not done in this session)
