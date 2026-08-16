"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handleCheckoutRequest,
  buildCheckoutAuthorizationService,
  createPlaceholderSubscriptionRepository,
  createPlaceholderCheckoutSessionCreator,
  validateRequestShape,
  toHttpStatus
} = require("../subscription-checkout-handler");

function futureExpiry() {
  return Math.floor(Date.now() / 1000) + 3600;
}

function officialUser(overrides = {}) {
  return {
    id: "user-official-1",
    is_anonymous: false,
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
    identities: [{ provider: "google" }],
    ...overrides
  };
}

function anonymousUser() {
  return { id: "user-anon-1", is_anonymous: true };
}

function sessionFor(user) {
  return { user, access_token: "token", expires_at: futureExpiry() };
}

function fakeServiceResult(result) {
  return { service: { async authorizeCheckout() { return result; } } };
}

test("Edge handler: invalid request when planId missing", async () => {
  const result = await handleCheckoutRequest({ body: {}, session: null, user: null, correlationId: "corr-1", deps: {} });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, "INVALID_REQUEST");
});

test("Edge handler: rejects client-supplied userId in body", async () => {
  const result = await handleCheckoutRequest({
    body: { planId: "pro-monthly", userId: "attacker-controlled" },
    session: null,
    user: null,
    correlationId: "corr-1",
    deps: {}
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, "INVALID_REQUEST");
});

test("Edge handler: no JWT -> 401 UNAUTHORIZED", async () => {
  const result = await handleCheckoutRequest({
    body: { planId: "pro-monthly" },
    session: null,
    user: null,
    correlationId: "corr-1",
    deps: fakeServiceResult({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required.", details: null } })
  });

  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error.code, "UNAUTHORIZED");
});

test("Edge handler: Anonymous User -> 403 ACCOUNT_UPGRADE_REQUIRED", async () => {
  const result = await handleCheckoutRequest({
    body: { planId: "pro-monthly" },
    session: sessionFor(anonymousUser()),
    user: anonymousUser(),
    correlationId: "corr-1",
    deps: fakeServiceResult({ ok: false, error: { code: "ACCOUNT_UPGRADE_REQUIRED", message: "upgrade required", details: null } })
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, "ACCOUNT_UPGRADE_REQUIRED");
});

test("Edge handler: Identity 未驗證 -> 403 IDENTITY_NOT_VERIFIED", async () => {
  const result = await handleCheckoutRequest({
    body: { planId: "pro-monthly" },
    session: sessionFor(officialUser()),
    user: officialUser(),
    correlationId: "corr-1",
    deps: fakeServiceResult({ ok: false, error: { code: "IDENTITY_NOT_VERIFIED", message: "identity not verified", details: null } })
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, "IDENTITY_NOT_VERIFIED");
});

test("Edge handler: already subscribed -> 200 with the existing subscription (never a new one)", async () => {
  const result = await handleCheckoutRequest({
    body: { planId: "pro-monthly" },
    session: sessionFor(officialUser()),
    user: officialUser(),
    correlationId: "corr-1",
    deps: fakeServiceResult({ ok: true, data: { created: false, subscription: { id: "sub-1" } } })
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.data.created, false);
});

test("Edge handler: Official User, no existing subscription -> 201 with a new checkout session", async () => {
  const result = await handleCheckoutRequest({
    body: { planId: "pro-monthly" },
    session: sessionFor(officialUser()),
    user: officialUser(),
    correlationId: "corr-1",
    deps: fakeServiceResult({ ok: true, data: { created: true, checkoutSession: { id: "checkout-1" } } })
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.data.created, true);
});

test("Edge handler: correlationId is echoed back regardless of outcome", async () => {
  const success = await handleCheckoutRequest({
    body: { planId: "pro-monthly" },
    session: sessionFor(officialUser()),
    user: officialUser(),
    correlationId: "corr-xyz",
    deps: fakeServiceResult({ ok: true, data: { created: true, checkoutSession: { id: "checkout-1" } } })
  });
  const failure = await handleCheckoutRequest({
    body: {},
    session: null,
    user: null,
    correlationId: "corr-xyz",
    deps: {}
  });

  assert.equal(success.correlationId, "corr-xyz");
  assert.equal(failure.correlationId, "corr-xyz");
});

test("Real wiring: buildCheckoutAuthorizationService() with placeholder repositories -> Official User always reaches checkout creation (Case 4 never spuriously triggers)", async () => {
  const result = await handleCheckoutRequest({
    body: { planId: "pro-monthly" },
    session: sessionFor(officialUser()),
    user: officialUser(),
    correlationId: "corr-real-1",
    deps: {}
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.data.created, true);
  assert.match(result.body.data.checkoutSession.id, /^pending_/);
  assert.equal(result.body.data.checkoutSession.status, "pending_payment_provider");
});

test("Real wiring: unauthenticated request against the real service -> 401", async () => {
  const result = await handleCheckoutRequest({
    body: { planId: "pro-monthly" },
    session: null,
    user: null,
    correlationId: "corr-real-2",
    deps: {}
  });

  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error.code, "UNAUTHORIZED");
});

test("validateRequestShape / toHttpStatus helpers", () => {
  assert.deepEqual(validateRequestShape(null), ["Request body must be a JSON object."]);
  assert.deepEqual(validateRequestShape({}), ["planId is required."]);
  assert.deepEqual(validateRequestShape({ planId: "pro-monthly" }), []);
  assert.equal(toHttpStatus("UNAUTHORIZED"), 401);
  assert.equal(toHttpStatus("SOMETHING_UNKNOWN"), 500);
});

test("placeholder factories: subscription repository always returns null, checkout creator returns a marked stub", async () => {
  const subscriptionRepository = createPlaceholderSubscriptionRepository();
  const checkoutSessionCreator = createPlaceholderCheckoutSessionCreator();

  assert.equal(await subscriptionRepository.findActiveSubscription("user-1"), null);

  const checkoutSession = await checkoutSessionCreator.createCheckoutSession({ userId: "user-1", planId: "pro-monthly" });
  assert.equal(checkoutSession.status, "pending_payment_provider");
  assert.equal(checkoutSession.userId, "user-1");
  assert.equal(checkoutSession.planId, "pro-monthly");
});
