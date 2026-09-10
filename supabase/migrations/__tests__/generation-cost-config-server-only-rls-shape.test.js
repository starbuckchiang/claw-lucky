"use strict";

/**
 * Auth-SEC-01B: Static structural tests for the generation_cost_config
 * SERVER_ONLY RLS fix migration (sibling of the SEC-01A prompt_versions fix).
 *
 * Same limitation as rls-policy-shape.test.js: static SQL-text assertions,
 * not live RLS enforcement proof. Live verification is done via
 * `supabase db query --linked` in the SEC-01B review doc.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "..");

function statementsOnly(filename) {
  // Header comments quote forbidden patterns; assert only real statement lines.
  return fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const SQL = statementsOnly("20260910000200_generation_cost_config_server_only_rls.sql");

test("generation_cost_config_server_only_rls: enables RLS", () => {
  assert.match(SQL, /ALTER TABLE public\.generation_cost_config ENABLE ROW LEVEL SECURITY;/);
});

test("generation_cost_config_server_only_rls: revokes all privileges from anon and authenticated", () => {
  assert.match(SQL, /REVOKE ALL PRIVILEGES ON TABLE public\.generation_cost_config FROM anon, authenticated;/);
});

test("generation_cost_config_server_only_rls: creates NO policies and no permissive patterns", () => {
  assert.doesNotMatch(SQL, /CREATE POLICY/i);
  assert.doesNotMatch(SQL, /USING\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(SQL, /WITH CHECK\s*\(\s*true\s*\)/i);
});

test("generation_cost_config_server_only_rls: never disables/forces RLS, never grants", () => {
  assert.doesNotMatch(SQL, /DISABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(SQL, /FORCE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(SQL, /^\s*GRANT\b/m);
});

test("generation_cost_config_server_only_rls: does not touch table shape or data", () => {
  assert.doesNotMatch(SQL, /\b(DROP TABLE|ALTER TABLE public\.generation_cost_config (ADD|DROP|ALTER) |INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)\b/i);
});

test("sibling prompt_versions fix migration still intact (no regression)", () => {
  const pvSql = statementsOnly("20260910000100_prompt_versions_server_only_rls.sql");
  assert.match(pvSql, /ALTER TABLE public\.prompt_versions ENABLE ROW LEVEL SECURITY;/);
  assert.match(pvSql, /REVOKE ALL PRIVILEGES ON TABLE public\.prompt_versions FROM anon, authenticated;/);
});

test("original create migration still has no RLS statement (fix stays in new files only)", () => {
  const createSql = fs.readFileSync(
    path.join(MIGRATIONS_DIR, "20260712040000_create_wallpaper_core_tables.sql"),
    "utf8"
  );
  assert.doesNotMatch(createSql, /ROW LEVEL SECURITY/i);
});
