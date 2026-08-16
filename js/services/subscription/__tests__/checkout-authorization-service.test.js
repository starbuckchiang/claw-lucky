"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createCheckoutAuthorizationService } = require("../checkout-authorization-service");

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

function createSubscriptionRepositoryMock({ existingSubscription = null, throwsError = null } = {}) {
  return {
    async findActiveSubscription(_userId) {
      if (throwsError) throw throwsError;
      return existingSubscription;
    }
  };
}

function createCheckoutSessionCreatorMock({ result = { id: "checkout-1", status: "pending_payment_provider" }, throwsError = null } = {}) {
  return {
    async createCheckoutSession(_input) {
      if (throwsError) throw throwsError;
      return result;
    }
  };
}

function createService(overrides = {}) {
  return createCheckoutAuthorizationService({
    subscriptionRepository: createSubscriptionRepositoryMock(),
    checkoutSessionCreator: createCheckoutSessionCreatorMock(),
    ...overrides
  });
}

test("constructor requires subscriptionRepository/checkoutSessionCreator", () => {
  assert.throws(() => createCheckoutAuthorizationService({}));
  assert.throws(() => createCheckoutAuthorizationService({ subscriptionRepository: createSubscriptionRepositoryMock() }));
  assert.throws(() => createCheckoutAuthorizationService({ checkoutSessionCreator: createCheckoutSessionCreatorMock() }));
});

test("Case 1: no session/JWT -> UNAUTHORIZED", async () => {
  const service = createService();

  const result = await service.authorizeCheckout({ session: null, user: null, planId: "pro-monthly" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNAUTHORIZED");
});

test("Case 2: Anonymous User -> ACCOUNT_UPGRADE_REQUIRED", async () => {
  const user = anonymousUser();
  const service = createService();

  const result = await service.authorizeCheckout({ session: sessionFor(user), user, planId: "pro-monthly" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ACCOUNT_UPGRADE_REQUIRED");
});

test("Case 3: Identity 未驗證 (no email, no Google) -> IDENTITY_NOT_VERIFIED", async () => {
  const user = officialUser({ email_confirmed_at: null, identities: [] });
  const service = createService();

  const result = await service.authorizeCheckout({ session: sessionFor(user), user, planId: "pro-monthly" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "IDENTITY_NOT_VERIFIED");
});

test("Case 4: already has an active subscription -> returns the EXISTING subscription, never creates a new one", async () => {
  const user = officialUser();
  const existingSubscription = { id: "sub-1", planId: "pro-monthly", status: "active" };
  let createCheckoutSessionCalls = 0;
  const checkoutSessionCreator = {
    async createCheckoutSession() {
      createCheckoutSessionCalls += 1;
      return { id: "should-not-be-called" };
    }
  };

  const service = createCheckoutAuthorizationService({
    subscriptionRepository: createSubscriptionRepositoryMock({ existingSubscription }),
    checkoutSessionCreator
  });

  const result = await service.authorizeCheckout({ session: sessionFor(user), user, planId: "pro-monthly" });

  assert.equal(result.ok, true);
  assert.equal(result.data.created, false);
  assert.deepEqual(result.data.subscription, existingSubscription);
  assert.equal(createCheckoutSessionCalls, 0);
});

test("Case 5: Official User with no existing subscription -> creates a checkout session", async () => {
  const user = officialUser();
  const service = createService();

  const result = await service.authorizeCheckout({ session: sessionFor(user), user, planId: "pro-monthly" });

  assert.equal(result.ok, true);
  assert.equal(result.data.created, true);
  assert.equal(result.data.checkoutSession.id, "checkout-1");
});

test("Official User via Email-only identity (P-AUTH-03.1 OR rule) -> still allowed to checkout", async () => {
  const user = officialUser({ identities: [] });
  const service = createService();

  const result = await service.authorizeCheckout({ session: sessionFor(user), user, planId: "pro-monthly" });

  assert.equal(result.ok, true);
  assert.equal(result.data.created, true);
});

test("subscriptionRepository failure is normalized as SUBSCRIPTION_LOOKUP_FAILED", async () => {
  const user = officialUser();
  const service = createCheckoutAuthorizationService({
    subscriptionRepository: createSubscriptionRepositoryMock({ throwsError: new Error("db down") }),
    checkoutSessionCreator: createCheckoutSessionCreatorMock()
  });

  const result = await service.authorizeCheckout({ session: sessionFor(user), user, planId: "pro-monthly" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "SUBSCRIPTION_LOOKUP_FAILED");
});

test("checkoutSessionCreator failure is normalized as CHECKOUT_CREATION_FAILED", async () => {
  const user = officialUser();
  const service = createCheckoutAuthorizationService({
    subscriptionRepository: createSubscriptionRepositoryMock(),
    checkoutSessionCreator: createCheckoutSessionCreatorMock({ throwsError: new Error("provider down") })
  });

  const result = await service.authorizeCheckout({ session: sessionFor(user), user, planId: "pro-monthly" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CHECKOUT_CREATION_FAILED");
});
