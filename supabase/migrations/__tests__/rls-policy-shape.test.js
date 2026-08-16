"use strict";

/**
 * P-AUTH-05A: Static structural tests for the Security Foundation
 * migrations.
 *
 * IMPORTANT LIMITATION (documented in review-auth-05A.md): this repo has
 * no local Postgres/pg-mem harness and no live Supabase project access
 * from this environment (see repo memory: "No Deno CLI available
 * locally"), so these are NOT live RLS/permission integration tests —
 * they cannot prove a real Postgres actually enforces these policies at
 * runtime. They are STATIC assertions on the migration SQL text itself,
 * checking that the required security properties (RLS enabled, owner-only
 * SELECT via request_user_key(), all authenticated mutations denied,
 * SECURITY DEFINER functions have a pinned search_path and revoked/
 * re-granted EXECUTE) are present in the SQL as written, and that known-bad
 * patterns (`USING (true)`, granting the new functions to anon/
 * authenticated) are absent. A real Supabase project run (see
 * review-auth-05A.md "手動驗證步驟") is still required before this is
 * considered verified.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "..");

function readMigration(filename) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
}

const CORE_TABLES_SQL = readMigration("20260816000000_core_user_tables_owner_rls.sql");
const POINT_LEDGER_SQL = readMigration("20260816000100_point_transactions_ledger.sql");
const MERGE_CLAIMS_SQL = readMigration("20260816000200_account_merge_claims.sql");
const MASCOT_DEDUP_SQL = readMigration("20260816000300_user_mascots_dedup_and_unique_constraint.sql");
const MERGE_FINALIZE_SQL = readMigration("20260816000400_account_merge_requests_and_finalize.sql");

const CORE_TABLES = ["users", "user_mascots", "redeem_history", "shop_cart", "orders", "order_items"];

test("core_user_tables_owner_rls: never uses a fully-permissive USING/WITH CHECK (true) policy", () => {
  assert.doesNotMatch(CORE_TABLES_SQL, /USING\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(CORE_TABLES_SQL, /WITH CHECK\s*\(\s*true\s*\)/i);
});

for (const table of CORE_TABLES) {
  test(`core_user_tables_owner_rls: ${table} has RLS enabled, owner-only SELECT, and denies all authenticated writes`, () => {
    assert.match(CORE_TABLES_SQL, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(CORE_TABLES_SQL, new RegExp(`CREATE POLICY p_${table}_select_owner[\\s\\S]{0,400}?FOR SELECT[\\s\\S]{0,200}?TO authenticated`));
    assert.match(CORE_TABLES_SQL, new RegExp(`CREATE POLICY p_${table}_deny_insert_authenticated[\\s\\S]{0,200}?AS RESTRICTIVE[\\s\\S]{0,100}?FOR INSERT[\\s\\S]{0,200}?WITH CHECK \\(false\\)`));
    assert.match(CORE_TABLES_SQL, new RegExp(`CREATE POLICY p_${table}_deny_update_authenticated[\\s\\S]{0,200}?AS RESTRICTIVE[\\s\\S]{0,100}?FOR UPDATE`));
    assert.match(CORE_TABLES_SQL, new RegExp(`CREATE POLICY p_${table}_deny_delete_authenticated[\\s\\S]{0,200}?AS RESTRICTIVE[\\s\\S]{0,100}?FOR DELETE`));
  });
}

test("core_user_tables_owner_rls: owner SELECT policies resolve ownership via request_user_key(), never a client-supplied column/parameter", () => {
  const ownerPolicyMatches = CORE_TABLES_SQL.match(/CREATE POLICY p_\w+_select_owner[\s\S]{0,400}?public\.request_user_key\(\)/g) || [];
  assert.equal(ownerPolicyMatches.length, CORE_TABLES.length);
});

test("core_user_tables_owner_rls: adds legacy_user_id as an additive, nullable compatibility column (never drops/renames anything)", () => {
  assert.match(CORE_TABLES_SQL, /ALTER TABLE public\.users ADD COLUMN IF NOT EXISTS legacy_user_id TEXT/);
  assert.doesNotMatch(CORE_TABLES_SQL, /DROP TABLE(?!.*ROLLBACK)/i);
  assert.doesNotMatch(CORE_TABLES_SQL, /^\s*ALTER TABLE public\.\w+ DROP COLUMN/im);
});

test("point_transactions_ledger: table has RLS enabled, owner-only SELECT, and denies all authenticated writes (append-only via RPC)", () => {
  assert.match(POINT_LEDGER_SQL, /ALTER TABLE IF EXISTS public\.point_transactions ENABLE ROW LEVEL SECURITY/);
  assert.match(POINT_LEDGER_SQL, /CREATE POLICY p_point_transactions_select_owner[\s\S]{0,300}?public\.request_user_key\(\)/);
  assert.match(POINT_LEDGER_SQL, /CREATE POLICY p_point_transactions_deny_insert_authenticated[\s\S]{0,200}?WITH CHECK \(false\)/);
});

test("point_transactions_ledger: apply_point_transaction is SECURITY DEFINER with a pinned search_path, revoked from PUBLIC/anon/authenticated, and granted ONLY to service_role", () => {
  assert.match(POINT_LEDGER_SQL, /CREATE OR REPLACE FUNCTION public\.apply_point_transaction/);
  assert.match(POINT_LEDGER_SQL, /SECURITY DEFINER\s*\n\s*SET search_path = public, pg_temp/);
  assert.match(POINT_LEDGER_SQL, /REVOKE ALL ON FUNCTION public\.apply_point_transaction\([^)]*\) FROM PUBLIC/);
  assert.match(POINT_LEDGER_SQL, /REVOKE ALL ON FUNCTION public\.apply_point_transaction\([^)]*\) FROM anon/);
  assert.match(POINT_LEDGER_SQL, /REVOKE ALL ON FUNCTION public\.apply_point_transaction\([^)]*\) FROM authenticated/);
  assert.match(POINT_LEDGER_SQL, /GRANT EXECUTE ON FUNCTION public\.apply_point_transaction\([^)]*\) TO service_role/);
});

test("point_transactions_ledger: never grants EXECUTE on apply_point_transaction to anon/authenticated", () => {
  assert.doesNotMatch(POINT_LEDGER_SQL, /GRANT EXECUTE ON FUNCTION public\.apply_point_transaction\([^)]*\) TO (anon|authenticated)/);
});

test("point_transactions_ledger: rejects a negative resulting balance instead of silently allowing it", () => {
  assert.match(POINT_LEDGER_SQL, /v_next_points < 0/);
  assert.match(POINT_LEDGER_SQL, /RAISE EXCEPTION[\s\S]{0,120}?negative/);
});

test("account_merge_claims: table only stores a token HASH, never a raw token column", () => {
  assert.match(MERGE_CLAIMS_SQL, /claim_token_hash TEXT NOT NULL/);
  assert.doesNotMatch(MERGE_CLAIMS_SQL, /\braw_token\b/i);
  assert.doesNotMatch(MERGE_CLAIMS_SQL, /\bclaim_token\s+TEXT/i);
  assert.doesNotMatch(MERGE_CLAIMS_SQL, /\btarget_email\s+TEXT/i);
});

test("account_merge_claims: has RLS enabled with an explicit deny-all policy for authenticated (no permissive policy at all)", () => {
  assert.match(MERGE_CLAIMS_SQL, /ALTER TABLE public\.account_merge_claims ENABLE ROW LEVEL SECURITY/);
  assert.match(MERGE_CLAIMS_SQL, /CREATE POLICY p_account_merge_claims_deny_all_authenticated[\s\S]{0,200}?AS RESTRICTIVE[\s\S]{0,100}?FOR ALL[\s\S]{0,200}?USING \(false\)[\s\S]{0,50}?WITH CHECK \(false\)/);
  assert.doesNotMatch(MERGE_CLAIMS_SQL, /CREATE POLICY(?!.*deny_all)[\s\S]{0,200}?ON public\.account_merge_claims[\s\S]{0,200}?TO (anon|authenticated)/);
});

test("account_merge_claims: claim_token_hash is UNIQUE (prevents two claims from ever sharing a hash)", () => {
  assert.match(MERGE_CLAIMS_SQL, /CONSTRAINT uq_account_merge_claims_token_hash UNIQUE \(claim_token_hash\)/);
});

for (const fn of [
  { name: "create_account_merge_claim", signature: "TEXT, TEXT, TEXT, INTEGER" },
  { name: "expire_stale_account_merge_claims", signature: "" }
]) {
  test(`account_merge_claims: ${fn.name} is SECURITY DEFINER with a pinned search_path, revoked from PUBLIC/anon/authenticated, and granted ONLY to service_role`, () => {
    assert.match(MERGE_CLAIMS_SQL, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn.name}`));
    const fnBlockMatch = MERGE_CLAIMS_SQL.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn.name}[\\s\\S]*?\\$\\$;`));
    assert.ok(fnBlockMatch, `expected to find a full function body for ${fn.name}`);
    assert.match(fnBlockMatch[0], /SECURITY DEFINER\s*\n\s*SET search_path = public, pg_temp/);

    const escapedSignature = fn.signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(MERGE_CLAIMS_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.name}\\(${escapedSignature}\\) FROM PUBLIC`));
    assert.match(MERGE_CLAIMS_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.name}\\(${escapedSignature}\\) FROM anon`));
    assert.match(MERGE_CLAIMS_SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.name}\\(${escapedSignature}\\) FROM authenticated`));
    assert.match(MERGE_CLAIMS_SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn.name}\\(${escapedSignature}\\) TO service_role`));
  });
}

test("account_merge_claims: never grants EXECUTE on any of its functions to anon/authenticated", () => {
  assert.doesNotMatch(MERGE_CLAIMS_SQL, /GRANT EXECUTE ON FUNCTION public\.(create_account_merge_claim|expire_stale_account_merge_claims)\([^)]*\) TO (anon|authenticated)/);
});

test("account_merge_claims: no longer defines the superseded two-step consume_account_merge_claim (Gate blocker #2/#3 fix)", () => {
  assert.doesNotMatch(MERGE_CLAIMS_SQL, /CREATE (OR REPLACE )?FUNCTION public\.consume_account_merge_claim/);
});

// --- P-AUTH-05A-fix: user_mascots dedup + unique constraint ---

test("user_mascots_dedup: adds a UNIQUE(user_id, mascot_id) constraint only, guarded so it never runs twice", () => {
  assert.match(MASCOT_DEDUP_SQL, /ADD CONSTRAINT uq_user_mascots_user_mascot UNIQUE \(user_id, mascot_id\)/);
  assert.match(MASCOT_DEDUP_SQL, /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/);
});

test("user_mascots_dedup: consolidates duplicates by SUMMING obtain_count (never discarding real ownership counts)", () => {
  assert.match(MASCOT_DEDUP_SQL, /SUM\(obtain_count\) AS total_obtain_count/);
  assert.match(MASCOT_DEDUP_SQL, /MIN\(first_obtained_at\)/);
  assert.match(MASCOT_DEDUP_SQL, /MAX\(last_obtained_at\)/);
});

test("user_mascots_dedup: documents the migration as destructive/irreversible and requires a backup before running", () => {
  assert.match(MASCOT_DEDUP_SQL, /NOT FULLY REVERSIBLE/);
  assert.match(MASCOT_DEDUP_SQL, /backup/i);
});

// --- P-AUTH-05A-fix: account_merge_requests + finalize_account_merge ---

test("account_merge_requests: has RLS enabled with an explicit deny-all policy for authenticated, and is UNIQUE per idempotency_key AND per anonymous_user_id", () => {
  assert.match(MERGE_FINALIZE_SQL, /ALTER TABLE public\.account_merge_requests ENABLE ROW LEVEL SECURITY/);
  assert.match(MERGE_FINALIZE_SQL, /CREATE POLICY p_account_merge_requests_deny_all_authenticated[\s\S]{0,200}?AS RESTRICTIVE[\s\S]{0,100}?FOR ALL[\s\S]{0,200}?USING \(false\)[\s\S]{0,50}?WITH CHECK \(false\)/);
  assert.match(MERGE_FINALIZE_SQL, /CONSTRAINT uq_account_merge_requests_idempotency_key UNIQUE \(idempotency_key\)/);
  assert.match(MERGE_FINALIZE_SQL, /CONSTRAINT uq_account_merge_requests_anonymous_user UNIQUE \(anonymous_user_id\)/);
});

test("finalize_account_merge: is SECURITY DEFINER with a pinned search_path, revoked from PUBLIC/anon/authenticated, and granted ONLY to service_role", () => {
  const fnBlockMatch = MERGE_FINALIZE_SQL.match(/CREATE OR REPLACE FUNCTION public\.finalize_account_merge[\s\S]*?\$\$;/);
  assert.ok(fnBlockMatch, "expected to find a full function body for finalize_account_merge");
  assert.match(fnBlockMatch[0], /SECURITY DEFINER\s*\n\s*SET search_path = public, pg_temp/);

  assert.match(MERGE_FINALIZE_SQL, /REVOKE ALL ON FUNCTION public\.finalize_account_merge\(TEXT, TEXT, TEXT\) FROM PUBLIC/);
  assert.match(MERGE_FINALIZE_SQL, /REVOKE ALL ON FUNCTION public\.finalize_account_merge\(TEXT, TEXT, TEXT\) FROM anon/);
  assert.match(MERGE_FINALIZE_SQL, /REVOKE ALL ON FUNCTION public\.finalize_account_merge\(TEXT, TEXT, TEXT\) FROM authenticated/);
  assert.match(MERGE_FINALIZE_SQL, /GRANT EXECUTE ON FUNCTION public\.finalize_account_merge\(TEXT, TEXT, TEXT\) TO service_role/);
});

// P-AUTH-05A.1: the idempotency key is NEVER accepted as a parameter —
// removing this parameter entirely (3-arg signature, not 4) is itself the
// structural proof that a caller cannot inject/forge one.
test("finalize_account_merge: NEVER accepts a caller-supplied idempotency key — the function has exactly 3 parameters (no p_idempotency_key)", () => {
  const fnHeaderMatch = MERGE_FINALIZE_SQL.match(/CREATE OR REPLACE FUNCTION public\.finalize_account_merge\(([\s\S]*?)\)\s*RETURNS/);
  assert.ok(fnHeaderMatch, "expected to find the function parameter list");
  assert.doesNotMatch(fnHeaderMatch[1], /p_idempotency_key/);
  assert.match(fnHeaderMatch[1], /p_claim_token_hash/);
  assert.match(fnHeaderMatch[1], /p_existing_user_id/);
  assert.match(fnHeaderMatch[1], /p_existing_user_email_hash/);
});

test("finalize_account_merge: a resend for an already-completed canonical pair returns the stored request unchanged (idempotent, without re-merging)", () => {
  const fnBody = MERGE_FINALIZE_SQL.match(/CREATE OR REPLACE FUNCTION public\.finalize_account_merge[\s\S]*?\$\$;/)[0];
  const idempotencyLookupIndex = fnBody.indexOf("SELECT * INTO v_existing_request");
  const returnCachedIndex = fnBody.indexOf("RETURN v_existing_request");
  const mergeStartIndex = fnBody.indexOf("V1 merge scope");
  assert.ok(idempotencyLookupIndex >= 0 && returnCachedIndex >= 0 && mergeStartIndex >= 0);
  assert.ok(idempotencyLookupIndex < returnCachedIndex, "the cached result must be returned right after the lookup");
  assert.ok(returnCachedIndex < mergeStartIndex, "the early RETURN must happen before any merge work begins");
});

test("finalize_account_merge: computes the canonical idempotency key itself from claim.anonymous_user_id + p_existing_user_id (never trusts an external key)", () => {
  assert.match(MERGE_FINALIZE_SQL, /v_canonical_idempotency_key\s*:=\s*'merge:' \|\| v_claim\.anonymous_user_id \|\| ':' \|\| p_existing_user_id/);
});

// P-AUTH-05A.1 Gate blocker fix: the claim MUST be locked and the email
// verified BEFORE any idempotency-based short-circuit can return a
// result — reversed from the P-AUTH-05A-fix draft, which checked the
// (caller-supplied) idempotency key FIRST, before proving the caller held
// a valid claim at all.
test("finalize_account_merge: locks the claim AND checks the email BEFORE computing/looking up the idempotency key (claim+email proof required before any result can be returned)", () => {
  const fnBody = MERGE_FINALIZE_SQL.match(/CREATE OR REPLACE FUNCTION public\.finalize_account_merge[\s\S]*?\$\$;/)[0];
  const lockIndex = fnBody.indexOf("FOR UPDATE");
  const emailCheckIndex = fnBody.indexOf("target_email_hash <> p_existing_user_email_hash");
  const canonicalKeyIndex = fnBody.indexOf("v_canonical_idempotency_key :=");
  const idempotencyLookupIndex = fnBody.indexOf("SELECT * INTO v_existing_request");

  assert.ok(lockIndex >= 0 && emailCheckIndex >= 0 && canonicalKeyIndex >= 0 && idempotencyLookupIndex >= 0);
  assert.ok(lockIndex < emailCheckIndex, "claim must be locked before the email check");
  assert.ok(emailCheckIndex < canonicalKeyIndex, "email must be verified before the canonical key is even computed");
  assert.ok(canonicalKeyIndex < idempotencyLookupIndex, "canonical key must be computed before the idempotency lookup");
});

test("finalize_account_merge: rejects when the caller's own email hash does not match the claim's target_email_hash (Gate blocker #2), and this check applies to BOTH pending and used claims (no status check gates it)", () => {
  const fnBody = MERGE_FINALIZE_SQL.match(/CREATE OR REPLACE FUNCTION public\.finalize_account_merge[\s\S]*?\$\$;/)[0];
  const lockIndex = fnBody.indexOf("FOR UPDATE");
  const emailCheckIndex = fnBody.indexOf("target_email_hash <> p_existing_user_email_hash");
  const firstStatusCheckIndex = fnBody.indexOf("v_claim.status = 'used'");

  assert.match(fnBody, /v_claim\.target_email_hash <> p_existing_user_email_hash/);
  assert.ok(emailCheckIndex < firstStatusCheckIndex, "email check must run before any status-specific branching, so it applies uniformly to pending AND used claims");
});

// P-AUTH-05A.1 requirement 5: claim already `used` but no matching
// completed request found must be treated as a data-inconsistency and
// rejected, never silently proceeding to re-run the merge.
test("finalize_account_merge: treats status='used' with no matching account_merge_requests row as a data inconsistency and rejects (never silently re-merges)", () => {
  const fnBody = MERGE_FINALIZE_SQL.match(/CREATE OR REPLACE FUNCTION public\.finalize_account_merge[\s\S]*?\$\$;/)[0];
  assert.match(fnBody, /IF v_claim\.status = 'used' THEN\s*\n\s*RAISE EXCEPTION[\s\S]{0,150}?inconsistency/);
});

test("finalize_account_merge: marks the claim used and records the request result ONLY after every merge step, never before (Gate blocker #3 atomicity)", () => {
  const fnBody = MERGE_FINALIZE_SQL.match(/CREATE OR REPLACE FUNCTION public\.finalize_account_merge[\s\S]*?\$\$;/)[0];
  const emailCheckIndex = fnBody.indexOf("target_email_hash <> p_existing_user_email_hash");
  const markUsedIndex = fnBody.indexOf("SET status = 'used', used_at = NOW()");
  const insertRequestIndex = fnBody.indexOf("INSERT INTO public.account_merge_requests");
  assert.ok(emailCheckIndex >= 0 && markUsedIndex >= 0 && insertRequestIndex >= 0);
  assert.ok(emailCheckIndex < markUsedIndex, "email check must happen before marking the claim used");
  assert.ok(markUsedIndex < insertRequestIndex, "claim must be marked used before/alongside recording the request result");
});

test("finalize_account_merge: result_json never stores an email, a token, or a token hash (PII minimization, requirement 6)", () => {
  const resultJsonMatch = MERGE_FINALIZE_SQL.match(/jsonb_build_object\(([\s\S]*?)\)\s*\n\s*\)\s*\n\s*RETURNING/);
  assert.ok(resultJsonMatch, "expected to find the result_json jsonb_build_object(...) call");
  assert.doesNotMatch(resultJsonMatch[1], /email/i);
  assert.doesNotMatch(resultJsonMatch[1], /token/i);
  assert.doesNotMatch(resultJsonMatch[1], /hash/i);
});

test("finalize_account_merge: never touches orders/order_items/subscriptions/logs (Gate blocker #7), and records them as excluded in the result", () => {
  assert.doesNotMatch(MERGE_FINALIZE_SQL, /UPDATE public\.orders/);
  assert.doesNotMatch(MERGE_FINALIZE_SQL, /UPDATE public\.order_items/);
  assert.doesNotMatch(MERGE_FINALIZE_SQL, /UPDATE public\.subscriptions/);
  assert.doesNotMatch(MERGE_FINALIZE_SQL, /UPDATE public\.logs/);
  assert.match(MERGE_FINALIZE_SQL, /'excludedV1', jsonb_build_array\('orders', 'order_items', 'subscriptions', 'logs'\)/);
});

test("finalize_account_merge: transfers points via apply_point_transaction (never a raw UPDATE users SET points)", () => {
  assert.match(MERGE_FINALIZE_SQL, /PERFORM public\.apply_point_transaction\(v_claim\.anonymous_user_id, -v_anon_points, 'account_merge_transfer_out', v_claim\.id\)/);
  assert.match(MERGE_FINALIZE_SQL, /PERFORM public\.apply_point_transaction\(p_existing_user_id, v_anon_points, 'account_merge_transfer_in', v_claim\.id\)/);
  assert.doesNotMatch(MERGE_FINALIZE_SQL, /UPDATE public\.users\s+SET\s+points/);
});

test("finalize_account_merge: uses ON CONFLICT (user_id, mascot_id) for the mascot merge, matching the unique constraint added by the dedup migration", () => {
  assert.match(MERGE_FINALIZE_SQL, /ON CONFLICT \(user_id, mascot_id\) DO UPDATE/);
});
