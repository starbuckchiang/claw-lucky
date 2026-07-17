# Real Wallpaper E2E Manual Test (P2-AI-02)

This document describes how to manually verify the **real** Gemini + Supabase
Storage end-to-end flow. This is NOT run automatically by `verify-local.ps1`
or any CI step — it requires a real Gemini API key and a real Supabase
project, and it will consume real quota / Lucky Points.

Automated tests (mocked Gemini + mocked Storage) live under:
- `js/services/ai/__tests__/`
- `js/services/storage/__tests__/`
- `js/services/wallpaper/__tests__/`
- `supabase/functions/_shared/__tests__/`

---

## 1. Configure Supabase Edge Function secrets

Using the Supabase CLI (or Dashboard → Edge Functions → Secrets), set:

```powershell
supabase secrets set `
  AI_PROVIDER=gemini `
  AI_PROVIDER_MODEL=gemini-2.5-flash-image `
  AI_PROVIDER_TIMEOUT_MS=20000 `
  AI_PROVIDER_MAX_RETRY=2 `
  AI_PROVIDER_IMAGE_SIZE=1024x1792 `
  AI_PROVIDER_SAFETY_LEVEL=BLOCK_MEDIUM_AND_ABOVE `
  GEMINI_API_KEY=your-real-key `
  SUPABASE_URL=https://your-project.supabase.co `
  SUPABASE_ANON_KEY=your-anon-key `
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` must ONLY exist as Edge
Function secrets — never in `config.js`, never in any file committed to Git.

## 2. Apply migrations

```powershell
supabase db push
```

This includes the new `20260716010000_alter_wallpaper_generation_jobs_nullable_wallpaper_id.sql`
migration (required so the Orchestrator can create a Job before the
Generation row exists — see `review/P2-AI-02-review.md` for rationale).

## 3. Deploy the generation function

```powershell
supabase functions deploy wallpaper-generate
```

## 4. Deploy the status function

```powershell
supabase functions deploy wallpaper-status
```

## 5. Start the local static site

Any static file server works, e.g.:

```powershell
npx http-server . -p 8080
```

Then open `http://localhost:8080/wallpaper.html`.

(`config.js` already points `window.SUPABASE_FUNCTIONS_URL` at
`https://<project>.supabase.co/functions/v1` — no code change needed for a
different environment beyond editing `SUPABASE_URL` in `config.js`.)

## 6. Log in as a test user

Use the existing site login flow (same Supabase Auth session used by
`gacha.html` / `mascot-collection.html`). Confirm you are logged in — the
Collection/Gift sections on `wallpaper.html` should load without a
`UNAUTHORIZED_GENERATION_ACCESS` style error.

## 7. Select a mascot and a gift

Ensure the test account owns at least one mascot and one redeemed gift so
the Collection/Gift cards are not empty.

## 8. Click "開始生成" (Generate)

- The button should disable immediately.
- The progress text should update ("生成中 (...)...").

## 9. Observe polling

Open browser DevTools → Network tab:
- One `POST` request to `.../functions/v1/wallpaper-generate`.
- One or more `GET` requests to `.../functions/v1/wallpaper-status?id=...`.
- Each response should include an `X-Correlation-Id` header, and the SAME
  value should appear across the POST response and every subsequent GET
  response for that generation.

## 10. Confirm the Storage image

In the Supabase Dashboard → Storage → `wallpapers` bucket, confirm a new
object exists at:

```
{userId}/{assetId}/wallpaper.png
```

## 11. Confirm database generation/job state

In the Supabase Dashboard → Table Editor:

- `wallpaper_generations`: a new row with `status = 'succeeded'`,
  `storage_bucket = 'wallpapers'`, `storage_path` matching the object above,
  and `metadata_json` containing NO `imageUrl` / base64 data.
- `wallpaper_generation_jobs`: a row with `status = 'succeeded'` and
  `wallpaper_id` pointing at the generation row above.
- `daily_generation_usage`: `success_count` incremented for today.

## 12. Correlate logs by correlationId

In Supabase Dashboard → Edge Functions → Logs, filter/search by the
`correlationId` captured in step 9. You should be able to see:
- `generation_orchestrator_started` / `_succeeded`
- `gemini.provider.start` / `gemini.provider.success` (or `.error`)
- `wallpaper_provider_adapter_succeeded` (or `_storage_upload_failed`)

None of these log lines should contain the Gemini API key, the Supabase
service role key, the rendered prompt text, or base64 image data.

## 13. Confirm no secrets are visible in the browser

In DevTools → Network, inspect the request/response for
`wallpaper-generate` and `wallpaper-status`:
- Request headers should show `Authorization: Bearer <user JWT>` and
  `apikey: <anon key>` — NEVER the Gemini API key or service role key.
- Response bodies should never contain `GEMINI_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, base64 image data, or a raw SDK/Supabase
  exception/stack trace.

---

## Manual Acceptance Scenario

```
Open wallpaper.html
  -> Select owned mascot
  -> Select gift
  -> Generate
  -> generationId received
  -> polling processing
  -> Gemini returns image
  -> Storage upload succeeds
  -> status succeeded
  -> preview displays real image
```

If every step above completes and the preview shows a real generated image,
the manual E2E acceptance passes.
