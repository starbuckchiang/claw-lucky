"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPaypalSubscriptionService
} = require("../paypal-subscription-service");

test("paypal-subscription-service forwards create/confirm/status/cancel actions", async () => {
  const calls = [];
  const svc = createPaypalSubscriptionService({
    async invokeFunction(body) {
      calls.push(body);
      return { ok: true };
    }
  });

  await svc.createSession({ planCode: "monthly" });
  await svc.confirmSubscription({
    subscriptionID: "I-1",
    checkoutSessionId: "sess-1"
  });
  await svc.getStatus();
  await svc.cancelSubscription();

  assert.deepEqual(calls[0], {
    action: "create_session",
    plan_code: "monthly"
  });
  assert.deepEqual(calls[1], {
    action: "confirm_subscription",
    subscriptionID: "I-1",
    checkout_session_id: "sess-1"
  });
  assert.deepEqual(calls[2], { action: "get_status" });
  assert.deepEqual(calls[3], { action: "cancel_subscription" });
});

test("paypal-subscription-service requires invokeFunction", () => {
  assert.throws(() => createPaypalSubscriptionService({}), /invokeFunction/);
});

test("paypal-subscription-service forwards gift status/address and refund-request actions", async () => {
  const calls = [];
  const svc = createPaypalSubscriptionService({
    async invokeFunction(body) {
      calls.push(body);
      return { ok: true };
    }
  });

  await svc.getGiftStatus();
  await svc.submitGiftAddress({
    recipientName: "王小明",
    recipientPhone: "0912345678",
    addressLine1: "松山路471號四樓",
    addressLine2: null,
    city: "台北市",
    region: "信義區",
    postalCode: "110",
    country: "台灣"
  });
  await svc.requestRefund({ reason: "changed my mind" });

  assert.deepEqual(calls[0], { action: "get_gift_status" });
  assert.deepEqual(calls[1], {
    action: "submit_gift_address",
    recipient_name: "王小明",
    recipient_phone: "0912345678",
    address_line1: "松山路471號四樓",
    address_line2: null,
    city: "台北市",
    region: "信義區",
    postal_code: "110",
    country: "台灣"
  });
  assert.deepEqual(calls[2], {
    action: "request_refund",
    reason: "changed my mind"
  });
});
