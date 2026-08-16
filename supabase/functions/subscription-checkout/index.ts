// Supabase Edge Function: subscription-checkout
//
// Thin Deno HTTP boundary ONLY (mirrors wallpaper-generate/index.ts's
// convention). All Checkout Authorization business rules (Section 11 Cases
// 1-5: JWT/Anonymous/Identity checks, dedupe against an existing
// subscription, Checkout Session creation) live in
// `supabase/functions/_shared/subscription-checkout-handler.ts` and its
// `_shared/lib/*.ts` ESM ports — line-for-line equivalents of the reviewed
// CommonJS modules under `js/services/**`, kept in sync with the
// Node.js-testable `subscription-checkout-handler.js`.
//
// PLACEHOLDER (P-AUTH-04, explicitly out of scope — see
// prompts-auth-04.md): no `subscriptions` table exists yet and no real
// payment provider is wired ("不修改 Database Schema" / "不實作
// Payment"). The shared handler's default placeholder repository/checkout
// creator are used here (no `deps` override) — replace once the real
// schema/payment provider exist (tracked for P-AUTH-05).
//
// This file is responsible for, and ONLY for:
// - CORS
// - Extracting + verifying the authenticated user (full user object, not
//   just the id — Checkout Authorization needs is_anonymous/
//   email_confirmed_at/identities) from the Authorization header
// - Parsing the JSON request body
// - Constructing a single correlationId for the whole flow
// - Delegating to the shared handler
// - Translating the handler's `{ statusCode, body }` result into a
//   `Response` (including the `X-Correlation-Id` header)

import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { resolveAuthenticatedUser } from "../_shared/supabase-clients.ts";
import { handleCheckoutRequest } from "../_shared/subscription-checkout-handler.ts";

function extractBearerToken(req: Request): string {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  return authHeader?.replace(/^Bearer\s+/i, "").trim() || "";
}

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

  const user = await resolveAuthenticatedUser(req);
  const token = extractBearerToken(req);

  // Supabase's own `auth.getUser(token)` (inside resolveAuthenticatedUser)
  // already verified the JWT's signature/expiry before returning a user, so
  // treating it as non-expiring here is safe — never re-derive expiry from
  // client-supplied data.
  const session = user && token ? { user, access_token: token } : null;

  try {
    const result = await handleCheckoutRequest({
      body,
      session,
      user,
      correlationId,
      deps: {},
    });

    return jsonResponse(result.statusCode, result.body, correlationId);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "subscription_checkout_unhandled_error",
      correlationId,
      message: error instanceof Error ? error.message : "unknown",
    }));

    return jsonResponse(500, {
      ok: false,
      error: { code: "CHECKOUT_CREATION_FAILED", message: "Unexpected server error." },
    }, correlationId);
  }
});
