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
