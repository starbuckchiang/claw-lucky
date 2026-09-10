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
