"use strict";

/**
 * gift-redeem-refresh-hotfix: static structural tests for
 * `20260821000100_gift_redeem_history_id_bigint_fix.sql`.
 *
 * This migration fixes a CONFIRMED-LIVE production bug: `redeem_history.id`
 * is `bigint`, but `redeem_gift_transaction()`'s `v_redeem_id` variable,
 * its `RETURNS TABLE(redeem_history_id ...)` column, and the
 * `gift_redemption_requests.redeem_history_id` table column were all
 * declared `UUID` — every real call failed at runtime with
 * `22P02: invalid input syntax for type uuid`, rolling back the ENTIRE
 * redemption (confirmed via a rollback-wrapped `supabase db query --linked`
 * call against production; see the migration's own header comment for the
 * full evidence trail). As with the earlier 20260817000600/700/800 bugs,
 * this class of error is invisible to `CREATE FUNCTION` and only manifests
 * when the function is actually EXECUTED against a real Postgres instance
 * — these tests are a static regression guard for the fixed SHAPE, not
 * proof of runtime behavior (already independently confirmed live for
 * this specific fix during authoring).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "..");
const FIX_SQL = fs.readFileSync(
  path.join(MIGRATIONS_DIR, "20260821000100_gift_redeem_history_id_bigint_fix.sql"),
  "utf8"
);

function extractFunctionBody(sql, functionName) {
  const regex = new RegExp(`^CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?END;\\r?\\n\\$\\$;`, "m");
  const match = sql.match(regex);
  assert.ok(match, `${functionName} function body not found`);
  return match[0];
}

test("ALTER TABLE widens gift_redemption_requests.redeem_history_id from UUID to BIGINT", () => {
  assert.match(FIX_SQL, /ALTER TABLE public\.gift_redemption_requests\s+ALTER COLUMN redeem_history_id TYPE BIGINT/);
});

test("DROP FUNCTION precedes CREATE OR REPLACE FUNCTION (required for a RETURNS TABLE type change)", () => {
  const dropIndex = FIX_SQL.indexOf("DROP FUNCTION IF EXISTS public.redeem_gift_transaction(TEXT, TEXT, TEXT);");
  const createIndex = FIX_SQL.indexOf("CREATE OR REPLACE FUNCTION public.redeem_gift_transaction(");
  assert.ok(dropIndex >= 0, "DROP FUNCTION statement not found");
  assert.ok(createIndex >= 0, "CREATE OR REPLACE FUNCTION statement not found");
  assert.ok(dropIndex < createIndex, "DROP FUNCTION must appear before CREATE OR REPLACE FUNCTION");
});

test("redeem_gift_transaction: RETURNS TABLE declares redeem_history_id as BIGINT, never UUID", () => {
  const signatureMatch = FIX_SQL.match(/CREATE OR REPLACE FUNCTION public\.redeem_gift_transaction\([\s\S]*?\) RETURNS TABLE \(([\s\S]*?)\)\s*\nLANGUAGE plpgsql/);
  assert.ok(signatureMatch, "redeem_gift_transaction signature not found");
  assert.match(signatureMatch[1], /redeem_history_id BIGINT/);
  assert.doesNotMatch(signatureMatch[1], /redeem_history_id UUID/);
});

test("redeem_gift_transaction: v_redeem_id is declared BIGINT, never UUID", () => {
  const fnBody = extractFunctionBody(FIX_SQL, "redeem_gift_transaction");
  assert.match(fnBody, /v_redeem_id BIGINT;/);
  assert.doesNotMatch(fnBody, /v_redeem_id UUID;/);
});

test("redeem_gift_transaction: the redeem_history INSERT still writes id INTO v_redeem_id, and gift_redemption_requests still stores it (now BIGINT-safe)", () => {
  const fnBody = extractFunctionBody(FIX_SQL, "redeem_gift_transaction");
  assert.match(fnBody, /RETURNING id INTO v_redeem_id;/);
  assert.match(fnBody, /INSERT INTO public\.gift_redemption_requests \(\s*idempotency_key, user_id, gift_id, redeem_history_id, points_cost, tickets_cost, coins_cost/);
});

test("redeem_gift_transaction: idempotency ownership check and gifts-table cost resolution are unchanged (pure type fix, not a business-logic rewrite)", () => {
  const fnBody = extractFunctionBody(FIX_SQL, "redeem_gift_transaction");

  // Ownership check on a cached idempotency hit is preserved.
  assert.match(fnBody, /IF v_cached\.user_id <> p_user_id THEN/);

  // Cost/name are still ALWAYS resolved from public.gifts (aliased), never
  // accepted as a parameter.
  const giftsFromClauses = fnBody.match(/FROM public\.gifts\b[^\n]*/g) || [];
  assert.ok(giftsFromClauses.length > 0, "no FROM public.gifts clause found");
  for (const clause of giftsFromClauses) {
    assert.match(clause, /FROM public\.gifts g\b/, `expected an aliased FROM clause, got: ${clause}`);
  }

  // Parameter list is unchanged from the original signature.
  assert.match(fnBody, /CREATE OR REPLACE FUNCTION public\.redeem_gift_transaction\(\s*p_user_id TEXT,\s*p_gift_id TEXT,\s*p_idempotency_key TEXT\s*\)/);
});

test("redeem_gift_transaction: still SECURITY DEFINER, granted ONLY to service_role", () => {
  assert.match(FIX_SQL, /SECURITY DEFINER\s*\nSET search_path = public, pg_temp/);
  assert.match(FIX_SQL, /REVOKE ALL ON FUNCTION public\.redeem_gift_transaction\(TEXT, TEXT, TEXT\) FROM PUBLIC/);
  assert.match(FIX_SQL, /REVOKE ALL ON FUNCTION public\.redeem_gift_transaction\(TEXT, TEXT, TEXT\) FROM anon/);
  assert.match(FIX_SQL, /REVOKE ALL ON FUNCTION public\.redeem_gift_transaction\(TEXT, TEXT, TEXT\) FROM authenticated/);
  assert.match(FIX_SQL, /GRANT EXECUTE ON FUNCTION public\.redeem_gift_transaction\(TEXT, TEXT, TEXT\) TO service_role/);
});
