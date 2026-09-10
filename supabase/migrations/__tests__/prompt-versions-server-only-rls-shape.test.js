"use strict";

/**
 * Auth-SEC-01A: Static structural tests for the prompt_versions
 * SERVER_ONLY RLS emergency fix migration.
 *
 * Same limitation as rls-policy-shape.test.js: no local Postgres harness —
 * these are STATIC assertions on the migration SQL text, not live RLS
 * enforcement proof. Live verification steps are documented in the
 * migration header and review-auth-SEC-01A doc.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "..");
const SQL = fs.readFileSync(
  path.join(MIGRATIONS_DIR, "20260910000100_prompt_versions_server_only_rls.sql"),
  "utf8"
);
// Header comment quotes forbidden patterns (rollback notes, "using (true)");
// assert only against real statement lines.
const SQL_STATEMENTS = SQL.split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

test("prompt_versions_server_only_rls: enables RLS on public.prompt_versions", () => {
  assert.match(SQL, /ALTER TABLE public\.prompt_versions ENABLE ROW LEVEL SECURITY;/);
});

test("prompt_versions_server_only_rls: revokes all privileges from anon and authenticated", () => {
  assert.match(SQL, /REVOKE ALL PRIVILEGES ON TABLE public\.prompt_versions FROM anon, authenticated;/);
});

test("prompt_versions_server_only_rls: creates NO policies (SERVER_ONLY deny-all)", () => {
  assert.doesNotMatch(SQL_STATEMENTS, /CREATE POLICY/i);
});

test("prompt_versions_server_only_rls: never uses a fully-permissive USING/WITH CHECK (true)", () => {
  assert.doesNotMatch(SQL_STATEMENTS, /USING\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(SQL_STATEMENTS, /WITH CHECK\s*\(\s*true\s*\)/i);
});

test("prompt_versions_server_only_rls: never disables RLS and never grants to anon/authenticated", () => {
  assert.doesNotMatch(SQL_STATEMENTS, /DISABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(SQL_STATEMENTS, /^\s*GRANT\b/m);
  assert.doesNotMatch(SQL_STATEMENTS, /FORCE ROW LEVEL SECURITY/i);
});

test("prompt_versions_server_only_rls: does not touch table shape or data", () => {
  assert.doesNotMatch(SQL_STATEMENTS, /\b(DROP TABLE|ALTER TABLE public\.prompt_versions (ADD|DROP|ALTER) |INSERT INTO|UPDATE public\.|DELETE FROM)\b/i);
});

test("original create migration still has no RLS statement (fix must stay in the new file, never rewrite applied migrations)", () => {
  const createSql = fs.readFileSync(
    path.join(MIGRATIONS_DIR, "20260712040100_create_prompt_versions.sql"),
    "utf8"
  );
  assert.doesNotMatch(createSql, /ROW LEVEL SECURITY/i);
});
