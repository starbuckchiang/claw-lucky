"use strict";

/**
 * Browser + Node helper for Auth-07C.4 paypal-subscription Edge Function.
 * Does not talk to PayPal directly — only our Edge Function.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.PaypalSubscriptionService = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function factory() {
  function createPaypalSubscriptionService({ invokeFunction } = {}) {
    if (typeof invokeFunction !== "function") {
      throw new Error("createPaypalSubscriptionService requires invokeFunction(...).");
    }

    async function createSession({ planCode } = {}) {
      return invokeFunction({
        action: "create_session",
        plan_code: planCode
      });
    }

    async function confirmSubscription({ subscriptionID, checkoutSessionId } = {}) {
      return invokeFunction({
        action: "confirm_subscription",
        subscriptionID,
        checkout_session_id: checkoutSessionId
      });
    }

    async function getStatus() {
      return invokeFunction({
        action: "get_status"
      });
    }

    async function cancelSubscription() {
      return invokeFunction({
        action: "cancel_subscription"
      });
    }

    return {
      createSession,
      confirmSubscription,
      getStatus,
      cancelSubscription
    };
  }

  return { createPaypalSubscriptionService };
});
