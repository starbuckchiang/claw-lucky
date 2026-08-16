"use strict";

/**
 * Node.js-testable CJS twin of `cors.ts` (P-AUTH-05C.1). Unlike every
 * other shared module in `supabase/functions/_shared/**`, `cors.ts` had
 * NO `.js` twin before this task — CORS handling was considered "not a
 * Business Rule" and Deno-only. This twin exists SOLELY so the
 * origin-allowlist logic (§requirement: no fake `Access-Control-Allow-
 * Origin` for a disallowed Origin, correct value for allowed ones) can be
 * covered by an automated `node --test` — the Supabase Edge Runtime
 * itself still loads `cors.ts`, never this file. Whenever the allowlist/
 * header logic changes in `cors.ts`, mirror the change here (same
 * function names, same behavior) — same discipline as every other
 * `.js`/`.ts` twin pair in this repo, just with the roles reversed (here
 * `.ts` is deployed, `.js` is test-only).
 *
 * Uses `process.env.ALLOWED_ORIGIN_EXTRA` in place of `Deno.env.get(...)`
 * — the Node-side equivalent of the same environment-variable extension
 * point.
 */

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5500", "http://localhost:5588"];

function getAllowedOrigins() {
  const extra = process.env.ALLOWED_ORIGIN_EXTRA || "";
  const extraOrigins = extra
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins];
}

function resolveAllowOrigin(requestOrigin) {
  const allowed = getAllowedOrigins();
  if (requestOrigin === null || typeof requestOrigin === "undefined") {
    return allowed[0];
  }
  return allowed.includes(requestOrigin) ? requestOrigin : null;
}

function buildCorsHeaders(requestOrigin) {
  const allowOrigin = resolveAllowOrigin(requestOrigin);
  const headers = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-correlation-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin"
  };
  if (allowOrigin !== null) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return headers;
}

const CORS_HEADERS = buildCorsHeaders(null);

function handleCorsPreflight(req) {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: buildCorsHeaders(req.headers.get("Origin"))
    });
  }
  return null;
}

function jsonResponse(statusCode, body, correlationId, req) {
  const headers = {
    ...buildCorsHeaders(req ? req.headers.get("Origin") : null),
    "Content-Type": "application/json"
  };

  if (correlationId) {
    headers["X-Correlation-Id"] = correlationId;
  }

  return new Response(JSON.stringify(body), { status: statusCode, headers });
}

module.exports = {
  CORS_HEADERS,
  getAllowedOrigins,
  resolveAllowOrigin,
  buildCorsHeaders,
  handleCorsPreflight,
  jsonResponse
};
