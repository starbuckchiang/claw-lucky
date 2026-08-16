// ESM port of `js/services/subscription/checkout-authorization-service.js`.
// Logic unchanged. See the original file's header for the full P-AUTH-04
// design rationale (Section 11 Cases 1-5, DI-based, no I/O of its own).

import { resolveAuthState } from "./auth-service.ts";

// deno-lint-ignore no-explicit-any
type AnyObj = any;

function errorDto(code: string, message: string, details: AnyObj = null) {
  return {
    ok: false,
    error: {
      code: String(code),
      message: String(message),
      details: details || null
    }
  };
}

function classifyAuthorizationFailure(authState: AnyObj) {
  if (!authState.hasSession || !authState.jwtValid) {
    return { code: "UNAUTHORIZED", message: "Authentication required." };
  }

  if (authState.isAnonymous) {
    return { code: "ACCOUNT_UPGRADE_REQUIRED", message: "Anonymous users must upgrade to an Official User before subscribing." };
  }

  if (!authState.emailVerified && !authState.googleVerified) {
    return { code: "IDENTITY_NOT_VERIFIED", message: "At least one verified identity (email or Google) is required before subscribing." };
  }

  return { code: "FORBIDDEN", message: "Not authorized to create a checkout session." };
}

export function createCheckoutAuthorizationService({
  authService = { resolveAuthState },
  subscriptionRepository,
  checkoutSessionCreator
}: {
  // deno-lint-ignore no-explicit-any
  authService?: any;
  subscriptionRepository: {
    // deno-lint-ignore no-explicit-any
    findActiveSubscription(userId: string): Promise<any>;
  };
  checkoutSessionCreator: {
    // deno-lint-ignore no-explicit-any
    createCheckoutSession(input: any): Promise<any>;
  };
}) {
  if (!authService || typeof authService.resolveAuthState !== "function") {
    throw new Error("createCheckoutAuthorizationService requires authService.resolveAuthState(...).");
  }

  if (!subscriptionRepository || typeof subscriptionRepository.findActiveSubscription !== "function") {
    throw new Error("createCheckoutAuthorizationService requires subscriptionRepository.findActiveSubscription(userId).");
  }

  if (!checkoutSessionCreator || typeof checkoutSessionCreator.createCheckoutSession !== "function") {
    throw new Error("createCheckoutAuthorizationService requires checkoutSessionCreator.createCheckoutSession(...).");
  }

  async function authorizeCheckout({ session, user, planId }: { session: AnyObj; user: AnyObj; planId?: string }) {
    const authState = authService.resolveAuthState({ session, user });

    if (!authState.isOfficialUser) {
      const failure = classifyAuthorizationFailure(authState);
      return errorDto(failure.code, failure.message, { userType: authState.userType });
    }

    const userId = String(user?.id || "").trim();
    if (!userId) {
      return errorDto("UNAUTHORIZED", "Authentication required.");
    }

    // deno-lint-ignore no-explicit-any
    let existingSubscription: any;
    try {
      existingSubscription = await subscriptionRepository.findActiveSubscription(userId);
    } catch (error) {
      return errorDto("SUBSCRIPTION_LOOKUP_FAILED", (error as Error)?.message || "Failed to look up existing subscription.");
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

    // deno-lint-ignore no-explicit-any
    let checkoutSession: any;
    try {
      checkoutSession = await checkoutSessionCreator.createCheckoutSession({ userId, planId });
    } catch (error) {
      return errorDto("CHECKOUT_CREATION_FAILED", (error as Error)?.message || "Failed to create checkout session.");
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

export { classifyAuthorizationFailure };
