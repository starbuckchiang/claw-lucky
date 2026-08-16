"use strict";

/**
 * Checkout Authorization Service (P-AUTH-04)
 *
 * Implements specs/003-spec-auth-subscription.md Section 11 (Checkout
 * Authorization) — the `subscription-checkout` Edge Function MUST re-verify
 * all of this itself, never trusting the frontend's own Subscription Entry
 * Guard (P-AUTH-03) decision:
 *
 *   Case 1: no JWT                       -> 401 UNAUTHORIZED
 *   Case 2: Anonymous User                -> 403 ACCOUNT_UPGRADE_REQUIRED
 *   Case 3: Identity 未驗證                -> 403 IDENTITY_NOT_VERIFIED
 *   Case 4: 已有有效訂閱                    -> return the EXISTING subscription
 *           (never create a duplicate Checkout Session)
 *   Case 5: 正式使用者                     -> create a Checkout Session
 *
 * This module does its own I/O via injected `subscriptionRepository` /
 * `checkoutSessionCreator` (dependency injection, matching the style of
 * the other `js/services/**` services, e.g. generation-service.js), so it
 * stays unit-testable under `node --test` without a real Supabase project
 * or payment provider.
 *
 * Explicitly OUT of scope for this module (per prompts-auth-04.md):
 * Payment, Webhook, actual Subscription activation, UI, Account Merge.
 * `checkoutSessionCreator` is therefore expected to be a PLACEHOLDER in
 * this phase (see subscription-checkout-handler.js's default) — no real
 * payment provider is called here.
 */

// Node/tests: `require` is available. Browser: no `require()` exists, so
// auth-service.js must be loaded via its own <script> tag BEFORE this file
// (registers `window.AuthService`). Mirrors the same pattern used by
// email-otp-service.js / subscription-entry-guard.js.
const authServiceDefault = (function loadDefaultAuthService() {
  if (typeof module !== "undefined" && module.exports) {
    return require("../auth/auth-service");
  }

  if (typeof window !== "undefined" && window.AuthService) {
    return window.AuthService;
  }

  return null;
})();

function errorDto(code, message, details = null) {
  return {
    ok: false,
    error: {
      code: String(code),
      message: String(message),
      details: details || null
    }
  };
}

// Classifies WHY a non-Official user is being rejected, so the Edge
// Function can return the precise Spec-mandated error code/HTTP status
// instead of one blanket "forbidden".
function classifyAuthorizationFailure(authState) {
  if (!authState.hasSession || !authState.jwtValid) {
    return { code: "UNAUTHORIZED", message: "Authentication required." };
  }

  if (authState.isAnonymous) {
    return { code: "ACCOUNT_UPGRADE_REQUIRED", message: "Anonymous users must upgrade to an Official User before subscribing." };
  }

  if (!authState.emailVerified && !authState.googleVerified) {
    return { code: "IDENTITY_NOT_VERIFIED", message: "At least one verified identity (email or Google) is required before subscribing." };
  }

  // Falls through only if isOfficialUser() is false for some OTHER reason
  // (e.g. a future Status=Active check) not covered above.
  return { code: "FORBIDDEN", message: "Not authorized to create a checkout session." };
}

function createCheckoutAuthorizationService({
  authService = authServiceDefault,
  subscriptionRepository,
  checkoutSessionCreator
} = {}) {
  if (!authService || typeof authService.resolveAuthState !== "function") {
    throw new Error("createCheckoutAuthorizationService requires authService.resolveAuthState(...).");
  }

  if (!subscriptionRepository || typeof subscriptionRepository.findActiveSubscription !== "function") {
    throw new Error("createCheckoutAuthorizationService requires subscriptionRepository.findActiveSubscription(userId).");
  }

  if (!checkoutSessionCreator || typeof checkoutSessionCreator.createCheckoutSession !== "function") {
    throw new Error("createCheckoutAuthorizationService requires checkoutSessionCreator.createCheckoutSession(...).");
  }

  async function authorizeCheckout({ session, user, planId } = {}) {
    const authState = authService.resolveAuthState({ session, user });

    if (!authState.isOfficialUser) {
      const failure = classifyAuthorizationFailure(authState);
      return errorDto(failure.code, failure.message, { userType: authState.userType });
    }

    const userId = String(user?.id || "").trim();
    if (!userId) {
      return errorDto("UNAUTHORIZED", "Authentication required.");
    }

    // Case 4: never create a duplicate Checkout/Subscription — return the
    // existing one as-is.
    let existingSubscription;
    try {
      existingSubscription = await subscriptionRepository.findActiveSubscription(userId);
    } catch (error) {
      return errorDto("SUBSCRIPTION_LOOKUP_FAILED", error?.message || "Failed to look up existing subscription.");
    }

    if (existingSubscription) {
      return {
        ok: true,
        data: {
          created: false,
          subscription: existingSubscription
        }
      };
    }

    // Case 5: Official User with no existing subscription -> create.
    let checkoutSession;
    try {
      checkoutSession = await checkoutSessionCreator.createCheckoutSession({ userId, planId });
    } catch (error) {
      return errorDto("CHECKOUT_CREATION_FAILED", error?.message || "Failed to create checkout session.");
    }

    return {
      ok: true,
      data: {
        created: true,
        checkoutSession
      }
    };
  }

  return { authorizeCheckout };
}

const checkoutAuthorizationServiceApi = {
  createCheckoutAuthorizationService,
  classifyAuthorizationFailure
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = checkoutAuthorizationServiceApi;
}

if (typeof window !== "undefined") {
  window.CheckoutAuthorizationService = checkoutAuthorizationServiceApi;
}
