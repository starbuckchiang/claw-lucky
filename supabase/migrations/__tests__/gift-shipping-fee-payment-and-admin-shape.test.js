"use strict";

/**
 * PROD-RELEASE-DAY3C (line 151-198): static shape assertions for the NT$44
 * shipping-fee payment confirmation + minimal admin backend migration.
 * No remote DB / db push — mirrors the established
 * supabase/migrations/__tests__ harness pattern.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SQL = fs.readFileSync(
  path.join(__dirname, "..", "20261011000200_gift_shipping_fee_payment_and_admin.sql"),
  "utf8"
);

function assertRevokeGrant(name, sig) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sigEscaped = sig
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  assert.match(
    SQL,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped}\\(\\s*${sigEscaped}\\s*\\) FROM PUBLIC`)
  );
  assert.match(
    SQL,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped}\\(\\s*${sigEscaped}\\s*\\) FROM anon`)
  );
  assert.match(
    SQL,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped}\\(\\s*${sigEscaped}\\s*\\) FROM authenticated`)
  );
  assert.match(
    SQL,
    new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped}\\(\\s*${sigEscaped}\\s*\\) TO service_role`)
  );
}

function extractFunctionBody(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `^CREATE OR REPLACE FUNCTION public\\.${escaped}\\([\\s\\S]*?END;\\r?\\n\\$\\$;`,
    "m"
  );
  const match = SQL.match(re);
  return match ? match[0] : null;
}

// --- confirm_gift_shipping_fee_payment ---

test("01 confirm_gift_shipping_fee_payment: reads a REAL captured payment_orders row, never trusts the frontend", () => {
  const body = extractFunctionBody("confirm_gift_shipping_fee_payment");
  assert.ok(body, "function body present");
  assert.match(body, /FROM public\.payment_orders[\s\S]*?plan_code = 'gift_shipping_fee'/);
  assert.match(body, /FOR UPDATE/);
  assert.match(body, /IF v_order\.status <> 'paid' THEN/);
  assert.match(body, /RAISE EXCEPTION 'SHIPPING_FEE_ORDER_NOT_PAID'/);
});

test("02 confirm_gift_shipping_fee_payment: requires fee_quoted status, rejects any other pre-state", () => {
  const body = extractFunctionBody("confirm_gift_shipping_fee_payment");
  assert.match(body, /IF v_row\.status <> 'fee_quoted' THEN/);
  assert.match(body, /RAISE EXCEPTION 'SHIPPING_FEE_STATUS_INVALID'/);
});

test("03 confirm_gift_shipping_fee_payment: idempotent resend with the SAME paid order returns current state, never re-mutates", () => {
  const body = extractFunctionBody("confirm_gift_shipping_fee_payment");
  assert.match(
    body,
    /IF v_row\.status IN \('awaiting_shipment', 'shipped'\)\s+AND v_row\.shipping_fee_paypal_order_id = p_paypal_order_id THEN/
  );
  const idempotentIdx = body.indexOf("awaiting_shipment', 'shipped')");
  const updateIdx = body.indexOf("SET status = 'awaiting_shipment'");
  assert.ok(idempotentIdx > -1 && updateIdx > -1 && idempotentIdx < updateIdx);
});

test("04 confirm_gift_shipping_fee_payment: amount/currency mismatch between the paid order and the quoted fee is rejected, never silently accepted", () => {
  const body = extractFunctionBody("confirm_gift_shipping_fee_payment");
  assert.match(body, /v_order\.amount IS DISTINCT FROM v_row\.shipping_fee_amount/);
  assert.match(body, /RAISE EXCEPTION 'SHIPPING_FEE_AMOUNT_MISMATCH'/);
});

test("05 confirm_gift_shipping_fee_payment: successful transition sets awaiting_shipment + paid_at + paypal_order_id", () => {
  const body = extractFunctionBody("confirm_gift_shipping_fee_payment");
  assert.match(body, /SET status = 'awaiting_shipment',\s+shipping_fee_paid_at = NOW\(\),\s+shipping_fee_paypal_order_id = p_paypal_order_id/);
});

test("06 confirm_gift_shipping_fee_payment: SECURITY DEFINER, service_role-only", () => {
  assertRevokeGrant("confirm_gift_shipping_fee_payment", "TEXT, TEXT");
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.confirm_gift_shipping_fee_payment[\s\S]{0,400}?SECURITY DEFINER/);
});

// --- app_admins / admin_audit_log / is_admin_user ---

test("07 app_admins + admin_audit_log: deny-all for anon/authenticated, no RLS policy grants client access", () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.app_admins/);
  assert.match(SQL, /ALTER TABLE public\.app_admins ENABLE ROW LEVEL SECURITY;/);
  assert.match(SQL, /REVOKE ALL PRIVILEGES ON TABLE public\.app_admins FROM anon, authenticated;/);
  assert.doesNotMatch(SQL, /CREATE POLICY \w*app_admins\w*/);

  assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.admin_audit_log/);
  assert.match(SQL, /ALTER TABLE public\.admin_audit_log ENABLE ROW LEVEL SECURITY;/);
  assert.match(SQL, /REVOKE ALL PRIVILEGES ON TABLE public\.admin_audit_log FROM anon, authenticated;/);
  assert.doesNotMatch(SQL, /CREATE POLICY \w*admin_audit_log\w*/);
});

test("08 is_admin_user: SECURITY DEFINER, service_role-only, pure existence check", () => {
  assertRevokeGrant("is_admin_user", "TEXT");
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.is_admin_user\(p_user_id TEXT\)[\s\S]{0,300}?SELECT EXISTS \(\s*SELECT 1 FROM public\.app_admins WHERE user_id = p_user_id\s*\);/
  );
});

// --- refund review / confirm-success ---

test("09 admin_list_pending_refund_requests / admin_review_refund_request / admin_confirm_refund_success: every one checks is_admin_user() FIRST, before any business query/mutation", () => {
  for (const name of [
    "admin_list_pending_refund_requests",
    "admin_review_refund_request",
    "admin_confirm_refund_success"
  ]) {
    const body = extractFunctionBody(name);
    assert.ok(body, `${name} body present`);
    assert.match(body, /IF NOT public\.is_admin_user\(p_admin_user_id\) THEN/);
    assert.match(body, /RAISE EXCEPTION 'FORBIDDEN'/);
    const forbiddenIdx = body.indexOf("RAISE EXCEPTION 'FORBIDDEN'");
    const firstSelectIdx = body.indexOf("SELECT * INTO");
    assert.ok(
      forbiddenIdx > -1 && (firstSelectIdx === -1 || forbiddenIdx < firstSelectIdx),
      `${name}: admin check happens before the first business row lookup`
    );
  }
});

test("10 admin_review_refund_request: only pending requests can be reviewed; decision restricted to approved/rejected", () => {
  const body = extractFunctionBody("admin_review_refund_request");
  assert.match(body, /v_decision NOT IN \('approved', 'rejected'\)/);
  assert.match(body, /IF v_row\.status <> 'pending' THEN/);
  assert.match(body, /RAISE EXCEPTION 'REFUND_REQUEST_NOT_PENDING'/);
  assert.match(body, /INSERT INTO public\.admin_audit_log/);
});

test("11 admin_confirm_refund_success: NEVER auto-executes a PayPal refund; requires an operator-supplied real refund record id and an already-approved request", () => {
  const body = extractFunctionBody("admin_confirm_refund_success");
  assert.match(body, /p_paypal_refund_id IS NULL OR btrim\(p_paypal_refund_id\) = ''/);
  assert.match(body, /RAISE EXCEPTION 'REFUND_RECORD_REQUIRED'/);
  assert.match(body, /IF v_row\.status <> 'approved' THEN/);
  assert.match(body, /RAISE EXCEPTION 'REFUND_REQUEST_NOT_APPROVED'/);
  assert.doesNotMatch(body, /paypal\.com|api-m\.paypal/i);
});

test("12 admin_confirm_refund_success: idempotent resend of the SAME refund record never re-mutates; a DIFFERENT record id on an already-confirmed request is rejected", () => {
  const body = extractFunctionBody("admin_confirm_refund_success");
  assert.match(body, /IF v_row\.refund_success AND v_row\.paypal_refund_id = btrim\(p_paypal_refund_id\) THEN/);
  assert.match(body, /RAISE EXCEPTION 'REFUND_ALREADY_CONFIRMED'/);
});

test("13 admin_confirm_refund_success: terminates the paid entitlement (access_blocked_at) only once refund is genuinely confirmed", () => {
  const body = extractFunctionBody("admin_confirm_refund_success");
  assert.match(
    body,
    /UPDATE public\.paypal_subscriptions\s+SET access_blocked_at = COALESCE\(access_blocked_at, NOW\(\)\)/
  );
  const updateSubIdx = body.indexOf("UPDATE public.paypal_subscriptions");
  const setSuccessIdx = body.indexOf("refund_success = TRUE");
  assert.ok(setSuccessIdx > -1 && updateSubIdx > setSuccessIdx, "entitlement only terminated AFTER refund_success is actually set");
});

test("14 refund RPCs: SECURITY DEFINER, service_role-only", () => {
  assertRevokeGrant("admin_list_pending_refund_requests", "TEXT");
  assertRevokeGrant("admin_review_refund_request", "TEXT, UUID, TEXT, TEXT");
  assertRevokeGrant("admin_confirm_refund_success", "TEXT, UUID, TEXT");
});

// --- shipment ---

test("15 admin_list_shippable_gifts: only awaiting_shipment AND not held by any pending refund request", () => {
  const body = extractFunctionBody("admin_list_shippable_gifts");
  assert.match(body, /WHERE status = 'awaiting_shipment'\s+AND held_by_refund_request_id IS NULL/);
});

test("16 admin_mark_gift_shipped: re-checks all shipment preconditions at ship time, not just the stored status", () => {
  const body = extractFunctionBody("admin_mark_gift_shipped");
  assert.match(body, /p_tracking_number IS NULL OR btrim\(p_tracking_number\) = ''/);
  assert.match(body, /RAISE EXCEPTION 'TRACKING_NUMBER_REQUIRED'/);
  assert.match(body, /IF v_row\.status <> 'awaiting_shipment' THEN/);
  assert.match(body, /RAISE EXCEPTION 'SHIPMENT_NOT_READY'/);
  assert.match(body, /IF v_row\.held_by_refund_request_id IS NOT NULL THEN/);
  assert.match(body, /RAISE EXCEPTION 'SHIPMENT_HELD_BY_REFUND_REQUEST'/);
  assert.match(body, /INSERT INTO public\.admin_audit_log/);
});

test("17 admin_mark_gift_shipped: idempotent resend when already shipped", () => {
  const body = extractFunctionBody("admin_mark_gift_shipped");
  assert.match(body, /IF v_row\.status = 'shipped' THEN\s+-- Idempotent resend\./);
});

test("18 shipment RPCs: SECURITY DEFINER, service_role-only", () => {
  assertRevokeGrant("admin_list_shippable_gifts", "TEXT");
  assertRevokeGrant("admin_mark_gift_shipped", "TEXT, UUID, TEXT");
});

test("19 subscription_refund_requests: paypal_refund_id is a new nullable column, no default, never required at request time", () => {
  assert.match(SQL, /ALTER TABLE public\.subscription_refund_requests\s+ADD COLUMN IF NOT EXISTS paypal_refund_id TEXT;/);
});
