"use strict";

/**
 * P-AUTH-05C Hotfix: Static structural tests for the three follow-up
 * migrations that fixed real, live-triggered bugs in `claim_gacha_draw` /
 * `redeem_gift_transaction` discovered during wallet-ops staging
 * verification (ambiguous column references from `RETURNS TABLE`'s
 * implicit OUT-parameter variables, and an `integer`/`bigint` type
 * mismatch against `users.points/tickets/coins`).
 *
 * These bugs were NOT catchable by any prior static test in this repo
 * (they only manifest when the function body is actually EXECUTED by a
 * real Postgres instance — PL/pgSQL does not eagerly type-check embedded
 * SQL at `CREATE FUNCTION` time). They were found and fixed via direct
 * `supabase db query --linked` calls against the real staging project
 * during this hotfix. These tests are still useful as a STATIC regression
 * guard (the exact bug pattern — a bare column reference matching a
 * `RETURNS TABLE` OUT column name — cannot silently return once fixed),
 * but do NOT themselves prove correct runtime behavior; see
 * review-auth-05C-wallet-ops-cors-hotfix.md for the real, live
 * verification results.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "..");
const BIGINT_FIX_SQL = fs.readFileSync(path.join(MIGRATIONS_DIR, "20260817000800_gacha_gift_bigint_balance_fix.sql"), "utf8");

function extractFunctionBody(sql, functionName) {
  const regex = new RegExp(`^CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?END;\\r?\\n\\$\\$;`, "m");
  const match = sql.match(regex);
  assert.ok(match, `${functionName} function body not found`);
  return match[0];
}

test("claim_gacha_draw (final, 20260817000800): declares user_points/user_tickets/user_coins as BIGINT, matching public.users' real column types", () => {
  const signatureMatch = BIGINT_FIX_SQL.match(/CREATE OR REPLACE FUNCTION public\.claim_gacha_draw\([\s\S]*?\) RETURNS TABLE \(([\s\S]*?)\)\s*\nLANGUAGE plpgsql/);
  assert.ok(signatureMatch, "claim_gacha_draw signature not found");
  assert.match(signatureMatch[1], /user_points BIGINT/);
  assert.match(signatureMatch[1], /user_tickets BIGINT/);
  assert.match(signatureMatch[1], /user_coins BIGINT/);
});

test("redeem_gift_transaction (final, 20260817000800): declares user_points/user_tickets/user_coins as BIGINT", () => {
  const signatureMatch = BIGINT_FIX_SQL.match(/CREATE OR REPLACE FUNCTION public\.redeem_gift_transaction\([\s\S]*?\) RETURNS TABLE \(([\s\S]*?)\)\s*\nLANGUAGE plpgsql/);
  assert.ok(signatureMatch, "redeem_gift_transaction signature not found");
  assert.match(signatureMatch[1], /user_points BIGINT/);
  assert.match(signatureMatch[1], /user_tickets BIGINT/);
  assert.match(signatureMatch[1], /user_coins BIGINT/);
});

test("claim_gacha_draw (final): every read from public.mascots/public.user_mascots uses a table alias — no bare column name can collide with a RETURNS TABLE OUT parameter again", () => {
  const fnBody = extractFunctionBody(BIGINT_FIX_SQL, "claim_gacha_draw");

  // Every FROM public.mascots / public.user_mascots reference must be
  // aliased (m / um), never bare.
  const mascotsFromClauses = fnBody.match(/FROM public\.mascots\b[^\n]*/g) || [];
  assert.ok(mascotsFromClauses.length > 0, "no FROM public.mascots clause found");
  for (const clause of mascotsFromClauses) {
    assert.match(clause, /FROM public\.mascots m\b/, `expected an aliased FROM clause, got: ${clause}`);
  }

  const userMascotsFromClauses = fnBody.match(/FROM public\.user_mascots\b[^\n]*/g) || [];
  assert.ok(userMascotsFromClauses.length > 0, "no FROM public.user_mascots clause found");
  for (const clause of userMascotsFromClauses) {
    assert.match(clause, /FROM public\.user_mascots um\b/, `expected an aliased FROM clause, got: ${clause}`);
  }

  // The specific bug-triggering bare references must never reappear.
  assert.doesNotMatch(fnBody, /WHERE\s+rarity\s*=\s*v_rarity_code/);
  assert.doesNotMatch(fnBody, /WHERE\s+user_id\s*=\s*p_user_id\s+AND\s+mascot_id\s*=/);
});

test("redeem_gift_transaction (final): every read from public.gifts uses a table alias", () => {
  const fnBody = extractFunctionBody(BIGINT_FIX_SQL, "redeem_gift_transaction");

  const giftsFromClauses = fnBody.match(/FROM public\.gifts\b[^\n]*/g) || [];
  assert.ok(giftsFromClauses.length > 0, "no FROM public.gifts clause found");
  for (const clause of giftsFromClauses) {
    assert.match(clause, /FROM public\.gifts g\b/, `expected an aliased FROM clause, got: ${clause}`);
  }

  assert.doesNotMatch(fnBody, /SELECT\s+id,\s*name,\s*points_cost/);
});

test("both functions: SECURITY DEFINER hardened, granted only to service_role, unchanged parameter lists (this was a pure bug fix, never a business-authority change)", () => {
  assert.match(BIGINT_FIX_SQL, /REVOKE ALL ON FUNCTION public\.claim_gacha_draw\(TEXT, TEXT\) FROM PUBLIC/);
  assert.match(BIGINT_FIX_SQL, /GRANT EXECUTE ON FUNCTION public\.claim_gacha_draw\(TEXT, TEXT\) TO service_role/);
  assert.match(BIGINT_FIX_SQL, /REVOKE ALL ON FUNCTION public\.redeem_gift_transaction\(TEXT, TEXT, TEXT\) FROM PUBLIC/);
  assert.match(BIGINT_FIX_SQL, /GRANT EXECUTE ON FUNCTION public\.redeem_gift_transaction\(TEXT, TEXT, TEXT\) TO service_role/);
});
