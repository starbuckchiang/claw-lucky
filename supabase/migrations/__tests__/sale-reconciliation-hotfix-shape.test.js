"use strict";

/**
 * Auth-07C.7E: static shape assertions for sale reconciliation hotfix migration.
 * No remote DB / db push.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SQL = fs.readFileSync(
  path.join(__dirname, "..", "20260908000100_sale_reconciliation_hotfix.sql"),
  "utf8"
);

const BASE = fs.readFileSync(
  path.join(__dirname, "..", "20260907000100_paypal_subscriptions_rpc.sql"),
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

test("07C.7E additive migration does not edit base migration file", () => {
  assert.doesNotMatch(BASE, /reconcile_paypal_subscription_sale/);
  assert.doesNotMatch(BASE, /ensure_paypal_webhook_event_received/);
  assert.match(SQL, /Auth-07C\.7E/);
});

test("07C.7E adds audit columns without PII", () => {
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS audit_source TEXT/);
  assert.match(SQL, /paypal_api_reconciliation/);
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ/);
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS merchant_validation_source TEXT/);
  assert.match(SQL, /verified_webhook_plus_authenticated_paypal_get/);
  // Columns themselves must not store payer PII fields.
  assert.doesNotMatch(SQL, /ADD COLUMN IF NOT EXISTS payer_email/i);
  assert.doesNotMatch(SQL, /ADD COLUMN IF NOT EXISTS full_name/i);
  assert.doesNotMatch(SQL, /ADD COLUMN IF NOT EXISTS shipping_address/i);
});

test("07C.7E ensure + finalize RPCs are service_role only", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.ensure_paypal_webhook_event_received/);
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.finalize_paypal_webhook_event_failure/);
  assert.match(SQL, /'SUCCESS',\s*'received'/);
  assertRevokeGrant(
    "ensure_paypal_webhook_event_received",
    "TEXT, TEXT, TEXT, TEXT, JSONB"
  );
  assertRevokeGrant(
    "finalize_paypal_webhook_event_failure",
    "TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT"
  );
});

test("07C.7E process continues from received and marks webhook audit_source", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.process_paypal_subscription_webhook_event/);
  assert.match(SQL, /v_event\.processing_status IS DISTINCT FROM 'received'/);
  assert.match(SQL, /audit_source/);
  assert.match(SQL, /'paypal_webhook'/);
});

test("07C.7E reconcile_paypal_subscription_sale is service_role only + sale UNIQUE", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.reconcile_paypal_subscription_sale/);
  assert.match(SQL, /paypal_api_reconciliation:/);
  assert.match(SQL, /WHERE paypal_sale_id = btrim\(p_paypal_sale_id\)/);
  assert.match(SQL, /OWNER_MISMATCH/);
  assert.match(SQL, /SECURITY DEFINER/);
  assert.match(SQL, /SET search_path = public, pg_temp/);
  assertRevokeGrant(
    "reconcile_paypal_subscription_sale",
    "TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB"
  );
});

test("07C.7E finalize does not regress terminal events", () => {
  assert.match(SQL, /already_terminal/);
  assert.match(SQL, /never regress terminal processed\/duplicate\/ignored rows/);
  assert.match(
    SQL,
    /AND processing_status IN \(\s*'received',\s*'pending_resolution',\s*'reconciliation_pending',\s*'failed'\s*\)/
  );
});

test("07C.7E sanitize rejects PII keys in payloads", () => {
  assert.match(SQL, /SANITIZED_PAYLOAD_CONTAINS_PII/);
  assert.match(SQL, /v_payload \? 'payer'/);
  assert.match(SQL, /v_audit \? 'subscriber'/);
});

test("07C.7E reconcile UPDATE qualifies paid_through to avoid OUT ambiguity", () => {
  assert.match(SQL, /UPDATE public\.paypal_subscriptions AS s/);
  assert.match(SQL, /WHEN s\.paid_through IS NULL OR p_next_billing_time >= s\.paid_through/);
});
