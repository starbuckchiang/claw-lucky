"use strict";

/**
 * Browser + Node helper for Auth-07 paypal-checkout Edge Function.
 * Does not talk to PayPal directly — only our Edge Function.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.PaypalCheckoutService = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function factory() {
  function createPaypalCheckoutService({ invokeFunction } = {}) {
    if (typeof invokeFunction !== "function") {
      throw new Error("createPaypalCheckoutService requires invokeFunction(...).");
    }

    async function createOrder({ planCode, idempotencyKey } = {}) {
      return invokeFunction({
        action: "create-order",
        planCode,
        idempotencyKey
      });
    }

    async function captureOrder({ orderId } = {}) {
      return invokeFunction({
        action: "capture-order",
        orderId
      });
    }

    return { createOrder, captureOrder };
  }

  return { createPaypalCheckoutService };
});
