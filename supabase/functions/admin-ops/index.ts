// PROD-RELEASE-DAY3C (line 151-198): minimal admin backend Edge Function.
// verify_jwt=true (see supabase/config.toml). Admin status is re-checked
// SERVER-SIDE on every single action via is_admin_user() — this file never
// trusts any client-supplied role/flag.

import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { resolveAuthenticatedUser, createServiceClient } from "../_shared/supabase-clients.ts";
import {
  handleAdminOpsRequest,
  createAdminOpsRepositoryFromSupabase,
} from "../_shared/admin-ops-handler.ts";

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

  const user = await resolveAuthenticatedUser(req);

  try {
    const serviceClient = createServiceClient();
    const result = await handleAdminOpsRequest({
      body,
      user,
      correlationId,
      deps: {
        repository: createAdminOpsRepositoryFromSupabase(serviceClient),
      },
    });

    return jsonResponse(result.statusCode, result.body, correlationId, req);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "admin_ops_unhandled_error",
      correlationId,
      reason: "UNHANDLED_EXCEPTION",
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    }));

    return jsonResponse(500, {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Unexpected error." },
    }, correlationId, req);
  }
});
