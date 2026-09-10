"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SQL = fs.readFileSync(
  path.join(__dirname, "..", "20260821000200_payment_orders_and_webhook_events.sql"),
  "utf8"
);

const PAYMENT_RPCS = [
  {
    name: "create_payment_order",
    sig: "TEXT, TEXT, NUMERIC, TEXT, TEXT"
  },
  {
    name: "attach_paypal_order_id",
    sig: "UUID, TEXT"
  },
  {
    name: "transition_payment_order_status",
    sig: "UUID, TEXT, TEXT, TEXT"
  },
  {
    name: "fail_stale_open_payment_orders",
    sig: "TEXT, TEXT, INTEGER"
  },
  {
    name: "process_paypal_webhook_event",
    sig: "TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB"
  },
  {
    name: "payment_order_status_rank",
    sig: "TEXT"
  }
];

test("payment_orders: numeric amount + unique ids + one-open index", () => {
  assert.match(SQL, /amount NUMERIC\(12, 2\) NOT NULL/);
  assert.match(SQL, /CONSTRAINT uq_payment_orders_paypal_order_id UNIQUE \(paypal_order_id\)/);
  assert.match(SQL, /CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_paypal_capture_id/);
  assert.match(SQL, /CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_one_open_per_user_plan/);
  assert.match(SQL, /WHERE status IN \('created', 'approved', 'capture_pending'\)/);
});

test("payment_webhook_events: unique paypal_event_id", () => {
  assert.match(SQL, /CONSTRAINT uq_payment_webhook_events_paypal_event_id UNIQUE \(paypal_event_id\)/);
});

test("RLS denies authenticated/anon writes", () => {
  assert.match(SQL, /p_payment_orders_deny_write_authenticated/);
  assert.match(SQL, /p_payment_orders_deny_all_anon/);
  assert.match(SQL, /p_payment_webhook_events_deny_all_authenticated/);
  assert.doesNotMatch(SQL, /USING \(true\)/);
});

test("COMPLETED validation: no IS NOT NULL skip; requires capture/amount/currency/merchant compare", () => {
  assert.doesNotMatch(SQL, /IF p_expected_amount IS NOT NULL AND v_order\.amount/);
  assert.doesNotMatch(SQL, /IF p_expected_currency IS NOT NULL\s*\n\s*AND upper\(v_order\.currency\)/);
  assert.match(SQL, /MISSING_PAYPAL_CAPTURE_ID/);
  assert.match(SQL, /MISSING_AMOUNT/);
  assert.match(SQL, /MISSING_CURRENCY/);
  assert.match(SQL, /p_actual_merchant_id/);
  assert.match(SQL, /MERCHANT_MISMATCH/);
  assert.match(SQL, /outcome := 'rejected'/);
});

test("status regression + capture conflict not swallowed as paid", () => {
  assert.match(SQL, /STATUS_REGRESSION_FORBIDDEN/);
  assert.match(SQL, /CAPTURE_ID_REUSED/);
  assert.match(SQL, /CAPTURE_ID_UNIQUE_VIOLATION/);
  assert.match(SQL, /fail_stale_open_payment_orders/);
  assert.match(SQL, /p_max_age_minutes INTEGER DEFAULT 15/);
});

test("no entitlement tables created", () => {
  assert.doesNotMatch(SQL, /CREATE TABLE IF NOT EXISTS public\.user_plan_entitlements/i);
  assert.doesNotMatch(SQL, /CREATE TABLE IF NOT EXISTS public\.subscriptions\b/);
});

for (const rpc of PAYMENT_RPCS) {
  test(`RPC ${rpc.name}: REVOKE anon+authenticated; GRANT service_role only`, () => {
    const escaped = rpc.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sigEscaped = rpc.sig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  });
}
