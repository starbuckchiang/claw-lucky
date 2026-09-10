"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPaypalCheckoutService
} = require("../paypal-checkout-service");

test("paypal-checkout-service forwards create/capture actions only", async () => {
  const calls = [];
  const svc = createPaypalCheckoutService({
    async invokeFunction(body) {
      calls.push(body);
      return { ok: true, orderId: "O1" };
    }
  });

  await svc.createOrder({ planCode: "monthly", idempotencyKey: "k" });
  await svc.captureOrder({ orderId: "O1" });

  assert.deepEqual(calls[0], {
    action: "create-order",
    planCode: "monthly",
    idempotencyKey: "k"
  });
  assert.deepEqual(calls[1], { action: "capture-order", orderId: "O1" });
});
