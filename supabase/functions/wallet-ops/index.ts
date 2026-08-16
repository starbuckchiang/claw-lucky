// Supabase Edge Function: wallet-ops
//
// Thin Deno HTTP boundary ONLY (mirrors account-merge/index.ts's
// convention). All business rules for the secure writes this phase
// replaces (requirement 1/2) live in
// `supabase/functions/_shared/wallet-ops-handler.ts` and its
// `_shared/lib/wallet-ops-repository.ts` ESM port — a line-for-line
// equivalent of the reviewed CommonJS modules under `js/services/wallet/`,
// kept in sync with the Node.js-testable `wallet-ops-handler.js`.
//
// Routes on the URL pathname suffix (P-AUTH-05B-2A Hotfix requirements
// 2/3 REMOVED `adjust-balance`/`upsert-mascot` — there is no longer any
// public route accepting arbitrary balance deltas or a standalone mascot
// upsert; see wallet-ops-handler.ts's header for the full rationale):
//   POST /functions/v1/wallet-ops/ensure-user  -> handleEnsureUserRequest
//   POST /functions/v1/wallet-ops/gacha-draw   -> handleGachaDrawRequest
//   POST /functions/v1/wallet-ops/gift-redeem  -> handleGiftRedeemRequest
//
// This file is responsible for, and ONLY for:
// - CORS
// - Extracting + verifying the authenticated user (full user object) from
//   the Authorization header via the ANON client (never trusts a
//   client-supplied user id — requirement 2)
// - Constructing the SERVICE-ROLE client + repository used to call the
//   SECURITY DEFINER RPCs (service_role key NEVER leaves this server-side
//   file; the browser never receives or holds it)
// - Parsing the JSON request body
// - Constructing a single correlationId for the whole flow
// - Delegating to the shared handler
// - Translating the handler's `{ statusCode, body }` result into a
//   `Response` (including the `X-Correlation-Id` header)
//
// NOT deployed to any Supabase project by this task (P-AUTH-05B-2A,
// requirement 10 / hotfix requirement 8) — implementation + local tests
// only.

import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { resolveAuthenticatedUser, createServiceClient } from "../_shared/supabase-clients.ts";
import {
  handleEnsureUserRequest,
  handleGachaDrawRequest,
  handleGiftRedeemRequest,
} from "../_shared/wallet-ops-handler.ts";
import { createWalletOpsRepositoryFromSupabaseClient } from "../_shared/lib/wallet-ops-repository.ts";

const ROUTES: Record<string, (
  // deno-lint-ignore no-explicit-any
  args: any,
  // deno-lint-ignore no-explicit-any
) => Promise<any>> = {
  "ensure-user": handleEnsureUserRequest,
  "gacha-draw": handleGachaDrawRequest,
  "gift-redeem": handleGiftRedeemRequest,
};

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  const correlationId = crypto.randomUUID();

  if (req.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Only POST is supported." },
    }, correlationId);
  }

  const pathname = new URL(req.url).pathname;
  const routeName = Object.keys(ROUTES).find((name) => pathname.endsWith(`/${name}`));

  if (!routeName) {
    return jsonResponse(404, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Unknown wallet-ops route." },
    }, correlationId);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch (_error) {
    return jsonResponse(400, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." },
    }, correlationId);
  }

  // The caller's identity ALWAYS comes from here — never derived from
  // `body` (requirement 2).
  const user = await resolveAuthenticatedUser(req);

  // Service-role client: used ONLY server-side to call the SECURITY
  // DEFINER RPCs. NEVER exposed to the browser.
  const repository = createWalletOpsRepositoryFromSupabaseClient({
    supabaseClient: createServiceClient(),
  });

  try {
    const handler = ROUTES[routeName];
    const result = await handler({ body, user, correlationId, deps: { repository } });
    return jsonResponse(result.statusCode, result.body, correlationId);
  } catch (error) {
    // Requirement 8: never log the raw error message/user id/JWT/body —
    // only a fixed generic reason plus the error's type name.
    console.error(JSON.stringify({
      level: "error",
      event: "wallet_ops_unhandled_error",
      correlationId,
      reason: "UNHANDLED_EXCEPTION",
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    }));

    return jsonResponse(500, {
      ok: false,
      error: { code: "WALLET_OPS_FAILED", message: "Unexpected server error." },
    }, correlationId);
  }
});
