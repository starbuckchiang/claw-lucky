---
applyTo: "supabase/**"
description: "Supabase database, auth, storage, Edge Functions, and API integration rules"
---

# Supabase Development Instructions

## Scope

Apply these rules when modifying:

- Supabase migrations
- Row Level Security policies
- Supabase Auth
- Storage buckets and policies
- Edge Functions
- Frontend code that reads from or writes to Supabase
- Repository and service modules that wrap Supabase access

## General principles

- Make the smallest change necessary for the current task.
- Do not change database schema, RLS policies, storage policies, or authentication flow unless the task explicitly requires it.
- Preserve existing table names, column names, API contracts, localStorage keys, and response formats.
- Do not introduce a second Supabase client unless there is a documented technical reason.
- Reuse the existing Supabase configuration and client initialization.
- Do not hardcode project URLs, anonymous keys, service-role keys, user IDs, bucket names, or environment-specific values.
- Never commit `.env`, `.env.local`, service-role keys, access tokens, or private credentials.

## Database migrations

- All schema changes must be created as new migration files under `supabase/migrations/`.
- Never edit an already-applied migration to change production behavior.
- Migration filenames must use the existing timestamp naming convention.
- Migrations must be safe to run in order.
- Use `IF EXISTS` or `IF NOT EXISTS` where appropriate.
- Do not drop tables, columns, policies, functions, or data unless explicitly approved.
- For destructive changes, stop and report the risk before editing.
- Add indexes only when justified by an actual query pattern.
- Keep SQL readable and add comments for non-obvious security or business rules.

## Row Level Security

- RLS must remain enabled on user-facing tables.
- Never solve a permission error by disabling RLS.
- Never use a permissive policy such as `USING (true)` or `WITH CHECK (true)` unless the table is intentionally public and the task explicitly approves it.
- Policies must restrict access by the authenticated user's identity where applicable.
- Prefer `auth.uid()` over client-provided user IDs for ownership checks.
- Apply both `USING` and `WITH CHECK` where read/write ownership requires both.
- Verify policies separately for `SELECT`, `INSERT`, `UPDATE`, and `DELETE`.
- Anonymous access must be explicitly documented and narrowly scoped.
- Do not expose service-role behavior to browser code.

## Authentication

- Prefer Supabase Auth UUID as the authoritative user identity.
- Do not trust a user ID supplied only through query parameters, request bodies, or localStorage.
- Existing legacy identifiers such as `ossUserId` must not be removed or migrated unless the task explicitly includes migration.
- Authentication failures must return a clear normalized error.
- Do not silently create duplicate user records.
- Avoid multiple GoTrue clients in the same browser context.
- Reuse the existing auth client and session handling.

## Frontend data access

- Frontend code must call the existing API, repository, or service abstraction when one already exists.
- Do not scatter raw Supabase queries across unrelated UI files.
- Keep UI rendering separate from database access.
- Handle loading, empty, success, and error states.
- Check and handle the Supabase `error` result from every query.
- Do not assume returned data is non-null.
- Select only the columns needed by the feature.
- Preserve existing response shapes unless the task explicitly changes the contract.

## Inserts and updates

- Validate required input before sending it to Supabase.
- Do not send `undefined` values.
- Use explicit column mappings rather than passing an entire UI object directly.
- Use `upsert` only when duplicate-handling behavior is intentional.
- When using `upsert`, confirm the correct conflict key.
- Do not overwrite existing values with null or empty strings unless required.
- For multi-step business operations, prefer a database function or transactional server-side operation when partial completion would create inconsistent data.

## Edge Functions and server-side code

- Service-role keys may only be used in secure server-side environments.
- Validate authentication and authorization inside the function.
- Validate and normalize all request input.
- Return consistent status codes and JSON response shapes.
- Do not expose provider errors, stack traces, keys, or internal configuration to clients.
- Add correlation IDs where the existing architecture uses them.
- Respect existing retry, timeout, and error-normalization conventions.
- Do not add a new external dependency unless clearly justified.

## Storage

- Use the existing bucket names and path conventions.
- Do not make a private bucket public to bypass access issues.
- Storage policies must follow the same ownership rules as database records.
- Validate file type, size, extension, and ownership where applicable.
- Do not overwrite another user's file.
- Store durable file paths or object keys rather than temporary signed URLs.
- Signed URLs must use an appropriate expiry time.
- Remove uploaded files when a failed workflow would otherwise leave orphaned objects, when feasible.

## Error handling

- Never ignore a Supabase error.
- Normalize expected errors into the project's existing error format.
- Preserve useful error codes for debugging.
- User-facing messages must not reveal SQL, policy details, keys, or stack traces.
- Log only the minimum diagnostic information required.
- Do not log access tokens, refresh tokens, API keys, uploaded personal data, or full request bodies containing sensitive data.

## Testing and verification

For Supabase-related changes:

1. Identify the exact tables, policies, functions, buckets, and clients affected.
2. Run the narrowest relevant automated tests first.
3. Run the project's standard verification command:
   `.\scripts\verify-local.ps1`
4. For migration or RLS changes, verify at least:
   - authorized read
   - unauthorized read
   - authorized write
   - unauthorized write
   - ownership boundary between two users
5. For frontend changes, verify loading, success, empty, and failure states.
6. Do not claim a migration, deployment, or E2E test passed unless it was actually executed.

## Deployment

- Do not deploy automatically unless the task explicitly requests deployment.
- Before deploying, report:
  - migration files
  - Edge Functions
  - environment variables
  - policy changes
  - rollback risk
- Never print secret values in commands, reviews, screenshots, or logs.
- After deployment, perform the specified smoke test or E2E verification.
- Record deployed changes and evidence in the task review document.

## Final report

At the end of the task, report only:

- Supabase files changed
- Tables, functions, policies, buckets, or Edge Functions affected
- Verification commands executed
- Test results
- Deployment status
- Remaining risks or manual checks