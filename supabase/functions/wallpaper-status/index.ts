// Supabase Edge Function: wallpaper-status
//
// Thin Deno HTTP boundary for the read-only Generation Status / Progress API
// (ADR-006). All ownership/status-mapping/polling-interval rules live in the
// reused `generation-query-service.js` (unchanged).
//
// Request contract: GET /wallpaper-status?id=<generationId>
// (Supabase Edge Functions do not route path params without extra config;
// a query string keeps this Function trivially deployable.)

import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, resolveAuthenticatedUserId } from "../_shared/supabase-clients.ts";
import { requireSharedStatusHandler } from "../_shared/node-require.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  const correlationId = crypto.randomUUID();

  if (req.method !== "GET") {
    return jsonResponse(405, {
      ok: false,
      error: { code: "INVALID_STATUS_RESPONSE", message: "Only GET is supported.", retryable: false },
    }, correlationId);
  }

  const url = new URL(req.url);
  const generationId = url.searchParams.get("id") || "";

  const userId = await resolveAuthenticatedUserId(req);

  const { handleStatusRequest } = requireSharedStatusHandler();

  try {
    const supabaseClient = createServiceClient();

    const result = await handleStatusRequest({
      generationId,
      userId,
      correlationId,
      deps: { supabaseClient },
    });

    return jsonResponse(result.statusCode, result.body, correlationId);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "wallpaper_status_unhandled_error",
      correlationId,
      message: error instanceof Error ? error.message : "unknown",
    }));

    return jsonResponse(500, {
      ok: false,
      error: { code: "QUERY_FAILURE", message: "Unexpected server error.", retryable: true },
    }, correlationId);
  }
});
