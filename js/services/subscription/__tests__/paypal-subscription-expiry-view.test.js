"use strict";

/**
 * Auth-07C.9: deterministic expiry view-model tests for
 * resolveSubscriptionUiState (injected nowMs — no clock changes).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const flow = require("../paypal-subscription-flow.js");

const PAID_THROUGH = "2026-10-07T10:00:00Z";
const PAID_THROUGH_MS = Date.parse(PAID_THROUGH);

function cancelledSub() {
  return {
    status: "CANCELLED",
    plan_code: "monthly",
    paid_through: PAID_THROUGH,
    next_billing_time: null,
    access_blocked: false
  };
}

test("CANCELLED before expiry: cancelled_with_access, no plan buttons, no new subscription", () => {
  const view = flow.resolveSubscriptionUiState(cancelledSub(), { nowMs: PAID_THROUGH_MS - 1 });
  assert.equal(view.mode, "cancelled_with_access");
  assert.equal(view.headline, "已取消自動續訂");
  assert.match(view.detail, /可使用至 /);
  assert.equal(view.showPlanButtons, false);
  assert.equal(view.showPayButtons, false);
  assert.equal(view.showCancelButton, false);
  assert.equal(view.allowNewSubscription, false);
});

test("CANCELLED at exact paid_through boundary: treated as expired (paidOk requires strictly future)", () => {
  const view = flow.resolveSubscriptionUiState(cancelledSub(), { nowMs: PAID_THROUGH_MS });
  assert.equal(view.mode, "expired");
  assert.equal(view.showPlanButtons, true);
  assert.equal(view.allowNewSubscription, true);
});

test("CANCELLED after expiry: expired mode re-offers plans", () => {
  const view = flow.resolveSubscriptionUiState(cancelledSub(), { nowMs: PAID_THROUGH_MS + 1 });
  assert.equal(view.mode, "expired");
  assert.equal(view.headline, "訂閱已結束");
  assert.equal(view.showPlanButtons, true);
  assert.equal(view.showPayButtons, true);
  assert.equal(view.showCancelButton, false);
  assert.equal(view.allowNewSubscription, true);
});

test("refresh consistency: same input always yields the identical view (pure mapping)", () => {
  const before = [
    flow.resolveSubscriptionUiState(cancelledSub(), { nowMs: PAID_THROUGH_MS - 1000 }),
    flow.resolveSubscriptionUiState(cancelledSub(), { nowMs: PAID_THROUGH_MS - 1000 })
  ];
  const after = [
    flow.resolveSubscriptionUiState(cancelledSub(), { nowMs: PAID_THROUGH_MS + 1000 }),
    flow.resolveSubscriptionUiState(cancelledSub(), { nowMs: PAID_THROUGH_MS + 1000 })
  ];
  assert.deepEqual(before[0], before[1]);
  assert.deepEqual(after[0], after[1]);
});

test("expired-CANCELLED with no subscription row at all still shows plans (post-release get_status null)", () => {
  const view = flow.resolveSubscriptionUiState(null, {});
  assert.equal(view.mode, "none");
  assert.equal(view.showPlanButtons, true);
  assert.equal(view.allowNewSubscription, true);
});
