"use strict";

/**
 * PROD-RELEASE-DAY3C (line 151-198): confirm_gift_shipping_fee_payment
 * action handler tests (mock repo only, no real DB/PayPal).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handlePaypalSubscriptionRequest,
  handleConfirmGiftShippingFeePayment
} = require("../paypal-subscription-handler");

function officialUser(overrides = {}) {
  return {
    id: "user-1",
    is_anonymous: false,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    identities: [],
    ...overrides
  };
}

function anonymousUser() {
  return { id: "anon-1", is_anonymous: true, identities: [] };
}

function fakeGiftRepo({ entitlement = null, confirmThrows = null } = {}) {
  let row = entitlement ? { ...entitlement } : null;
  return {
    calls: { confirmGiftShippingFeePayment: [] },
    async getGiftEntitlement(userId) {
      if (!row || row.user_id !== userId) return null;
      return { ...row };
    },
    async confirmGiftShippingFeePayment(input) {
      this.calls.confirmGiftShippingFeePayment.push(input);
      if (confirmThrows) throw new Error(confirmThrows);
      row = { ...(row || {}), status: "awaiting_shipment", shipping_fee_paypal_order_id: input.paypalOrderId };
      return { entitlement_id: "ent-1", status: "awaiting_shipment" };
    }
  };
}

test("handleConfirmGiftShippingFeePayment: rejects anonymous users", async () => {
  const result = await handleConfirmGiftShippingFeePayment({
    body: { paypalOrderId: "PO-1" },
    user: anonymousUser(),
    deps: { subscriptionRepository: fakeGiftRepo() }
  });
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, "ACCOUNT_UPGRADE_REQUIRED");
});

test("handleConfirmGiftShippingFeePayment: paypalOrderId is required", async () => {
  const result = await handleConfirmGiftShippingFeePayment({
    body: {},
    user: officialUser(),
    deps: { subscriptionRepository: fakeGiftRepo() }
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, "INVALID_REQUEST");
});

test("handleConfirmGiftShippingFeePayment: success forwards the authenticated userId + paypalOrderId ONLY, returns updated gift status", async () => {
  const repo = fakeGiftRepo({ entitlement: { user_id: "user-1", status: "fee_quoted" } });
  const result = await handleConfirmGiftShippingFeePayment({
    body: { paypalOrderId: "PO-123" },
    user: officialUser(),
    deps: { subscriptionRepository: repo }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.gift.status, "awaiting_shipment");
  assert.deepEqual(repo.calls.confirmGiftShippingFeePayment[0], { userId: "user-1", paypalOrderId: "PO-123" });
});

test("handleConfirmGiftShippingFeePayment: never trusts a client-supplied userId in the body", async () => {
  const repo = fakeGiftRepo({ entitlement: { user_id: "user-1", status: "fee_quoted" } });
  await handleConfirmGiftShippingFeePayment({
    body: { paypalOrderId: "PO-1", userId: "someone-else" },
    user: officialUser(),
    deps: { subscriptionRepository: repo }
  });
  assert.equal(repo.calls.confirmGiftShippingFeePayment[0].userId, "user-1");
});

test("handleConfirmGiftShippingFeePayment: SHIPPING_FEE_ORDER_NOT_FOUND maps to 404", async () => {
  const repo = fakeGiftRepo({ confirmThrows: "SHIPPING_FEE_ORDER_NOT_FOUND" });
  const result = await handleConfirmGiftShippingFeePayment({
    body: { paypalOrderId: "PO-missing" },
    user: officialUser(),
    deps: { subscriptionRepository: repo }
  });
  assert.equal(result.statusCode, 404);
  assert.equal(result.body.error.code, "SHIPPING_FEE_ORDER_NOT_FOUND");
});

test("handleConfirmGiftShippingFeePayment: SHIPPING_FEE_ORDER_NOT_PAID / SHIPPING_FEE_STATUS_INVALID / SHIPPING_FEE_AMOUNT_MISMATCH all map to 409", async () => {
  for (const code of ["SHIPPING_FEE_ORDER_NOT_PAID", "SHIPPING_FEE_STATUS_INVALID", "SHIPPING_FEE_AMOUNT_MISMATCH"]) {
    const repo = fakeGiftRepo({ confirmThrows: code });
    const result = await handleConfirmGiftShippingFeePayment({
      body: { paypalOrderId: "PO-1" },
      user: officialUser(),
      deps: { subscriptionRepository: repo }
    });
    assert.equal(result.statusCode, 409, code);
    assert.equal(result.body.error.code, code);
  }
});

test("handlePaypalSubscriptionRequest: routes confirm_gift_shipping_fee_payment", async () => {
  const repo = fakeGiftRepo({ entitlement: { user_id: "user-1", status: "fee_quoted" } });
  const result = await handlePaypalSubscriptionRequest({
    body: { action: "confirm_gift_shipping_fee_payment", paypalOrderId: "PO-1" },
    user: officialUser(),
    correlationId: "corr-1",
    deps: { subscriptionRepository: repo }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.gift.status, "awaiting_shipment");
});

test("handlePaypalSubscriptionRequest: unknown action lists all 8 valid actions in the error message", async () => {
  const result = await handlePaypalSubscriptionRequest({
    body: { action: "not_a_real_action" },
    user: officialUser(),
    correlationId: "corr-1",
    deps: {}
  });
  assert.equal(result.statusCode, 400);
  for (const action of [
    "create_session",
    "confirm_subscription",
    "get_status",
    "cancel_subscription",
    "get_gift_status",
    "submit_gift_address",
    "request_refund",
    "confirm_gift_shipping_fee_payment"
  ]) {
    assert.match(result.body.error.message, new RegExp(action));
  }
});
