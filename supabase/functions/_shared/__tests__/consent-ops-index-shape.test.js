"use strict";

// Static boundary tests for consent-ops/index.ts (Deno cannot be executed
// in this environment). Pins JWT-derived identity, service-role repository
// wiring, request-aware CORS responses, and absence of sensitive logging.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "consent-ops", "index.ts"),
  "utf8"
);

const STATEMENTS = SOURCE
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

test("consent-ops resolves user from verified JWT and passes that user to the handler", () => {
  assert.match(STATEMENTS, /const user = await resolveAuthenticatedUser\(req\);/);
  assert.match(STATEMENTS, /handleRecordConsentRequest\(\{ body, user, correlationId, deps: \{ repository \} \}\)/);
  assert.doesNotMatch(STATEMENTS, /body\.(userId|user_id|ownerId|owner_id)/);
});

test("consent-ops uses the service-role client only for the protected repository", () => {
  assert.match(STATEMENTS, /createConsentOpsRepositoryFromSupabaseClient\(\{\s*supabaseClient: createServiceClient\(\),/);
});

test("every jsonResponse call passes req (dynamic CORS origin)", () => {
  const calls = STATEMENTS.match(/jsonResponse\([\s\S]*?\}, correlationId, req\)/g) || [];
  assert.equal(calls.length, 4);
  assert.doesNotMatch(STATEMENTS, /\}, correlationId\);/);
});

test("entrypoint logs only fixed metadata — never request body, JWT, email, or user id", () => {
  const logBlock = STATEMENTS.match(/console\.error\(JSON\.stringify\(\{[\s\S]*?\}\)\);/);
  assert.ok(logBlock, "structured error log block not found");
  assert.doesNotMatch(logBlock[0], /body|authorization|jwt|email|user\.id|userId/i);
  assert.match(logBlock[0], /correlationId/);
  assert.match(logBlock[0], /reason/);
});
