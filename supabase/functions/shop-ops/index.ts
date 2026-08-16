// Supabase Edge Function: shop-ops
//
// Thin Deno HTTP boundary ONLY (mirrors wallet-ops/index.ts's convention).
// All business rules live in `supabase/functions/_shared/shop-ops-handler.ts`
// and its `_shared/lib/shop-ops-repository.ts` ESM port — a line-for-line
// equivalent of the reviewed CommonJS modules under `js/services/shop/`.
//
// Routes on the URL pathname suffix:
//   POST /functions/v1/shop-ops/cart-add     -> handleCartAddRequest
//   POST /functions/v1/shop-ops/cart-update  -> handleCartUpdateRequest
//   POST /functions/v1/shop-ops/cart-remove  -> handleCartRemoveRequest
//   POST /functions/v1/shop-ops/cart-clear   -> handleCartClearRequest
//   POST /functions/v1/shop-ops/checkout     -> handleCheckoutRequest
//
// This file is responsible for, and ONLY for:
// - CORS
// - Extracting + verifying the authenticated user (full user object) from
//   the Authorization header via the ANON client (never trusts a
//   client-supplied user id)
// - Constructing the SERVICE-ROLE client + repository used to call the
//   SECURITY DEFINER RPCs (service_role key NEVER leaves this server-side
//   file; the browser never receives or holds it)
// - Parsing the JSON request body
// - Constructing a single correlationId for the whole flow
// - Delegating to the shared handler
// - Translating the handler's `{ statusCode, body }` result into a
//   `Response` (including the `X-Correlation-Id` header)
//
// NOT deployed to any Supabase project by this task (P-AUTH-05B-2B) —
// implementation + local tests only.

import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { resolveAuthenticatedUser, createServiceClient } from "../_shared/supabase-clients.ts";
import {
  handleCartAddRequest,
  handleCartUpdateRequest,
  handleCartRemoveRequest,
  handleCartClearRequest,
  handleCheckoutRequest,
} from "../_shared/shop-ops-handler.ts";
import { createShopOpsRepositoryFromSupabaseClient } from "../_shared/lib/shop-ops-repository.ts";

const ROUTES: Record<string, (
  // deno-lint-ignore no-explicit-any
  args: any,
  // deno-lint-ignore no-explicit-any
) => Promise<any>> = {
  "cart-add": handleCartAddRequest,
  "cart-update": handleCartUpdateRequest,
  "cart-remove": handleCartRemoveRequest,
  "cart-clear": handleCartClearRequest,
  "checkout": handleCheckoutRequest,
};

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
  const routeName = Object.keys(ROUTES).find((name) => pathname.endsWith(`/${name}`));

  if (!routeName) {
    return jsonResponse(404, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Unknown shop-ops route." },
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

  // The caller's identity ALWAYS comes from here — never derived from
  // `body`.
  const user = await resolveAuthenticatedUser(req);

  // Service-role client: used ONLY server-side to call the SECURITY
  // DEFINER RPCs. NEVER exposed to the browser.
  const repository = createShopOpsRepositoryFromSupabaseClient({
    supabaseClient: createServiceClient(),
  });

  try {
    const handler = ROUTES[routeName];
    const result = await handler({ body, user, correlationId, deps: { repository } });
    return jsonResponse(result.statusCode, result.body, correlationId, req);
  } catch (error) {
    // Never log the raw error message/user id/JWT/body — only a fixed
    // generic reason plus the error's type name.
    console.error(JSON.stringify({
      level: "error",
      event: "shop_ops_unhandled_error",
      correlationId,
      reason: "UNHANDLED_EXCEPTION",
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    }));

    return jsonResponse(500, {
      ok: false,
      error: { code: "SHOP_OPS_FAILED", message: "Unexpected server error." },
    }, correlationId, req);
  }
});
