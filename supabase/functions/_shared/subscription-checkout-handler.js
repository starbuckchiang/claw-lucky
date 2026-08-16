"use strict";

/**
 * Subscription Checkout — Shared Request Handler (Node.js / CommonJS)
 *
 * Mirrors wallpaper-generate-handler.js's convention: this file is the
 * Node.js-testable source of truth (`require()`-able from `node --test`);
 * the Supabase Edge Runtime (Deno, strict ESM) instead loads
 * `subscription-checkout-handler.ts`, a line-for-line ESM twin. Whenever
 * business logic changes here, mirror the change in the `.ts` twin (same
 * function names, same error codes, same HTTP status mapping).
 *
 * Implements specs/003-spec-auth-subscription.md Section 11 end-to-end at
 * the HTTP boundary: request shape validation -> Checkout Authorization
 * Service (P-AUTH-04, reusing P-AUTH-01/02/03's Auth Service — no Auth
 * logic is duplicated here) -> HTTP status mapping.
 *
 * PLACEHOLDERS (explicitly out of scope for P-AUTH-04, see
 * prompts-auth-04.md): no `subscriptions` table exists yet ("不修改
 * Database Schema"), and no real payment provider is wired ("不實作
 * Payment"). `createPlaceholderSubscriptionRepository` /
 * `createPlaceholderCheckoutSessionCreator` below are deliberately inert
 * stand-ins, clearly marked, so the Authorization flow itself (the actual
 * deliverable of this phase) can still be exercised end-to-end. Replace
 * both once the real schema/payment provider exist (tracked for P-AUTH-05).
 */

const { createCheckoutAuthorizationService } = require("../../../js/services/subscription/checkout-authorization-service.js");

const ERROR_HTTP_STATUS = Object.freeze({
  UNAUTHORIZED: 401,
  ACCOUNT_UPGRADE_REQUIRED: 403,
  IDENTITY_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  INVALID_REQUEST: 400,
  SUBSCRIPTION_LOOKUP_FAILED: 503,
  CHECKOUT_CREATION_FAILED: 502
});

function toHttpStatus(code) {
  return ERROR_HTTP_STATUS[code] || 500;
}

const REQUIRED_FIELDS = ["planId"];

// Client MUST NOT be able to control identity or secrets. Reject the
// request outright if present (mirrors wallpaper-generate-handler.js).
const FORBIDDEN_FIELDS = ["userId", "apiKey", "apiKeys", "serviceRoleKey", "service_role_key"];

function validateRequestShape(body) {
  const errors = [];

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

// PLACEHOLDER (P-AUTH-04): always reports "no active subscription" so Case
// 4 (dedupe) can never spuriously trigger — every Official User request
// proceeds to Case 5 (create). Replace with a real Supabase-backed
// repository once a `subscriptions` table migration lands.
function createPlaceholderSubscriptionRepository() {
  return {
    async findActiveSubscription(_userId) {
      return null;
    }
  };
}

// PLACEHOLDER (P-AUTH-04): returns a deterministic, clearly-marked stub
// instead of calling any real payment API. Replace once a Payment provider
// exists (own ADR/implementation phase).
function createPlaceholderCheckoutSessionCreator() {
  return {
    async createCheckoutSession({ userId, planId }) {
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

function buildCheckoutAuthorizationService(deps = {}) {
  return createCheckoutAuthorizationService({
    authService: deps.authService,
    subscriptionRepository: deps.subscriptionRepository || createPlaceholderSubscriptionRepository(),
    checkoutSessionCreator: deps.checkoutSessionCreator || createPlaceholderCheckoutSessionCreator()
  });
}

/**
 * @param {object} params
 * @param {object} params.body - parsed JSON request body (`{ planId }`)
 * @param {object|null} params.session - Supabase session-like shape
 *   (`{ user, access_token, expires_at }`), or null if unauthenticated.
 *   NEVER derived from the request body.
 * @param {object|null} params.user - Supabase auth user object
 *   (`is_anonymous`/`email_confirmed_at`/`identities`), or null.
 * @param {string} params.correlationId - single correlation id for the flow
 * @param {object} params.deps - either `{ service }` (tests) or the raw
 *   dependencies accepted by `buildCheckoutAuthorizationService` (real wiring).
 */
async function handleCheckoutRequest({ body, session, user, correlationId, deps = {} }) {
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

  let result;
  try {
    result = await service.authorizeCheckout({ session, user, planId: body.planId });
  } catch (error) {
    // Defensive: the service is designed to always return a normalized
    // `{ ok: false, error }` result rather than throw, but the Edge
    // Function boundary must never leak a raw exception either way.
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

  // Case 4 (existing subscription returned) -> 200; Case 5 (newly created)
  // -> 201.
  return {
    statusCode: result.data.created ? 201 : 200,
    correlationId,
    body: result
  };
}

module.exports = {
  handleCheckoutRequest,
  buildCheckoutAuthorizationService,
  createPlaceholderSubscriptionRepository,
  createPlaceholderCheckoutSessionCreator,
  validateRequestShape,
  toHttpStatus
};
