"use strict";

/**
 * PROD-RELEASE-DAY3C: static shape + encoded-behavior assertions for the
 * physical gift entitlement/fulfillment/refund-request migration.
 *
 * No remote DB / db push. Mirrors the established
 * supabase/migrations/__tests__ harness pattern (e.g.
 * paypal-subscriptions-rpc-shape.test.js).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SQL = fs.readFileSync(
  path.join(__dirname, "..", "20261009000100_physical_gift_fulfillment.sql"),
  "utf8"
);

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

test("01 physical_gift_entitlements: UNIQUE(user_id) enforces exactly-once-ever granting", () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.physical_gift_entitlements/);
  assert.match(SQL, /user_id TEXT NOT NULL UNIQUE/);
  const table = SQL.match(
    /CREATE TABLE IF NOT EXISTS public\.physical_gift_entitlements \([\s\S]*?\n\);/
  );
  assert.ok(table, "physical_gift_entitlements table DDL present");
});

test("01b physical_gift_entitlements: fee amount/currency/region have no default or placeholder value", () => {
  const table = SQL.match(
    /CREATE TABLE IF NOT EXISTS public\.physical_gift_entitlements \([\s\S]*?\n\);/
  )[0];
  assert.match(table, /shipping_fee_currency TEXT,/);
  assert.match(table, /shipping_fee_amount NUMERIC\(12, 2\),/);
  assert.doesNotMatch(table, /shipping_fee_amount[^,]*DEFAULT/i);
  assert.doesNotMatch(table, /shipping_fee_currency[^,]*DEFAULT/i);
  assert.doesNotMatch(SQL, /shipping_fee_amount\s*=\s*0/);
  assert.doesNotMatch(SQL, /free shipping|免運/i);
});

test("02 physical_gift_entitlements: RLS owner-only SELECT, no client write grant", () => {
  assert.match(SQL, /ALTER TABLE public\.physical_gift_entitlements ENABLE ROW LEVEL SECURITY;/);
  assert.match(
    SQL,
    /REVOKE ALL PRIVILEGES ON TABLE public\.physical_gift_entitlements FROM anon, authenticated;/
  );
  assert.match(
    SQL,
    /CREATE POLICY physical_gift_entitlements_owner_select[\s\S]*?USING \(user_id = public\.request_user_key\(\)\);/
  );
  assert.doesNotMatch(SQL, /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.physical_gift_entitlements/);
});

test("03 subscription_refund_requests: one pending request per subscription, RLS owner-only SELECT", () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.subscription_refund_requests/);
  assert.match(SQL, /status TEXT NOT NULL DEFAULT 'pending'\s+CHECK \(status IN \('pending', 'approved', 'rejected'\)\)/);
  assert.match(
    SQL,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_refund_requests_one_pending_per_subscription\s+ON public\.subscription_refund_requests \(subscription_id\)\s+WHERE status = 'pending';/
  );
  assert.match(SQL, /ALTER TABLE public\.subscription_refund_requests ENABLE ROW LEVEL SECURITY;/);
  assert.doesNotMatch(SQL, /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.subscription_refund_requests/);
});

test("04 grant_physical_gift_if_first_payment: idempotent via ON CONFLICT DO NOTHING, service_role only", () => {
  assert.match(
    SQL,
    /INSERT INTO public\.physical_gift_entitlements \([\s\S]*?ON CONFLICT \(user_id\) DO NOTHING\s+RETURNING id INTO v_id;/
  );
  assertRevokeGrant("grant_physical_gift_if_first_payment", "TEXT, UUID, TEXT");
});

test("05 submit_gift_shipping_address: locks the row, rejects once a fee has been quoted", () => {
  const fn = SQL.match(
    /CREATE OR REPLACE FUNCTION public\.submit_gift_shipping_address\([\s\S]*?\r?\nEND;\r?\n\$\$;/
  )[0];
  assert.match(fn, /FOR UPDATE;/);
  assert.match(fn, /IF v_row\.status NOT IN \('granted', 'address_submitted'\) THEN/);
  assert.match(fn, /RAISE EXCEPTION 'ADDRESS_LOCKED_AFTER_FEE_QUOTE';/);
  assertRevokeGrant(
    "submit_gift_shipping_address",
    "TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT"
  );
});

test("06 request_subscription_refund: ownership check, no auto fee deduction, separate from cancel", () => {
  const fn = SQL.match(
    /CREATE OR REPLACE FUNCTION public\.request_subscription_refund\([\s\S]*?\r?\nEND;\r?\n\$\$;/
  )[0];
  assert.match(fn, /IF v_sub\.id IS NULL OR v_sub\.user_id IS DISTINCT FROM p_user_id THEN/);
  assert.match(fn, /RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';/);
  assert.match(fn, /RAISE EXCEPTION 'REFUND_REQUEST_ALREADY_PENDING';/);
  assert.doesNotMatch(fn, /cancel|CANCELLED/);
  assert.doesNotMatch(fn, /processing_fee|fee_amount|\* 0\./i);
  assertRevokeGrant("request_subscription_refund", "TEXT, UUID, TEXT");
});

test("07 process_paypal_subscription_webhook_event: physical gift grant happens inside the SAME SALE.COMPLETED success path, before returning", () => {
  const fn = SQL.match(
    /CREATE OR REPLACE FUNCTION public\.process_paypal_subscription_webhook_event\([\s\S]*?\r?\nEND;\r?\n\$\$;/
  )[0];
  const saleBranchStart = fn.indexOf("IF p_event_type = 'PAYMENT.SALE.COMPLETED' THEN");
  const paymentFailedBranchStart = fn.indexOf("IF p_event_type = 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' THEN");
  assert.ok(saleBranchStart > -1 && paymentFailedBranchStart > saleBranchStart);
  const saleBranch = fn.slice(saleBranchStart, paymentFailedBranchStart);

  const eventLogInsertIdx = saleBranch.lastIndexOf("INSERT INTO public.payment_webhook_events");
  const grantCallIdx = saleBranch.indexOf("PERFORM public.grant_physical_gift_if_first_payment(");
  const outcomeProcessedIdx = saleBranch.lastIndexOf("outcome := 'processed';");

  assert.ok(eventLogInsertIdx > -1, "sale-completed event log insert present");
  assert.ok(grantCallIdx > -1, "physical gift grant call present in the SALE.COMPLETED branch");
  assert.ok(outcomeProcessedIdx > -1, "outcome := 'processed' present in the SALE.COMPLETED branch");
  assert.ok(
    eventLogInsertIdx < grantCallIdx && grantCallIdx < outcomeProcessedIdx,
    "grant call must run after the event is logged and before the success outcome is returned"
  );
  assert.match(
    saleBranch,
    /PERFORM public\.grant_physical_gift_if_first_payment\(\s*v_sub\.user_id, v_sub\.id, btrim\(p_paypal_sale_id\)\s*\);/
  );
});

test("08 process_paypal_subscription_webhook_event: refund/reversal and lifecycle branches unchanged (no gift grant call there)", () => {
  const fn = SQL.match(
    /CREATE OR REPLACE FUNCTION public\.process_paypal_subscription_webhook_event\([\s\S]*?\r?\nEND;\r?\n\$\$;/
  )[0];
  const refundBranchStart = fn.indexOf("IF p_event_type IN ('PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED') THEN");
  assert.ok(refundBranchStart > -1);
  const afterRefundBranch = fn.slice(refundBranchStart);
  assert.doesNotMatch(afterRefundBranch, /grant_physical_gift_if_first_payment/);
});

test("09 process_paypal_subscription_webhook_event: still SECURITY DEFINER, pinned search_path, service_role only", () => {
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.process_paypal_subscription_webhook_event\([\s\S]{0,800}?SECURITY DEFINER\s+SET search_path = public, pg_temp/
  );
  assertRevokeGrant(
    "process_paypal_subscription_webhook_event",
    "TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, JSONB, TEXT"
  );
});

test("10 no invented shipping fee amount, region allowlist, or shipment timeline anywhere in this migration", () => {
  assert.doesNotMatch(SQL, /\b\d+\s*(days|天|working days|個工作天)\b/i);
  assert.doesNotMatch(SQL, /TWD|NT\$/);
  assert.doesNotMatch(SQL, /shipping_region_allowlist|region IN \(/);
});
