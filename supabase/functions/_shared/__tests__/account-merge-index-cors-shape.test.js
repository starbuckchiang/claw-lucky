"use strict";

/**
 * P-AUTH-05C-MERGE-CORS: static structural tests for
 * `supabase/functions/account-merge/index.ts` — fixes the same
 * "jsonResponse(...) never passes req" CORS bug already fixed once for
 * `wallet-ops/index.ts` and once for `shop-ops/index.ts` this session.
 * Without this fix, `buildCorsHeaders(null)` falls back to the FIRST
 * allowed origin (`http://localhost:5500`) on every actual POST response,
 * instead of echoing the caller's real `Origin` header — this silently
 * broke every real browser call to `account-merge/begin`/`finalize` from
 * any OTHER allowed origin (e.g. `http://localhost:5588`), confirmed live
 * in `review-auth-05C-account-merge-e2e.md`.
 *
 * SAME LIMITATION as every other `.ts`-only migration/entrypoint test in
 * this repo: no Deno runtime available locally, so this file is never
 * actually imported/executed here — these are STATIC text assertions on
 * the `.ts` source only. Real behavior is verified by the live CORS smoke
 * test in `review-auth-05C-account-merge-cors-final.md`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const INDEX_TS = fs.readFileSync(
  path.join(__dirname, "..", "..", "account-merge", "index.ts"),
  "utf8"
);

test("account-merge/index.ts: handleCorsPreflight(req) runs before any route/JWT/body parsing", () => {
  const preflightIdx = INDEX_TS.indexOf("handleCorsPreflight(req)");
  const methodCheckIdx = INDEX_TS.indexOf('req.method !== "POST"');
  const bodyParseIdx = INDEX_TS.indexOf("await req.json()");
  const resolveUserIdx = INDEX_TS.indexOf("resolveAuthenticatedUser(req)");

  assert.ok(preflightIdx > -1, "handleCorsPreflight(req) call not found");
  assert.ok(preflightIdx < methodCheckIdx);
  assert.ok(preflightIdx < bodyParseIdx);
  assert.ok(preflightIdx < resolveUserIdx);
});

test("account-merge/index.ts: every jsonResponse(...) call passes req as its 4th argument (the exact fix for this bug)", () => {
  // Matches `jsonResponse(<statusCode>, {...}, correlationId, req)` across
  // the multi-line call sites in this file — every call must end with
  // `correlationId, req);` (not just `correlationId);`).
  const jsonResponseCalls = INDEX_TS.match(/jsonResponse\(\s*[\s\S]*?\bcorrelationId(?:,\s*req)?\s*\);/g) || [];
  assert.ok(jsonResponseCalls.length >= 5, `expected at least 5 jsonResponse(...) call sites, found ${jsonResponseCalls.length}`);

  for (const call of jsonResponseCalls) {
    assert.match(
      call,
      /correlationId,\s*req\);$/,
      `jsonResponse call does not pass req as the 4th argument: ${call}`
    );
  }
});

test("account-merge/index.ts: no jsonResponse(...) call site is missing req (no bare 'correlationId);' terminator remains)", () => {
  assert.doesNotMatch(INDEX_TS, /jsonResponse\([\s\S]*?correlationId\);/);
});

test("account-merge/index.ts: imports jsonResponse/handleCorsPreflight from the shared cors.ts (no local/duplicate CORS logic)", () => {
  assert.match(INDEX_TS, /import\s*{\s*handleCorsPreflight,\s*jsonResponse\s*}\s*from\s*"\.\.\/_shared\/cors\.ts"/);
});

test("account-merge/index.ts: business logic delegation to handleBeginMergeRequest/handleFinalizeMergeRequest is unchanged (not refactored by this CORS-only fix)", () => {
  assert.match(INDEX_TS, /await handleBeginMergeRequest\(\{ body, user, correlationId, deps: \{ repository \} \}\)/);
  assert.match(INDEX_TS, /await handleFinalizeMergeRequest\(\{ body, user, correlationId, deps: \{ repository \} \}\)/);
});
