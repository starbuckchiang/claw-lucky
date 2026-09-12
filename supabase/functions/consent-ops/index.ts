// Supabase Edge Function: consent-ops (WEB-HOME-01A)
//
// Thin Deno HTTP boundary ONLY (mirrors wallet-ops/index.ts's convention).
// All business rules live in `supabase/functions/_shared/consent-ops-handler.ts`,
// kept in sync with the Node.js-testable `consent-ops-handler.js`.
//
// Route:
//   POST /functions/v1/consent-ops/record -> handleRecordConsentRequest
//
// This file is responsible for, and ONLY for:
// - CORS (every jsonResponse call passes `req` — see the recurring bug
//   documented in review-auth-05C.1)
// - Extracting + verifying the authenticated user from the Authorization
//   header (never trusts a client-supplied user id)
// - Constructing the SERVICE-ROLE client + repository for the SECURITY
//   DEFINER RPC (service_role key never leaves this server-side file)
// - Parsing the JSON body, correlationId, delegating to the shared handler
//
// NOT deployed to any Supabase project by this task (WEB-HOME-01A
// section 9) — implementation + local tests only.

import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { resolveAuthenticatedUser, createServiceClient } from "../_shared/supabase-clients.ts";
import { handleRecordConsentRequest } from "../_shared/consent-ops-handler.ts";
import { createConsentOpsRepositoryFromSupabaseClient } from "../_shared/lib/consent-ops-repository.ts";

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
  if (!pathname.endsWith("/record")) {
    return jsonResponse(404, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Unknown consent-ops route." },
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

  // The caller's identity ALWAYS comes from here — never from `body`.
  const user = await resolveAuthenticatedUser(req);

  const repository = createConsentOpsRepositoryFromSupabaseClient({
    supabaseClient: createServiceClient(),
  });

  try {
    const result = await handleRecordConsentRequest({ body, user, correlationId, deps: { repository } });
    return jsonResponse(result.statusCode, result.body, correlationId, req);
  } catch (error) {
    // Never log the raw error message/user id/JWT/body — only a fixed
    // generic reason plus the error's type name.
    console.error(JSON.stringify({
      level: "error",
      event: "consent_ops_unhandled_error",
      correlationId,
      reason: "UNHANDLED_EXCEPTION",
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    }));

    return jsonResponse(500, {
      ok: false,
      error: { code: "CONSENT_OPS_FAILED", message: "Unexpected server error." },
    }, correlationId, req);
  }
});
