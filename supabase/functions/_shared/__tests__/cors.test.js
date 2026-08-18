"use strict";

/**
 * P-AUTH-05C.1: Node tests for the shared CORS allowlist logic
 * (`cors.js`, the Node-testable CJS twin of `cors.ts` — see that file's
 * header for why this twin exists, uniquely among `_shared/**` modules).
 *
 * Covers the exact scenarios required by the 05C.1 preflight task:
 *   - OPTIONS and a real POST response from an ALLOWED origin
 *     (`http://localhost:5588`, `http://localhost:5500`) both return
 *     `Access-Control-Allow-Origin` matching that exact origin.
 *   - A DISALLOWED origin never receives a fake/fallback allowed origin
 *     (e.g. `http://localhost:5500`) — the header is OMITTED entirely.
 *   - A request with no `Origin` header at all (non-browser caller) still
 *     gets a stable header value (not security-relevant — CORS doesn't
 *     apply to non-browser callers).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  resolveAllowOrigin,
  buildCorsHeaders,
  handleCorsPreflight,
  jsonResponse
} = require("../cors");

function requestWithOrigin(origin, { method = "GET" } = {}) {
  const headers = origin ? { Origin: origin } : {};
  return new Request("https://example.supabase.co/functions/v1/shop-ops/checkout", { method, headers });
}

test("resolveAllowOrigin: echoes back an ALLOWED origin exactly", () => {
  assert.equal(resolveAllowOrigin("http://localhost:5588"), "http://localhost:5588");
  assert.equal(resolveAllowOrigin("http://localhost:5500"), "http://localhost:5500");
});

test("resolveAllowOrigin: a DISALLOWED origin resolves to null (never a fake fallback origin)", () => {
  assert.equal(resolveAllowOrigin("https://evil.example.com"), null);
});

test("resolveAllowOrigin: no Origin header at all (non-browser caller) falls back to the first allowed origin", () => {
  assert.equal(resolveAllowOrigin(null), "http://localhost:5500");
});

test("buildCorsHeaders: ALLOWED origin -> Access-Control-Allow-Origin header present and correct", () => {
  const headers = buildCorsHeaders("http://localhost:5588");
  assert.equal(headers["Access-Control-Allow-Origin"], "http://localhost:5588");
  assert.match(headers["Access-Control-Allow-Headers"], /authorization/);
  assert.match(headers["Access-Control-Allow-Headers"], /x-client-info/);
  assert.match(headers["Access-Control-Allow-Headers"], /apikey/);
  assert.match(headers["Access-Control-Allow-Headers"], /content-type/);
  assert.match(headers["Access-Control-Allow-Methods"], /POST/);
  assert.match(headers["Access-Control-Allow-Methods"], /OPTIONS/);
});

test("buildCorsHeaders: DISALLOWED origin -> Access-Control-Allow-Origin key is ABSENT (never localhost:5500 as a fake stand-in)", () => {
  const headers = buildCorsHeaders("https://evil.example.com");
  assert.equal(Object.prototype.hasOwnProperty.call(headers, "Access-Control-Allow-Origin"), false);
  assert.notEqual(headers["Access-Control-Allow-Origin"], "http://localhost:5500");
});

test("handleCorsPreflight: OPTIONS from http://localhost:5588 -> 200 with matching Access-Control-Allow-Origin", () => {
  const req = requestWithOrigin("http://localhost:5588", { method: "OPTIONS" });
  const response = handleCorsPreflight(req);

  assert.ok(response, "expected a Response, got null");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5588");
});

test("handleCorsPreflight: OPTIONS from http://localhost:5500 -> 200 with matching Access-Control-Allow-Origin", () => {
  const req = requestWithOrigin("http://localhost:5500", { method: "OPTIONS" });
  const response = handleCorsPreflight(req);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5500");
});

test("handleCorsPreflight: OPTIONS from a disallowed origin -> still 200 (per this app's CORS design), but NO Access-Control-Allow-Origin header at all", () => {
  const req = requestWithOrigin("https://evil.example.com", { method: "OPTIONS" });
  const response = handleCorsPreflight(req);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("handleCorsPreflight: non-OPTIONS request returns null (caller must continue normal routing)", () => {
  const req = requestWithOrigin("http://localhost:5588", { method: "POST" });
  assert.equal(handleCorsPreflight(req), null);
});

test("jsonResponse: a real POST response (req passed through) echoes the caller's ALLOWED origin — this is the exact bug this task fixes (shop-ops previously never passed req)", () => {
  const req = requestWithOrigin("http://localhost:5588", { method: "POST" });
  const response = jsonResponse(200, { ok: true, data: {} }, "corr-1", req);

  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5588");
  assert.equal(response.headers.get("X-Correlation-Id"), "corr-1");
  assert.equal(response.headers.get("Content-Type"), "application/json");
});

test("jsonResponse: an ERROR response (4xx/5xx) ALSO echoes the caller's ALLOWED origin — CORS headers must be identical on success and error paths", () => {
  const req = requestWithOrigin("http://localhost:5588", { method: "POST" });
  const errorResponse = jsonResponse(400, { ok: false, error: { code: "INVALID_REQUEST" } }, "corr-2", req);

  assert.equal(errorResponse.headers.get("Access-Control-Allow-Origin"), "http://localhost:5588");
});

test("jsonResponse: called WITHOUT req (the pre-fix shop-ops bug) falls back to the first allowed origin — documented, not a security issue, but demonstrates why passing req matters for a real localhost:5588 caller", () => {
  const response = jsonResponse(200, { ok: true }, "corr-3");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5500");
  assert.notEqual(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5588");
});

test("jsonResponse: a disallowed origin never receives a fake allowed origin on an error response either", () => {
  const req = requestWithOrigin("https://evil.example.com", { method: "POST" });
  const response = jsonResponse(403, { ok: false, error: { code: "FORBIDDEN" } }, "corr-4", req);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

// --- P-AUTH-05D hotfix: real GitHub Pages origin (https://starbuckchiang.github.io) ---

test("resolveAllowOrigin: echoes back the real GitHub Pages origin exactly (scheme+host only, no /claw-lucky path, no trailing slash)", () => {
  assert.equal(resolveAllowOrigin("https://starbuckchiang.github.io"), "https://starbuckchiang.github.io");
});

test("resolveAllowOrigin: a lookalike origin (subdomain/path variant) is NOT fooled into matching the GitHub Pages allowlist entry", () => {
  assert.equal(resolveAllowOrigin("https://starbuckchiang.github.io.evil.com"), null);
  assert.equal(resolveAllowOrigin("https://evil.starbuckchiang.github.io"), null);
  assert.equal(resolveAllowOrigin("http://starbuckchiang.github.io"), null); // wrong scheme
});

test("handleCorsPreflight: OPTIONS from https://starbuckchiang.github.io -> 200 with Access-Control-Allow-Origin exactly matching (no path, no trailing slash)", () => {
  const req = requestWithOrigin("https://starbuckchiang.github.io", { method: "OPTIONS" });
  const response = handleCorsPreflight(req);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://starbuckchiang.github.io");
});

test("jsonResponse: a real POST success response from GitHub Pages echoes the exact GitHub Pages origin", () => {
  const req = requestWithOrigin("https://starbuckchiang.github.io", { method: "POST" });
  const response = jsonResponse(200, { ok: true, data: {} }, "corr-5", req);

  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://starbuckchiang.github.io");
});

test("jsonResponse: an ERROR response from GitHub Pages ALSO echoes the exact GitHub Pages origin (success and error paths identical)", () => {
  const req = requestWithOrigin("https://starbuckchiang.github.io", { method: "POST" });
  const response = jsonResponse(400, { ok: false, error: { code: "INVALID_REQUEST" } }, "corr-6", req);

  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://starbuckchiang.github.io");
});

test("resolveAllowOrigin: localhost:5500/5588 remain allowed alongside the new GitHub Pages origin (no regression)", () => {
  assert.equal(resolveAllowOrigin("http://localhost:5500"), "http://localhost:5500");
  assert.equal(resolveAllowOrigin("http://localhost:5588"), "http://localhost:5588");
});

test("resolveAllowOrigin: https://evil.example.com still resolves to null (no wildcard, no accidental broadening)", () => {
  assert.equal(resolveAllowOrigin("https://evil.example.com"), null);
});

// --- P-AUTH-05D hotfix: wallet-ops, shop-ops, and account-merge all
// import the SAME shared cors.ts — this one allowlist fix applies to all
// three without any per-function CORS logic to keep in sync. ---

test("wallet-ops/shop-ops/account-merge entrypoints all import handleCorsPreflight/jsonResponse from the SAME shared ../_shared/cors.ts (no duplicated/divergent CORS logic)", () => {
  const entrypoints = [
    path.join(__dirname, "..", "..", "wallet-ops", "index.ts"),
    path.join(__dirname, "..", "..", "shop-ops", "index.ts"),
    path.join(__dirname, "..", "..", "account-merge", "index.ts")
  ];

  for (const entrypoint of entrypoints) {
    const source = fs.readFileSync(entrypoint, "utf8");
    assert.match(
      source,
      /import\s*{\s*handleCorsPreflight,\s*jsonResponse\s*}\s*from\s*"\.\.\/_shared\/cors\.ts"/,
      `${entrypoint} does not import from the shared cors.ts`
    );
  }
});
