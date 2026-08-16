// Supabase Edge Function: account-merge
//
// Thin Deno HTTP boundary ONLY (mirrors subscription-checkout/index.ts's
// convention). All Begin/Finalize business rules live in
// `supabase/functions/_shared/account-merge-handler.ts` and its
// `_shared/lib/*.ts` ESM ports — line-for-line equivalents of the reviewed
// CommonJS modules under `js/services/auth/**`, kept in sync with the
// Node.js-testable `account-merge-handler.js`.
//
// Routes on the URL pathname suffix:
//   POST /functions/v1/account-merge/begin    -> handleBeginMergeRequest
//   POST /functions/v1/account-merge/finalize -> handleFinalizeMergeRequest
//
// This file is responsible for, and ONLY for:
// - CORS
// - Extracting + verifying the authenticated user (full user object —
//   `is_anonymous`/`id`/`email` — never just the id) from the
//   Authorization header via the ANON client (never trusts a
//   client-supplied user id/email/anonymous-flag)
// - Constructing the SERVICE-ROLE client + repository used to call the
//   SECURITY DEFINER RPCs (service_role key NEVER leaves this server-side
//   file; the browser never receives or holds it)
// - Parsing the JSON request body
// - Constructing a single correlationId for the whole flow
// - Delegating to the shared handler
// - Translating the handler's `{ statusCode, body }` result into a
//   `Response` (including the `X-Correlation-Id` header)
//
// NOT deployed to any Supabase project by this task (P-AUTH-05B-1,
// requirement 8) — implementation + local tests only.

import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { resolveAuthenticatedUser, createServiceClient } from "../_shared/supabase-clients.ts";
import { handleBeginMergeRequest, handleFinalizeMergeRequest } from "../_shared/account-merge-handler.ts";
import { createAccountMergeRepositoryFromSupabaseClient } from "../_shared/lib/account-merge-repository.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  const correlationId = crypto.randomUUID();

  if (req.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Only POST is supported." },
    }, correlationId, req);
  }

  const pathname = new URL(req.url).pathname;
  const isBegin = pathname.endsWith("/begin");
  const isFinalize = pathname.endsWith("/finalize");

  if (!isBegin && !isFinalize) {
    return jsonResponse(404, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Unknown account-merge route." },
    }, correlationId, req);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch (_error) {
    return jsonResponse(400, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." },
    }, correlationId, req);
  }

  // The caller's identity ALWAYS comes from here — the anon client
  // verifies the JWT's signature/expiry via `auth.getUser(token)` before
  // returning a user object. Never derived from `body`.
  const user = await resolveAuthenticatedUser(req);

  // Service-role client: used ONLY server-side to call the SECURITY
  // DEFINER RPCs (both granted to `service_role` alone). NEVER exposed to
  // the browser.
  const repository = createAccountMergeRepositoryFromSupabaseClient({
    supabaseClient: createServiceClient(),
  });

  try {
    const result = isBegin
      ? await handleBeginMergeRequest({ body, user, correlationId, deps: { repository } })
      : await handleFinalizeMergeRequest({ body, user, correlationId, deps: { repository } });

    return jsonResponse(result.statusCode, result.body, correlationId, req);
  } catch (error) {
    // Hotfix (P-AUTH-05B-1 hotfix, requirement 6): never log the raw
    // error message/claimToken/email/Authorization/request body here —
    // an unhandled exception's message is not guaranteed to be free of
    // sensitive interpolated values, so only a fixed generic reason code
    // plus the error's constructor/type name (never its message/stack
    // content) is logged.
    console.error(JSON.stringify({
      level: "error",
      event: "account_merge_unhandled_error",
      correlationId,
      reason: "UNHANDLED_EXCEPTION",
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    }));

    return jsonResponse(500, {
      ok: false,
      error: { code: "MERGE_CLAIM_INVALID", message: "Unexpected server error." },
    }, correlationId, req);
  }
});
