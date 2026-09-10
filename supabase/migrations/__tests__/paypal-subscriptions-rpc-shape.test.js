"use strict";

/**
 * Auth-07C.2: static shape + encoded-behavior assertions for
 * paypal subscriptions migration/RPCs.
 *
 * No remote DB / db push. Mirrors other migrations/__tests__ harnesses.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SQL = fs.readFileSync(
  path.join(__dirname, "..", "20260907000100_paypal_subscriptions_rpc.sql"),
  "utf8"
);

const LEGACY_SQL = fs.readFileSync(
  path.join(__dirname, "..", "20260821000200_payment_orders_and_webhook_events.sql"),
  "utf8"
);

const RPCS = [
  { name: "paypal_subscription_status_rank", sig: "TEXT" },
  { name: "release_subscription_slot_if_due", sig: "TEXT" },
  { name: "expire_unstarted_subscription_session", sig: "TEXT" },
  { name: "acquire_subscription_slot", sig: "TEXT, TEXT, TEXT" },
  { name: "bind_paypal_subscription", sig: "TEXT, TEXT, TEXT" },
  {
    name: "process_paypal_subscription_webhook_event",
    sig: "TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, JSONB, TEXT"
  }
];

function assertRevokeGrant(name, sig) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sigEscaped = sig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    SQL,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped}\\(${sigEscaped}\\) FROM PUBLIC`)
  );
  assert.match(
    SQL,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped}\\(${sigEscaped}\\) FROM anon`)
  );
  assert.match(
    SQL,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped}\\(${sigEscaped}\\) FROM authenticated`)
  );
  assert.match(
    SQL,
    new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped}\\(${sigEscaped}\\) TO service_role`)
  );
}

test("01 migration creates paypal_subscriptions with required columns/checks", () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.paypal_subscriptions/);
  assert.match(SQL, /checkout_session_id TEXT NOT NULL/);
  assert.match(SQL, /CONSTRAINT uq_paypal_subscriptions_checkout_session_id UNIQUE/);
  assert.match(SQL, /paypal_subscription_id TEXT,/);
  assert.match(SQL, /CONSTRAINT uq_paypal_subscriptions_paypal_subscription_id UNIQUE/);
  assert.match(SQL, /plan_code TEXT NOT NULL\s+CHECK \(plan_code IN \('monthly', 'yearly'\)\)/);
  assert.match(SQL, /recurring_amount NUMERIC\(12, 2\) NOT NULL\s+CHECK \(recurring_amount > 0\)/);
  assert.match(SQL, /currency TEXT NOT NULL\s+CHECK \(currency IN \('USD'\)\)/);
  assert.match(SQL, /access_blocked_at TIMESTAMPTZ/);
  assert.match(SQL, /access_block_reason TEXT/);
  assert.match(SQL, /reconciliation_status TEXT NOT NULL DEFAULT 'none'/);
  assert.match(SQL, /APPROVAL_PENDING/);
  assert.match(SQL, /EXPIRED_SETUP/);
  const subTable = SQL.match(
    /CREATE TABLE IF NOT EXISTS public\.paypal_subscriptions \([\s\S]*?\n\);/
  );
  assert.ok(subTable, "paypal_subscriptions table DDL present");
  assert.doesNotMatch(subTable[0], /payer_email|shipping_address|full_name/i);
});

test("01b plan amount whitelist encoded in CHECK", () => {
  assert.match(SQL, /plan_code = 'monthly' AND recurring_amount = 5\.00/);
  assert.match(SQL, /plan_code = 'yearly' AND recurring_amount = 48\.00/);
});

test("02 user_subscription_slots OCCUPIED/RELEASED without now\\(\\) unique", () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.user_subscription_slots/);
  assert.match(SQL, /user_id TEXT PRIMARY KEY/);
  assert.match(SQL, /slot_state TEXT NOT NULL\s+CHECK \(slot_state IN \('OCCUPIED', 'RELEASED'\)\)/);
  assert.match(SQL, /release_after TIMESTAMPTZ/);
  assert.match(SQL, /ON DELETE SET NULL/);
  assert.doesNotMatch(SQL, /UNIQUE \([^)]*now\(\)/i);
  assert.doesNotMatch(SQL, /WHERE[^;]*paid_through\s*>\s*now\(\)/i);
});

test("03 paypal_subscription_transactions unique event/sale + sanitized payload", () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.paypal_subscription_transactions/);
  assert.match(SQL, /CONSTRAINT uq_paypal_subscription_transactions_event_id UNIQUE \(paypal_event_id\)/);
  assert.match(SQL, /CONSTRAINT uq_paypal_subscription_transactions_sale_id UNIQUE \(paypal_sale_id\)/);
  assert.match(SQL, /amount NUMERIC\(12, 2\) NOT NULL\s+CHECK \(amount > 0\)/);
  assert.match(SQL, /sanitized_payload JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.doesNotMatch(SQL, /raw_webhook_body|full_payload/i);
});

test("04 payment_webhook_events additive statuses and columns", () => {
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS paypal_subscription_id TEXT/);
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS paypal_sale_id TEXT/);
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS error_code TEXT/);
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ/);
  assert.match(SQL, /pending_resolution/);
  assert.match(SQL, /reconciliation_pending/);
  assert.match(SQL, /'duplicate'/);
  // legacy statuses retained
  assert.match(SQL, /'received'/);
  assert.match(SQL, /'processed'/);
  assert.match(SQL, /'ignored'/);
  assert.match(SQL, /'failed'/);
});

test("05 legacy Orders schema untouched by this file (no DROP payment_orders)", () => {
  assert.doesNotMatch(SQL, /DROP TABLE(?: IF EXISTS)? public\.payment_orders/i);
  assert.doesNotMatch(SQL, /DROP FUNCTION IF EXISTS public\.process_paypal_webhook_event/i);
  assert.doesNotMatch(SQL, /DROP FUNCTION IF EXISTS public\.create_payment_order/i);
  assert.match(LEGACY_SQL, /CREATE TABLE IF NOT EXISTS public\.payment_orders/);
  assert.match(LEGACY_SQL, /user_id TEXT NOT NULL/);
  assert.match(LEGACY_SQL, /paypal_event_id TEXT NOT NULL/);
});

test("06 acquire_subscription_slot: server amounts, 30m TTL, atomic slot", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.acquire_subscription_slot/);
  assert.match(SQL, /v_amount := 5\.00/);
  assert.match(SQL, /v_amount := 48\.00/);
  assert.match(SQL, /INTERVAL '30 minutes'/);
  assert.match(SQL, /gen_random_uuid\(\)::text/);
  assert.match(SQL, /APPROVAL_PENDING/);
  assert.match(SQL, /SUBSCRIPTION_SLOT_OCCUPIED/);
  assert.match(SQL, /ON CONFLICT \(user_id\) DO UPDATE/);
  assert.match(SQL, /WHERE s\.slot_state = 'RELEASED'/);
  assert.match(SQL, /expire_unstarted_subscription_session\(p_user_id\)/);
  assert.match(SQL, /release_subscription_slot_if_due\(p_user_id\)/);
});

test("07 bind_paypal_subscription: owner/expiry/idempotent/unique", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.bind_paypal_subscription/);
  assert.match(SQL, /CHECKOUT_SESSION_OWNER_MISMATCH/);
  assert.match(SQL, /CHECKOUT_SESSION_EXPIRED/);
  assert.match(SQL, /PAYPAL_SUBSCRIPTION_ALREADY_BOUND/);
  assert.match(SQL, /PAYPAL_SUBSCRIPTION_ID_IN_USE/);
  assert.match(SQL, /Idempotent same binding/);
});

test("08 expire_unstarted: only unbound expired APPROVAL_PENDING", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.expire_unstarted_subscription_session/);
  assert.match(SQL, /status = 'APPROVAL_PENDING'/);
  assert.match(SQL, /paypal_subscription_id IS NULL/);
  assert.match(SQL, /checkout_expires_at <= NOW\(\)/);
  assert.match(SQL, /EXPIRED_SETUP/);
});

test("09 release_subscription_slot_if_due: CANCELLED paid_through + no ACTIVE release", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.release_subscription_slot_if_due/);
  assert.match(SQL, /ACTIVE', 'SUSPENDED', 'APPROVED', 'APPROVAL_PENDING'/);
  assert.match(SQL, /release_after IS NULL OR v_slot\.release_after > NOW\(\)/);
  assert.match(SQL, /CANCELLED', 'EXPIRED', 'EXPIRED_SETUP'/);
});

test("10 webhook SALE idempotent + failed payment no extend + regression", () => {
  assert.match(SQL, /PAYMENT\.SALE\.COMPLETED/);
  assert.match(SQL, /uq_paypal_subscription_transactions_sale_id|paypal_sale_id = btrim/);
  assert.match(SQL, /BILLING\.SUBSCRIPTION\.PAYMENT\.FAILED/);
  assert.match(SQL, /STATUS_REGRESSION_FORBIDDEN/);
  assert.match(SQL, /v_rank_new < v_rank_old/);
  assert.match(SQL, /pending_resolution/);
  assert.match(SQL, /SUBSCRIPTION_NOT_FOUND/);
  assert.match(SQL, /reconciliation_pending/);
});

test("11 refund/reversal access block + audit reason; partial no shorten", () => {
  assert.match(SQL, /PAYMENT\.SALE\.REFUNDED/);
  assert.match(SQL, /PAYMENT\.SALE\.REVERSED/);
  assert.match(SQL, /access_blocked_at = NOW\(\)/);
  assert.match(SQL, /access_block_reason/);
  assert.match(SQL, /needs_review = TRUE/);
  assert.match(SQL, /FULL_REFUND/);
  assert.match(SQL, /PARTIAL_REFUND/);
  assert.match(SQL, /Partial refund: needs_review only/);
});

test("12 CANCELLED sets release_after = paid_through", () => {
  assert.match(SQL, /v_new_status = 'CANCELLED'/);
  assert.match(SQL, /release_after = v_sub\.paid_through/);
});

test("13 RLS owner SELECT + deny client mutation + anon deny", () => {
  assert.match(SQL, /p_paypal_subscriptions_select_owner/);
  assert.match(
    SQL,
    /CREATE POLICY p_paypal_subscriptions_deny_insert_authenticated[\s\S]*?FOR INSERT[\s\S]*?TO authenticated/
  );
  assert.match(
    SQL,
    /CREATE POLICY p_paypal_subscriptions_deny_update_authenticated[\s\S]*?FOR UPDATE[\s\S]*?TO authenticated/
  );
  assert.match(
    SQL,
    /CREATE POLICY p_paypal_subscriptions_deny_delete_authenticated[\s\S]*?FOR DELETE[\s\S]*?TO authenticated/
  );
  assert.match(SQL, /p_paypal_subscriptions_deny_all_anon/);
  assert.match(SQL, /p_user_subscription_slots_select_owner/);
  assert.match(SQL, /p_paypal_subscription_transactions_select_owner/);
  assert.match(SQL, /GRANT SELECT ON public\.paypal_subscriptions TO authenticated/);
  assert.match(SQL, /USING \(false\)/);
  assert.match(SQL, /WITH CHECK \(false\)/);
  assert.doesNotMatch(SQL, /USING \(true\)/);
});

test("14 SECURITY DEFINER + fixed search_path on all mutation RPCs", () => {
  for (const rpc of RPCS) {
    if (rpc.name === "paypal_subscription_status_rank") continue;
    const re = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${rpc.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}[\\s\\S]*?SECURITY DEFINER\\s*\\nSET search_path = public, pg_temp`
    );
    assert.match(SQL, re);
  }
});

test("15 REVOKE PUBLIC/anon/authenticated; GRANT service_role only", () => {
  for (const rpc of RPCS) {
    assertRevokeGrant(rpc.name, rpc.sig);
  }
});

test("16 no points/tickets/coins mutation", () => {
  assert.doesNotMatch(SQL, /UPDATE\s+public\.users/i);
  assert.doesNotMatch(SQL, /point_transactions|ticket_transactions|coin_transactions/i);
  assert.doesNotMatch(SQL, /apply_generic_balance|claim_gacha|redeem_gift/i);
});

test("17 user_id type compatible with legacy TEXT", () => {
  assert.match(SQL, /user_id TEXT NOT NULL/);
  assert.match(SQL, /user_id TEXT PRIMARY KEY/);
  assert.match(LEGACY_SQL, /user_id TEXT NOT NULL/);
  assert.match(SQL, /paypal_event_id TEXT NOT NULL/);
});

test("18 sanitized payload rejects payer PII keys", () => {
  assert.match(SQL, /SANITIZED_PAYLOAD_CONTAINS_PII/);
  assert.match(SQL, /v_payload \? 'payer'/);
  assert.match(SQL, /v_payload \? 'subscriber'/);
  assert.match(SQL, /v_payload \? 'email'/);
});

test("19 bound pending not expired by TTL path (requires paypal_subscription_id IS NULL)", () => {
  const expireFn = SQL.match(
    /CREATE OR REPLACE FUNCTION public\.expire_unstarted_subscription_session[\s\S]*?\$\$;/
  );
  assert.ok(expireFn);
  assert.match(expireFn[0], /paypal_subscription_id IS NULL/);
  assert.doesNotMatch(
    expireFn[0],
    /paypal_subscription_id IS NOT NULL[\s\S]{0,80}EXPIRED_SETUP/
  );
});

test("20 does not create free entitlements table", () => {
  assert.doesNotMatch(SQL, /user_plan_entitlements/i);
});
