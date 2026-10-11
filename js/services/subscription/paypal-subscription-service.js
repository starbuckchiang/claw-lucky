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

    async function getGiftStatus() {
      return invokeFunction({
        action: "get_gift_status"
      });
    }

    async function submitGiftAddress({
      recipientName,
      recipientPhone,
      addressLine1,
      addressLine2,
      city,
      region,
      postalCode,
      country
    } = {}) {
      return invokeFunction({
        action: "submit_gift_address",
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        address_line1: addressLine1,
        address_line2: addressLine2,
        city,
        region,
        postal_code: postalCode,
        country
      });
    }

    async function requestRefund({ reason } = {}) {
      return invokeFunction({
        action: "request_refund",
        reason
      });
    }

    async function confirmGiftShippingFeePayment({ paypalOrderId } = {}) {
      return invokeFunction({
        action: "confirm_gift_shipping_fee_payment",
        paypalOrderId
      });
    }

    return {
      createSession,
      confirmSubscription,
      getStatus,
      cancelSubscription,
      getGiftStatus,
      submitGiftAddress,
      requestRefund,
      confirmGiftShippingFeePayment
    };
  }

  return { createPaypalSubscriptionService };
});
