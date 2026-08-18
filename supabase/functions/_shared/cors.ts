// Shared CORS helper for Supabase Edge Functions (Deno runtime).
// Kept intentionally tiny: CORS handling is not a Business Rule.
//
// P-AUTH-05C hotfix (wallet-ops CORS/staging): replaced the previous
// `Access-Control-Allow-Origin: *` wildcard with an explicit origin
// ALLOWLIST. No request here ever relies on cookies/credentials (only an
// `Authorization: Bearer <jwt>` header, sent explicitly by the caller), so
// a wildcard was not a strict security hole by itself — but a wildcard
// combined with `Access-Control-Allow-Credentials: true` is forbidden by
// the CORS spec, and an explicit allowlist is what this task's spec
// requires regardless. CONFIRMED origins only (no guessed/unconfirmed
// production URL is ever added — see this file's own comment below):
//   - http://localhost:5500 (this repo's documented Live Server dev port,
//     see docs/acceptance/P2-AI-03-acceptance.md and multiple prior review
//     docs)
//   - http://localhost:5588 (the beta/closed-test dev port actually used
//     to reproduce the wallet-ops CORS failure this hotfix addresses)
//   - https://starbuckchiang.github.io (P-AUTH-05D hotfix: the REAL,
//     confirmed GitHub Pages origin — an ORIGIN is scheme+host+port ONLY,
//     it never includes a path, so this is deliberately NOT
//     "https://starbuckchiang.github.io/claw-lucky" and has NO trailing
//     slash; the browser's own `Origin` request header for any page under
//     that Pages site, e.g. `/claw-lucky/gacha.html`, is always exactly
//     this value). Confirmed live via the actual CORS failure this hotfix
//     addresses (response echoed the wrong fallback origin instead of
//     this real one).
// A real deployed staging/production frontend origin can be added via the
// `ALLOWED_ORIGIN_EXTRA` environment variable (comma-separated) WITHOUT
// ever hardcoding an unconfirmed URL into source — set it on the Supabase
// project once a real staging domain exists and is confirmed.
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5500", "http://localhost:5588", "https://starbuckchiang.github.io"];

function getAllowedOrigins(): string[] {
  const extra = (globalThis as { Deno?: { env: { get(name: string): string | undefined } } }).Deno
    ?.env.get("ALLOWED_ORIGIN_EXTRA");
  const extraOrigins = (extra || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins];
}

// Resolves the ONE `Access-Control-Allow-Origin` value for a given
// request's `Origin` header: echoes it back ONLY if it is in the
// allowlist (required so the browser accepts the response — a static
// value can only ever match a single origin). If the caller sent an
// `Origin` header that is NOT in the allowlist, returns `null` — the
// header is OMITTED entirely from the response (P-AUTH-05C.1 fix: this
// previously fell back to the first allowed origin, e.g.
// `http://localhost:5500`, which would have made a disallowed origin's
// response LOOK like it came from an allowed one; omitting the header is
// the correct, honest "explicit reject" — the browser's own CORS check
// then fails for that caller, exactly as intended). A request with NO
// `Origin` header at all (e.g. a non-browser caller — curl, a
// server-to-server call) is not subject to CORS in the first place, so it
// falls back to the first allowed origin purely for a stable/non-empty
// header value; this is never security-relevant since CORS only ever
// applies to real browser requests, which always send `Origin`.
// NOTE: none of this is a security boundary by itself — ownership/JWT
// verification still happens inside every handler regardless of what this
// returns; this only stops OTHER arbitrary sites from being able to READ
// a success response via a browser.
function resolveAllowOrigin(requestOrigin: string | null): string | null {
  const allowed = getAllowedOrigins();
  if (requestOrigin === null) {
    return allowed[0];
  }
  return allowed.includes(requestOrigin) ? requestOrigin : null;
}

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const allowOrigin = resolveAllowOrigin(requestOrigin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-correlation-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
  if (allowOrigin !== null) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return headers;
}

// Kept exported for any existing caller that imports the constant
// directly — resolves against no particular request Origin (falls back
// to the first allowed origin). Prefer `buildCorsHeaders(req)` /
// `handleCorsPreflight(req)` / `jsonResponse(..., req)` for a
// request-aware value.
export const CORS_HEADERS: Record<string, string> = buildCorsHeaders(null);

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: buildCorsHeaders(req.headers.get("Origin")),
    });
  }
  return null;
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
  correlationId?: string | null,
  req?: Request,
): Response {
  const headers: Record<string, string> = {
    ...buildCorsHeaders(req ? req.headers.get("Origin") : null),
    "Content-Type": "application/json",
  };

  if (correlationId) {
    headers["X-Correlation-Id"] = correlationId;
  }

  return new Response(JSON.stringify(body), { status: statusCode, headers });
}

