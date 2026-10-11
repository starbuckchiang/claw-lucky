"use strict";

/**
 * PROD-RELEASE-DAY3C: physical gift status/address + refund-request handler
 * tests (mock repo only, no real DB/PayPal).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handlePaypalSubscriptionRequest,
  handleGetGiftStatus,
  handleSubmitGiftAddress,
  handleRequestRefund,
  safeGiftSummary
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

const VALID_ADDRESS_BODY = {
  recipient_name: "王小明",
  recipient_phone: "0912345678",
  address_line1: "松山路471號四樓",
  city: "台北市",
  region: "信義區",
  postal_code: "110",
  country: "台灣"
};

function defaultSubscriptionFixture() {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  return {
    id: "sub-1",
    user_id: "user-1",
    start_time: new Date(now - 100 * DAY).toISOString(),
    last_payment_time: new Date(now - 10 * DAY).toISOString(),
    next_billing_time: new Date(now + 20 * DAY).toISOString(),
    recurring_amount: 10,
    currency: "USD"
  };
}

function fakeGiftRepo({
  entitlement = null,
  addressThrows = null,
  refundThrows = null,
  subscription = defaultSubscriptionFixture()
} = {}) {
  let row = entitlement ? { ...entitlement } : null;
  return {
    calls: { submitGiftShippingAddress: 0, requestSubscriptionRefund: 0, findLatestByUserId: 0 },
    async getGiftEntitlement(userId) {
      if (!row || row.user_id !== userId) return null;
      return { ...row };
    },
    async findLatestByUserId(userId) {
      this.calls.findLatestByUserId += 1;
      if (!subscription || subscription.user_id !== userId) return null;
      return { ...subscription };
    },
    async submitGiftShippingAddress(input) {
      this.calls.submitGiftShippingAddress += 1;
      if (addressThrows) throw new Error(addressThrows);
      row = {
        ...(row || { user_id: input.userId, status: "granted" }),
        user_id: input.userId,
        recipient_name: input.recipientName,
        recipient_phone: input.recipientPhone,
        address_line1: input.addressLine1,
        address_line2: input.addressLine2,
        city: input.city,
        region: input.region,
        postal_code: input.postalCode,
        country: input.country,
        status: "address_submitted"
      };
      return { entitlement_id: "ent-1", status: "address_submitted" };
    },
    async requestSubscriptionRefund(input) {
      this.calls.requestSubscriptionRefund += 1;
      if (refundThrows) throw new Error(refundThrows);
      return { request_id: "refund-1", status: "pending" };
    }
  };
}

test("handleGetGiftStatus: rejects anonymous users", async () => {
  const result = await handleGetGiftStatus({
    user: anonymousUser(),
    deps: { subscriptionRepository: fakeGiftRepo() }
  });
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, "ACCOUNT_UPGRADE_REQUIRED");
});

test("handleGetGiftStatus: returns null gift when no entitlement row exists", async () => {
  const result = await handleGetGiftStatus({
    user: officialUser(),
    deps: { subscriptionRepository: fakeGiftRepo() }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.gift, null);
});

test("handleGetGiftStatus: returns a sanitized summary, never leaks internal columns", async () => {
  const repo = fakeGiftRepo({
    entitlement: {
      user_id: "user-1",
      status: "granted",
      source_subscription_id: "sub-internal-id",
      source_paypal_sale_id: "sale-internal-id",
      granted_at: "2026-10-01T00:00:00Z"
    }
  });
  const result = await handleGetGiftStatus({ user: officialUser(), deps: { subscriptionRepository: repo } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.gift.status, "granted");
  assert.equal(result.body.gift.granted_at, "2026-10-01T00:00:00Z");
  assert.equal("source_subscription_id" in result.body.gift, false);
  assert.equal("source_paypal_sale_id" in result.body.gift, false);
});

test("safeGiftSummary: shipping fee amount/currency stay null until an operator quotes them", () => {
  const summary = safeGiftSummary({
    status: "address_submitted",
    shipping_fee_amount: null,
    shipping_fee_currency: null
  });
  assert.equal(summary.shipping_fee_amount, null);
  assert.equal(summary.shipping_fee_currency, null);
});

test("handleSubmitGiftAddress: rejects when any required field is missing", async () => {
  const repo = fakeGiftRepo({ entitlement: { user_id: "user-1", status: "granted" } });
  const result = await handleSubmitGiftAddress({
    body: { ...VALID_ADDRESS_BODY, recipient_phone: "" },
    user: officialUser(),
    deps: { subscriptionRepository: repo }
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, "ADDRESS_FIELDS_REQUIRED");
  assert.equal(repo.calls.submitGiftShippingAddress, 0);
});

test("handleSubmitGiftAddress: succeeds and returns the updated status", async () => {
  const repo = fakeGiftRepo({ entitlement: { user_id: "user-1", status: "granted" } });
  const result = await handleSubmitGiftAddress({
    body: VALID_ADDRESS_BODY,
    user: officialUser(),
    deps: { subscriptionRepository: repo }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.gift.status, "address_submitted");
  assert.equal(repo.calls.submitGiftShippingAddress, 1);
});

test("handleSubmitGiftAddress: not eligible maps to 404 GIFT_NOT_ELIGIBLE", async () => {
  const repo = fakeGiftRepo({ addressThrows: "GIFT_NOT_ELIGIBLE" });
  const result = await handleSubmitGiftAddress({
    body: VALID_ADDRESS_BODY,
    user: officialUser(),
    deps: { subscriptionRepository: repo }
  });
  assert.equal(result.statusCode, 404);
  assert.equal(result.body.error.code, "GIFT_NOT_ELIGIBLE");
});

test("handleSubmitGiftAddress: once already paid, address is locked (409)", async () => {
  const repo = fakeGiftRepo({ addressThrows: "ADDRESS_LOCKED_AFTER_FEE_PAID" });
  const result = await handleSubmitGiftAddress({
    body: VALID_ADDRESS_BODY,
    user: officialUser(),
    deps: { subscriptionRepository: repo }
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.code, "ADDRESS_LOCKED_AFTER_FEE_PAID");
});

test("handleRequestRefund: 404 when the user has no subscription at all", async () => {
  const repo = fakeGiftRepo({ subscription: null });
  const result = await handleRequestRefund({
    body: { reason: "test" },
    user: officialUser(),
    deps: { subscriptionRepository: repo }
  });
  assert.equal(result.statusCode, 404);
  assert.equal(result.body.error.code, "SUBSCRIPTION_NOT_FOUND");
  assert.equal(repo.calls.requestSubscriptionRefund, 0);
});

test("handleRequestRefund: 409 when the subscription has no confirmed paid period yet", async () => {
  const repo = fakeGiftRepo({
    subscription: { id: "sub-1", user_id: "user-1", start_time: null, last_payment_time: null, next_billing_time: null }
  });
  const result = await handleRequestRefund({
    body: {},
    user: officialUser(),
    deps: { subscriptionRepository: repo }
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.code, "REFUND_CALC_PERIOD_UNKNOWN");
  assert.equal(repo.calls.requestSubscriptionRefund, 0);
});

test("handleRequestRefund: succeeds and never auto-approves (always pending)", async () => {
  const repo = fakeGiftRepo();
  const result = await handleRequestRefund({
    body: { reason: "changed my mind" },
    user: officialUser(),
    deps: { subscriptionRepository: repo }
  });
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.refund_request.status, "pending");
  assert.equal(result.body.refund_request.refund_success, false);
});

test("handleRequestRefund: a second request while one is already pending is rejected (409)", async () => {
  const repo = fakeGiftRepo({ refundThrows: "REFUND_REQUEST_ALREADY_PENDING" });
  const result = await handleRequestRefund({
    body: {},
    user: officialUser(),
    deps: { subscriptionRepository: repo }
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.code, "REFUND_REQUEST_ALREADY_PENDING");
});

test("handleRequestRefund: a raised SUBSCRIPTION_NOT_FOUND from the RPC itself still maps to 404", async () => {
  const repo = fakeGiftRepo({ refundThrows: "SUBSCRIPTION_NOT_FOUND" });
  const result = await handleRequestRefund({
    body: {},
    user: officialUser(),
    deps: { subscriptionRepository: repo }
  });
  assert.equal(result.statusCode, 404);
  assert.equal(result.body.error.code, "SUBSCRIPTION_NOT_FOUND");
});

test("handlePaypalSubscriptionRequest: routes get_gift_status / submit_gift_address / request_refund actions", async () => {
  const repo = fakeGiftRepo({ entitlement: { user_id: "user-1", status: "granted" } });
  const deps = { subscriptionRepository: repo };

  const statusResult = await handlePaypalSubscriptionRequest({
    body: { action: "get_gift_status" },
    user: officialUser(),
    correlationId: "corr-1",
    deps
  });
  assert.equal(statusResult.statusCode, 200);
  assert.equal(statusResult.body.gift.status, "granted");

  const addressResult = await handlePaypalSubscriptionRequest({
    body: { action: "submit_gift_address", ...VALID_ADDRESS_BODY },
    user: officialUser(),
    correlationId: "corr-2",
    deps
  });
  assert.equal(addressResult.statusCode, 200);

  const refundResult = await handlePaypalSubscriptionRequest({
    body: { action: "request_refund" },
    user: officialUser(),
    correlationId: "corr-3",
    deps
  });
  assert.equal(refundResult.statusCode, 201);
});

test("handlePaypalSubscriptionRequest: unknown action lists all 7 valid actions in the error message", async () => {
  const result = await handlePaypalSubscriptionRequest({
    body: { action: "not_a_real_action" },
    user: officialUser(),
    correlationId: "corr-4",
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
    "request_refund"
  ]) {
    assert.match(result.body.error.message, new RegExp(action));
  }
});
