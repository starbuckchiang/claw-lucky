"use strict";

/**
 * Browser helper for the newebpay-subscription Edge Function.
 * Does not talk to NewebPay and does not set amounts.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.NewebpaySubscriptionService = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function factory() {
  const OFFICIAL_PERIOD_URLS = Object.freeze([
    "https://ccore.newebpay.com/MPG/period",
    "https://core.newebpay.com/MPG/period"
  ]);

  function createNewebpaySubscriptionService({ invokeFunction } = {}) {
    if (typeof invokeFunction !== "function") {
      throw new Error("createNewebpaySubscriptionService requires invokeFunction(...).");
    }

    function createCheckout({ planCode } = {}) {
      return invokeFunction({
        action: "create_checkout",
        plan_code: planCode
      });
    }

    function getStatus() {
      return invokeFunction({ action: "get_status" });
    }

    function cancelSubscription() {
      return invokeFunction({ action: "cancel_subscription" });
    }

    return {
      createCheckout,
      getStatus,
      cancelSubscription
    };
  }

  function isOfficialCheckoutUrl(value) {
    return OFFICIAL_PERIOD_URLS.indexOf(String(value || "")) !== -1;
  }

  return {
    OFFICIAL_PERIOD_URLS,
    createNewebpaySubscriptionService,
    isOfficialCheckoutUrl
  };
});
