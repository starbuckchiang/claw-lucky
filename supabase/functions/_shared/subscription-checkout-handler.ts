// ESM twin of `subscription-checkout-handler.js`. Logic unchanged — see
// that file's header for the full rationale (Section 11 Cases 1-5,
// PLACEHOLDER repository/checkout-session-creator explicitly out of scope
// for P-AUTH-04). Whenever business logic changes here, mirror the change
// in the `.js` twin (same function names, same error codes, same HTTP
// status mapping).

import { createCheckoutAuthorizationService } from "./lib/checkout-authorization-service.ts";

const ERROR_HTTP_STATUS: Record<string, number> = Object.freeze({
  UNAUTHORIZED: 401,
  ACCOUNT_UPGRADE_REQUIRED: 403,
  IDENTITY_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  INVALID_REQUEST: 400,
  SUBSCRIPTION_LOOKUP_FAILED: 503,
  CHECKOUT_CREATION_FAILED: 502
});

export function toHttpStatus(code: string): number {
  return ERROR_HTTP_STATUS[code] || 500;
}

const REQUIRED_FIELDS = ["planId"];
const FORBIDDEN_FIELDS = ["userId", "apiKey", "apiKeys", "serviceRoleKey", "service_role_key"];

// deno-lint-ignore no-explicit-any
export function validateRequestShape(body: any): string[] {
  const errors: string[] = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ["Request body must be a JSON object."];
  }

  for (const field of REQUIRED_FIELDS) {
    if (typeof body[field] !== "string" || !body[field].trim()) {
      errors.push(`${field} is required.`);
    }
  }

  for (const field of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      errors.push(`${field} is not allowed in the request body.`);
    }
  }

  return errors;
}

// PLACEHOLDER (P-AUTH-04): see subscription-checkout-handler.js for the
// full rationale. Always reports "no active subscription".
export function createPlaceholderSubscriptionRepository() {
  return {
    // deno-lint-ignore no-explicit-any require-await
    async findActiveSubscription(_userId: string): Promise<any> {
      return null;
    }
  };
}

// PLACEHOLDER (P-AUTH-04): see subscription-checkout-handler.js for the
// full rationale. Returns a deterministic, clearly-marked stub.
export function createPlaceholderCheckoutSessionCreator() {
  return {
    // deno-lint-ignore require-await
    async createCheckoutSession({ userId, planId }: { userId: string; planId?: string }) {
      return {
        id: `pending_${userId}_${planId}`,
        userId,
        planId,
        status: "pending_payment_provider",
        createdAt: new Date().toISOString()
      };
    }
  };
}

// deno-lint-ignore no-explicit-any
export function buildCheckoutAuthorizationService(deps: any = {}) {
  return createCheckoutAuthorizationService({
    authService: deps.authService,
    subscriptionRepository: deps.subscriptionRepository || createPlaceholderSubscriptionRepository(),
    checkoutSessionCreator: deps.checkoutSessionCreator || createPlaceholderCheckoutSessionCreator()
  });
}

export async function handleCheckoutRequest({
  body,
  session,
  user,
  correlationId,
  deps = {}
}: {
  // deno-lint-ignore no-explicit-any
  body: any;
  // deno-lint-ignore no-explicit-any
  session: any;
  // deno-lint-ignore no-explicit-any
  user: any;
  correlationId: string;
  // deno-lint-ignore no-explicit-any
  deps?: any;
}) {
  const validationErrors = validateRequestShape(body);
  if (validationErrors.length > 0) {
    return {
      statusCode: 400,
      correlationId,
      body: {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Request validation failed.",
          details: { errors: validationErrors }
        }
      }
    };
  }

  const service = deps.service || buildCheckoutAuthorizationService(deps);

  // deno-lint-ignore no-explicit-any
  let result: any;
  try {
    result = await service.authorizeCheckout({ session, user, planId: body.planId });
  } catch (_error) {
    return {
      statusCode: 500,
      correlationId,
      body: {
        ok: false,
        error: {
          code: "CHECKOUT_CREATION_FAILED",
          message: "Unexpected checkout failure.",
          details: null
        }
      }
    };
  }

  if (!result.ok) {
    return {
      statusCode: toHttpStatus(result.error.code),
      correlationId,
      body: result
    };
  }

  return {
    statusCode: result.data.created ? 201 : 200,
    correlationId,
    body: result
  };
}
