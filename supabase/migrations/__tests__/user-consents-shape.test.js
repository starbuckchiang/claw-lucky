"use strict";

// Static structural tests for
// supabase/migrations/20260910000300_user_consents_append_only.sql
// (WEB-HOME-01A). No live Postgres in this environment — these assertions
// pin the SQL text's security-relevant structure (RLS, grants, append-only
// trigger, SECURITY DEFINER hardening, idempotent insert ordering,
// signature controls). Real permission behavior still requires a staging
// verification pass before deploy.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATION_PATH = path.join(
  __dirname,
  "..",
  "20260910000300_user_consents_append_only.sql"
);

const SQL = fs.readFileSync(MIGRATION_PATH, "utf8");

// Comment lines legitimately DISCUSS forbidden patterns (e.g. "Email, IP,
// JWT" in the header) — strip them before any negative assertion
// (established convention, see SEC-01A notes).
const SQL_STATEMENTS = SQL
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

function extractCreateTable() {
  const match = SQL.match(/^CREATE TABLE public\.user_consents \([\s\S]*?^\);/m);
  assert.ok(match, "CREATE TABLE public.user_consents block not found");
  return match[0];
}

function extractRpcBody() {
  const match = SQL.match(/^CREATE OR REPLACE FUNCTION public\.record_user_consent\([\s\S]*?^\$\$;/m);
  assert.ok(match, "record_user_consent function block not found");
  return match[0];
}

test("user_consents: all required columns exist with correct types", () => {
  const table = extractCreateTable();
  assert.match(table, /id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
  assert.match(table, /user_id uuid NOT NULL REFERENCES auth\.users \(id\)/);
  assert.match(table, /consent_scope text NOT NULL/);
  assert.match(table, /terms_version text/);
  assert.match(table, /privacy_version text/);
  assert.match(table, /terms_content_sha256 text/);
  assert.match(table, /privacy_content_sha256 text/);
  assert.match(table, /accepted_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(table, /source text NOT NULL/);
  assert.match(table, /correlation_id text/);
  assert.match(table, /idempotency_key text NOT NULL/);
  assert.match(table, /created_at timestamptz NOT NULL DEFAULT now\(\)/);
});

test("user_consents: scope and source allowlist CHECK constraints", () => {
  const table = extractCreateTable();
  assert.match(table, /consent_scope IN \('account_upgrade', 'checkout', 'digital_content_waiver'\)/);
  assert.match(table, /source IN \('subscription_page', 'account_upgrade_form'\)/);
});

test("user_consents: per-scope version/hash NOT NULL rules + sha256 shape check", () => {
  const table = extractCreateTable();
  // account_upgrade requires all four fields
  const upgradeRule = table.match(/consent_scope = 'account_upgrade'[\s\S]*?privacy_content_sha256 IS NOT NULL/);
  assert.ok(upgradeRule, "account_upgrade version/hash rule missing");
  // checkout / waiver require terms fields
  assert.match(table, /consent_scope IN \('checkout', 'digital_content_waiver'\)[\s\S]*?terms_content_sha256 IS NOT NULL/);
  assert.match(table, /~ '\^\[0-9a-f\]\{64\}\$'/);
});

test("user_consents: unique (user_id, consent_scope, idempotency_key) + key length check", () => {
  const table = extractCreateTable();
  assert.match(table, /UNIQUE \(user_id, consent_scope, idempotency_key\)/);
  assert.match(table, /char_length\(idempotency_key\) BETWEEN 8 AND 128/);
});

test("user_consents: FK never uses ON DELETE CASCADE (no silent audit deletion)", () => {
  assert.doesNotMatch(SQL_STATEMENTS, /ON DELETE CASCADE/i);
});

test("no forbidden sensitive columns (email/ip/jwt/token/payer/card/secret)", () => {
  const table = extractCreateTable();
  const statements = table
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  for (const forbidden of [/\bemail\b/i, /\bip_address\b/i, /\bjwt\b/i, /\btoken\b/i, /\bpayer\b/i, /\bcard\b/i, /\bsecret\b/i]) {
    assert.doesNotMatch(statements, forbidden);
  }
});

test("RLS enabled with owner-only SELECT policy (auth.uid() = user_id)", () => {
  assert.match(SQL_STATEMENTS, /ALTER TABLE public\.user_consents ENABLE ROW LEVEL SECURITY;/);
  assert.match(SQL_STATEMENTS, /CREATE POLICY user_consents_owner_select[\s\S]*?FOR SELECT[\s\S]*?TO authenticated[\s\S]*?USING \(auth\.uid\(\) = user_id\)/);
});

test("no INSERT/UPDATE/DELETE policy exists — writes are deny-all for clients", () => {
  const policies = SQL_STATEMENTS.match(/CREATE POLICY[\s\S]*?;/g) || [];
  assert.equal(policies.length, 1, "exactly one policy (owner SELECT) expected");
  assert.doesNotMatch(policies[0], /FOR (INSERT|UPDATE|DELETE|ALL)/);
  assert.doesNotMatch(SQL_STATEMENTS, /USING \(true\)/i);
  assert.doesNotMatch(SQL_STATEMENTS, /WITH CHECK \(true\)/i);
});

test("grants: anon fully revoked; authenticated keeps SELECT only", () => {
  assert.match(SQL_STATEMENTS, /REVOKE ALL ON TABLE public\.user_consents FROM PUBLIC;/);
  assert.match(SQL_STATEMENTS, /REVOKE ALL ON TABLE public\.user_consents FROM anon;/);
  assert.match(SQL_STATEMENTS, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.user_consents FROM authenticated;/);
  assert.match(SQL_STATEMENTS, /GRANT SELECT ON TABLE public\.user_consents TO authenticated;/);
  // Never grant broader table rights back to clients.
  assert.doesNotMatch(SQL_STATEMENTS, /GRANT (ALL|INSERT|UPDATE|DELETE)[^;]*TO (anon|authenticated)/i);
});

test("append-only trigger blocks UPDATE and DELETE for every ordinary role", () => {
  assert.match(SQL_STATEMENTS, /CREATE FUNCTION public\.prevent_user_consents_mutation\(\)/);
  assert.match(SQL_STATEMENTS, /RAISE EXCEPTION 'user_consents is append-only/);
  assert.match(SQL_STATEMENTS, /CREATE TRIGGER user_consents_append_only\s+BEFORE UPDATE OR DELETE ON public\.user_consents/);
});

test("record_user_consent: SECURITY DEFINER hardening (search_path pinned, service_role-only EXECUTE)", () => {
  const fn = extractRpcBody();
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path = public, pg_temp/);

  assert.match(SQL_STATEMENTS, /REVOKE ALL ON FUNCTION public\.record_user_consent\([^)]*\) FROM PUBLIC;/);
  assert.match(SQL_STATEMENTS, /REVOKE ALL ON FUNCTION public\.record_user_consent\([^)]*\) FROM anon;/);
  assert.match(SQL_STATEMENTS, /REVOKE ALL ON FUNCTION public\.record_user_consent\([^)]*\) FROM authenticated;/);
  assert.match(SQL_STATEMENTS, /GRANT EXECUTE ON FUNCTION public\.record_user_consent\([^)]*\) TO service_role;/);
});

test("record_user_consent: signature has NO accepted_at parameter — server time only", () => {
  const signature = SQL.match(/CREATE OR REPLACE FUNCTION public\.record_user_consent\(([\s\S]*?)\)\s*RETURNS/);
  assert.ok(signature, "function signature not found");
  assert.doesNotMatch(signature[1], /accepted_at/i);
  assert.doesNotMatch(signature[1], /p_accepted/i);
});

test("record_user_consent: idempotent INSERT ... ON CONFLICT DO NOTHING, then returns the row by the same key", () => {
  const fn = extractRpcBody();
  const insertIdx = fn.indexOf("INSERT INTO public.user_consents");
  const conflictIdx = fn.indexOf("ON CONFLICT (user_id, consent_scope, idempotency_key) DO NOTHING");
  const returnIdx = fn.indexOf("RETURN QUERY");
  assert.ok(insertIdx > -1 && conflictIdx > -1 && returnIdx > -1);
  assert.ok(insertIdx < conflictIdx, "ON CONFLICT must belong to the INSERT");
  assert.ok(conflictIdx < returnIdx, "row is returned AFTER the idempotent insert");
  // The read-back is keyed by the same triple as the unique constraint.
  assert.match(fn, /WHERE uc\.user_id = p_user_id\s+AND uc\.consent_scope = p_consent_scope\s+AND uc\.idempotency_key = p_idempotency_key/);
});

test("record_user_consent: validates scope/source/idempotency key inside SQL as defense in depth", () => {
  const fn = extractRpcBody();
  assert.match(fn, /p_consent_scope NOT IN \('account_upgrade', 'checkout', 'digital_content_waiver'\)/);
  assert.match(fn, /p_source NOT IN \('subscription_page', 'account_upgrade_form'\)/);
  assert.match(fn, /char_length\(p_idempotency_key\) < 8/);
});

test("all column references in the RETURN QUERY are table-qualified (RETURNS TABLE shadowing guard)", () => {
  const fn = extractRpcBody();
  const returnQuery = fn.slice(fn.indexOf("RETURN QUERY"));
  assert.match(returnQuery, /uc\.id/);
  assert.match(returnQuery, /uc\.consent_scope/);
  assert.match(returnQuery, /uc\.accepted_at/);
  assert.match(returnQuery, /FROM public\.user_consents AS uc/);
});
