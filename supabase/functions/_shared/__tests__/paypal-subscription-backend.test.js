"use strict";

/**
 * Auth-07C.4 PayPal Subscriptions backend tests (mock fetch only).
 * Covers prompt cases 1–19. Orders regression still lives in
 * paypal-checkout-webhook.test.js (must keep passing).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handlePaypalSubscriptionRequest,
  handleCreateSession,
  handleConfirmSubscription,
  handleGetStatus,
  handleCancelSubscription
} = require("../paypal-subscription-handler");
const {
  handlePaypalWebhookRequest,
  isSubscriptionEventType
} = require("../paypal-webhook-handler");
const {
  createPaypalClient,
  buildSanitizedPaypalErrorDetails
} = require("../lib/paypal-client");
const { resolveSubscriptionPlanAllowlist } = require("../lib/paypal-plans");

const PLAN_ENV = {
  PAYPAL_PLAN_ID_MONTHLY: "P-MONTHLY-ALLOW",
  PAYPAL_PLAN_ID_YEARLY: "P-YEARLY-ALLOW"
};

const MERCHANT = "MERCHANT123";

const SIG_HEADERS = {
  get(name) {
    const map = {
      "PAYPAL-AUTH-ALGO": "a",
      "PAYPAL-CERT-URL": "u",
      "PAYPAL-TRANSMISSION-ID": "i",
      "PAYPAL-TRANSMISSION-SIG": "s",
      "PAYPAL-TRANSMISSION-TIME": "t"
    };
    return map[name] || null;
  }
};

function officialUser(overrides = {}) {
  return {
    id: "user-1",
    is_anonymous: false,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    identities: [],
    ...overrides
  };
}

function cryptoId(prefix = "id") {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

function memorySubscriptionRepo(seed = {}) {
  const subscriptions = (seed.subscriptions || []).map((r) => ({ ...r }));
  const slots = { ...(seed.slots || {}) };
  const events = (seed.events || []).map((r) => ({ ...r }));
  const sales = new Set(seed.sales || []);
  const transactions = (seed.transactions || []).map((r) => ({ ...r }));

  function upsertEvent(row) {
    const idx = events.findIndex((e) => e.paypal_event_id === row.paypal_event_id);
    if (idx >= 0) {
      events[idx] = { ...events[idx], ...row };
      return events[idx];
    }
    events.push(row);
    return row;
  }

  return {
    subscriptions,
    slots,
    events,
    sales,
    transactions,

    async acquireSubscriptionSlot({ userId, planCode, paypalPlanId }) {
      const slot = slots[userId];
      if (slot && slot.slot_state === "OCCUPIED") {
        throw new Error("SUBSCRIPTION_SLOT_OCCUPIED");
      }
      const row = {
        id: cryptoId("sub"),
        user_id: userId,
        checkout_session_id: cryptoId("sess"),
        checkout_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        paypal_subscription_id: null,
        paypal_plan_id: paypalPlanId,
        plan_code: planCode,
        status: "APPROVAL_PENDING",
        currency: "USD",
        recurring_amount: planCode === "yearly" ? 48 : 5,
        paid_through: null,
        next_billing_time: null,
        cancelled_at: null,
        suspended_at: null,
        access_blocked_at: null,
        reconciliation_status: "none",
        created_at: new Date().toISOString()
      };
      subscriptions.push(row);
      slots[userId] = {
        slot_state: "OCCUPIED",
        checkout_session_id: row.checkout_session_id,
        subscription_id: row.id,
        release_after: null
      };
      return row;
    },

    async bindPaypalSubscription({ userId, checkoutSessionId, paypalSubscriptionId }) {
      const row = subscriptions.find((s) => s.checkout_session_id === checkoutSessionId);
      if (!row) throw new Error("CHECKOUT_SESSION_NOT_FOUND");
      if (row.user_id !== userId) throw new Error("CHECKOUT_SESSION_OWNER_MISMATCH");
      if (row.paypal_subscription_id && row.paypal_subscription_id === paypalSubscriptionId) {
        return row;
      }
      if (row.paypal_subscription_id && row.paypal_subscription_id !== paypalSubscriptionId) {
        throw new Error("PAYPAL_SUBSCRIPTION_ALREADY_BOUND");
      }
      const inUse = subscriptions.find(
        (s) => s.paypal_subscription_id === paypalSubscriptionId && s.id !== row.id
      );
      if (inUse) throw new Error("PAYPAL_SUBSCRIPTION_ID_IN_USE");
      row.paypal_subscription_id = paypalSubscriptionId;
      return row;
    },

    async ensureWebhookEventReceived(input) {
      const existing = events.find((e) => e.paypal_event_id === input.paypalEventId);
      if (existing) {
        return {
          outcome: "already_present",
          event_processing_status: existing.processing_status,
          error_code: existing.error_code || null
        };
      }
      events.push({
        paypal_event_id: input.paypalEventId,
        event_type: input.eventType,
        verification_status: "SUCCESS",
        processing_status: "received",
        paypal_subscription_id: input.paypalSubscriptionId || null,
        paypal_sale_id: input.paypalSaleId || null,
        payload: input.sanitizedPayload || {},
        error_code: null
      });
      return { outcome: "received", event_processing_status: "received", error_code: null };
    },

    async finalizeWebhookEventFailure(input) {
      upsertEvent({
        paypal_event_id: input.paypalEventId,
        event_type: input.eventType || "UNKNOWN",
        verification_status: "SUCCESS",
        processing_status: input.processingStatus || "failed",
        paypal_subscription_id: input.paypalSubscriptionId || null,
        paypal_sale_id: input.paypalSaleId || null,
        payload: input.sanitizedPayload || {},
        error_code: input.errorCode || null,
        merchant_validation_source: input.merchantValidationSource || null
      });
      return {
        outcome: "rejected",
        event_processing_status: input.processingStatus || "failed",
        error_code: input.errorCode || null
      };
    },

    async processSubscriptionWebhookEvent(input) {
      if (input.processingHint === "failed") {
        upsertEvent({
          paypal_event_id: input.paypalEventId,
          event_type: input.eventType,
          processing_status: "failed",
          paypal_subscription_id: input.paypalSubscriptionId,
          paypal_sale_id: input.paypalSaleId || null,
          payload: input.sanitizedPayload || {},
          error_code: (input.sanitizedPayload && input.sanitizedPayload.error_code) || "FAILED"
        });
        return {
          outcome: "rejected",
          event_processing_status: "failed",
          error_code: (input.sanitizedPayload && input.sanitizedPayload.error_code) || "FAILED"
        };
      }

      const existing = events.find((e) => e.paypal_event_id === input.paypalEventId);
      if (existing && existing.processing_status !== "received") {
        return { outcome: "duplicate", event_processing_status: "duplicate" };
      }

      const sub = subscriptions.find(
        (s) => s.paypal_subscription_id === input.paypalSubscriptionId
      );

      if (!sub) {
        upsertEvent({
          paypal_event_id: input.paypalEventId,
          event_type: input.eventType,
          processing_status: "pending_resolution",
          paypal_subscription_id: input.paypalSubscriptionId,
          paypal_sale_id: input.paypalSaleId,
          payload: input.sanitizedPayload || {},
          error_code: "SUBSCRIPTION_NOT_FOUND"
        });
        return {
          outcome: "pending_resolution",
          event_processing_status: "pending_resolution",
          error_code: "SUBSCRIPTION_NOT_FOUND"
        };
      }

      if (input.eventType === "PAYMENT.SALE.COMPLETED") {
        if (!input.paypalSaleId) {
          upsertEvent({
            paypal_event_id: input.paypalEventId,
            event_type: input.eventType,
            processing_status: "failed",
            paypal_subscription_id: input.paypalSubscriptionId,
            payload: input.sanitizedPayload || {},
            error_code: "MISSING_SALE_ID"
          });
          return { outcome: "rejected", error_code: "MISSING_SALE_ID" };
        }
        if (
          input.amount == null
          || Number(input.amount) !== Number(sub.recurring_amount)
          || String(input.currency || "").toUpperCase() !== sub.currency
        ) {
          upsertEvent({
            paypal_event_id: input.paypalEventId,
            event_type: input.eventType,
            processing_status: "failed",
            paypal_subscription_id: input.paypalSubscriptionId,
            paypal_sale_id: input.paypalSaleId,
            payload: input.sanitizedPayload || {},
            error_code: "AMOUNT_CURRENCY_MISMATCH"
          });
          return { outcome: "rejected", error_code: "AMOUNT_CURRENCY_MISMATCH" };
        }
        if (sales.has(input.paypalSaleId)) {
          upsertEvent({
            paypal_event_id: input.paypalEventId,
            event_type: input.eventType,
            processing_status: "duplicate",
            paypal_subscription_id: input.paypalSubscriptionId,
            paypal_sale_id: input.paypalSaleId,
            payload: input.sanitizedPayload || {}
          });
          return { outcome: "duplicate", event_processing_status: "duplicate" };
        }
        sales.add(input.paypalSaleId);
        transactions.push({
          paypal_sale_id: input.paypalSaleId,
          paypal_event_id: input.paypalEventId,
          audit_source: "paypal_webhook",
          amount: input.amount,
          currency: input.currency,
          sanitized_payload: input.sanitizedPayload || {}
        });
        if (input.nextBillingTime) {
          sub.paid_through = input.nextBillingTime;
          sub.next_billing_time = input.nextBillingTime;
          sub.status = ["APPROVAL_PENDING", "APPROVED"].includes(sub.status)
            ? "ACTIVE"
            : sub.status;
        } else {
          sub.reconciliation_status = "reconciliation_pending";
          sub.status = ["APPROVAL_PENDING", "APPROVED"].includes(sub.status)
            ? "ACTIVE"
            : sub.status;
        }
        upsertEvent({
          paypal_event_id: input.paypalEventId,
          event_type: input.eventType,
          processing_status: "processed",
          paypal_subscription_id: input.paypalSubscriptionId,
          paypal_sale_id: input.paypalSaleId,
          payload: input.sanitizedPayload || {},
          merchant_validation_source:
            (input.sanitizedPayload && input.sanitizedPayload.merchant_validation_source) || null,
          error_code: null
        });
        return {
          outcome: "processed",
          subscription_status: sub.status,
          event_processing_status: "processed"
        };
      }

      if (input.eventType === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") {
        upsertEvent({
          paypal_event_id: input.paypalEventId,
          event_type: input.eventType,
          processing_status: "processed",
          paypal_subscription_id: input.paypalSubscriptionId,
          payload: input.sanitizedPayload || {}
        });
        return {
          outcome: "processed",
          subscription_status: sub.status
        };
      }

      if (
        input.eventType === "PAYMENT.SALE.REFUNDED"
        || input.eventType === "PAYMENT.SALE.REVERSED"
      ) {
        if (input.isFullRefund || input.eventType === "PAYMENT.SALE.REVERSED") {
          sub.access_blocked_at = new Date().toISOString();
          sub.access_block_reason = input.eventType === "PAYMENT.SALE.REVERSED"
            ? "REVERSED"
            : "FULL_REFUND";
        }
        upsertEvent({
          paypal_event_id: input.paypalEventId,
          event_type: input.eventType,
          processing_status: "processed",
          paypal_subscription_id: input.paypalSubscriptionId,
          paypal_sale_id: input.paypalSaleId,
          payload: input.sanitizedPayload || {}
        });
        return {
          outcome: "processed",
          subscription_status: sub.status,
          error_code: input.eventType === "PAYMENT.SALE.REVERSED"
            ? "REVERSED"
            : "FULL_REFUND"
        };
      }

      if (input.targetStatus) {
        sub.status = input.targetStatus;
        if (input.targetStatus === "CANCELLED") {
          sub.cancelled_at = sub.cancelled_at || new Date().toISOString();
          const slot = slots[sub.user_id];
          if (slot && slot.slot_state === "OCCUPIED") {
            slot.release_after = sub.paid_through;
          }
        }
        if (input.targetStatus === "SUSPENDED") {
          sub.suspended_at = sub.suspended_at || new Date().toISOString();
        }
      }

      upsertEvent({
        paypal_event_id: input.paypalEventId,
        event_type: input.eventType,
        processing_status: "processed",
        paypal_subscription_id: input.paypalSubscriptionId,
        payload: input.sanitizedPayload || {}
      });
      return {
        outcome: "processed",
        subscription_status: sub.status
      };
    },

    async reconcilePaypalSubscriptionSale(input) {
      const sub = subscriptions.find(
        (s) => s.paypal_subscription_id === input.paypalSubscriptionId
      );
      if (!sub) {
        return { outcome: "rejected", error_code: "SUBSCRIPTION_NOT_FOUND" };
      }
      if (sub.user_id !== input.userId) {
        return {
          outcome: "rejected",
          subscription_id: sub.id,
          subscription_status: sub.status,
          paid_through: sub.paid_through,
          error_code: "OWNER_MISMATCH"
        };
      }
      if (
        input.amount == null
        || Number(input.amount) !== Number(sub.recurring_amount)
        || String(input.currency || "").toUpperCase() !== sub.currency
      ) {
        return {
          outcome: "rejected",
          error_code: "AMOUNT_CURRENCY_MISMATCH",
          paid_through: sub.paid_through
        };
      }
      if (sales.has(input.paypalSaleId)) {
        return {
          outcome: "duplicate",
          subscription_status: sub.status,
          paid_through: sub.paid_through,
          error_code: null
        };
      }
      sales.add(input.paypalSaleId);
      transactions.push({
        paypal_sale_id: input.paypalSaleId,
        paypal_event_id: `paypal_api_reconciliation:${input.paypalSaleId}`,
        audit_source: "paypal_api_reconciliation",
        reconciled_at: new Date().toISOString(),
        amount: input.amount,
        currency: input.currency,
        sanitized_payload: input.sanitizedAudit || { source: "paypal_api_reconciliation" }
      });
      if (input.nextBillingTime) {
        sub.paid_through = input.nextBillingTime;
        sub.next_billing_time = input.nextBillingTime;
        sub.reconciliation_status = "resolved";
        sub.status = ["APPROVAL_PENDING", "APPROVED"].includes(sub.status)
          ? "ACTIVE"
          : sub.status;
      } else {
        sub.reconciliation_status = "reconciliation_pending";
      }
      return {
        outcome: "processed",
        subscription_status: sub.status,
        paid_through: sub.paid_through,
        error_code: null
      };
    },

    async findLatestByUserId(userId) {
      const rows = subscriptions
        .filter((s) => s.user_id === userId)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return rows[0] || null;
    },

    async findByCheckoutSessionId(checkoutSessionId) {
      return subscriptions.find((s) => s.checkout_session_id === checkoutSessionId) || null;
    },

    async releaseSubscriptionSlotIfDue() {},

    async listPendingResolutionEvents(paypalSubscriptionId) {
      return events.filter(
        (e) =>
          e.paypal_subscription_id === paypalSubscriptionId
          && e.processing_status === "pending_resolution"
      );
    },

    async deleteWebhookEvent(paypalEventId) {
      const idx = events.findIndex(
        (e) =>
          e.paypal_event_id === paypalEventId
          && e.processing_status === "pending_resolution"
      );
      if (idx >= 0) events.splice(idx, 1);
    }
  };
}

function mockPaypalClient({
  subscription = null,
  cancelOk = true,
  transactions = null
} = {}) {
  const state = {
    subscription: subscription
      ? { ...subscription }
      : null,
    transactions
  };
  return {
    state,
    async getSubscription({ subscriptionId }) {
      if (!state.subscription || state.subscription.id !== subscriptionId) {
        const err = new Error("PAYPAL_GET_SUBSCRIPTION_FAILED");
        err.code = "PAYPAL_GET_SUBSCRIPTION_FAILED";
        err.details = buildSanitizedPaypalErrorDetails({
          stage: "get_subscription",
          status: 404,
          bodyOmitted: false,
          paypalJson: { name: "RESOURCE_NOT_FOUND" }
        });
        throw err;
      }
      return { ...state.subscription };
    },
    async getSubscriptionTransactions({ subscriptionId }) {
      if (!state.subscription || state.subscription.id !== subscriptionId) {
        const err = new Error("PAYPAL_GET_SUBSCRIPTION_TRANSACTIONS_FAILED");
        err.code = "PAYPAL_GET_SUBSCRIPTION_TRANSACTIONS_FAILED";
        throw err;
      }
      if (Array.isArray(state.transactions)) {
        return { transactions: state.transactions.map((t) => ({ ...t })) };
      }
      return { transactions: [] };
    },
    async cancelSubscription({ subscriptionId }) {
      if (!cancelOk) {
        const err = new Error("PAYPAL_CANCEL_SUBSCRIPTION_FAILED");
        err.code = "PAYPAL_CANCEL_SUBSCRIPTION_FAILED";
        err.details = buildSanitizedPaypalErrorDetails({
          stage: "cancel_subscription",
          status: 500,
          bodyOmitted: true,
          contentType: "text/plain",
          message: "upstream html"
        });
        throw err;
      }
      if (state.subscription && state.subscription.id === subscriptionId) {
        state.subscription.status = "CANCELLED";
      }
      return { ok: true, status: 204 };
    },
    async verifyWebhookSignature({ rawBody }) {
      return { verification_status: "SUCCESS", webhookEvent: JSON.parse(rawBody) };
    }
  };
}

function webhookRepoFrom(repo) {
  return {
    processWebhookEvent: async () => {
      throw new Error("Orders path must not run for SALE");
    },
    ensureWebhookEventReceived: repo.ensureWebhookEventReceived.bind(repo),
    finalizeWebhookEventFailure: repo.finalizeWebhookEventFailure.bind(repo),
    processSubscriptionWebhookEvent: repo.processSubscriptionWebhookEvent.bind(repo)
  };
}

function baseDeps(overrides = {}) {
  return {
    planEnv: PLAN_ENV,
    paypalMerchantId: MERCHANT,
    subscriptionRepository: memorySubscriptionRepo(),
    paypalClient: mockPaypalClient(),
    ...overrides
  };
}

function saleCompletedEvent(overrides = {}) {
  const resource = {
    id: overrides.saleId || "SALE-1",
    billing_agreement_id: overrides.subscriptionId || "I-SUB-1",
    amount: {
      total: overrides.amount || "5.00",
      currency: overrides.currency || "USD"
    },
    create_time: overrides.createTime || "2026-09-01T00:00:00Z",
    ...overrides.resource
  };
  if (overrides.omitMerchant) {
    // intentionally no payee.merchant_id
  } else if (overrides.merchantId === null) {
    resource.payee = {};
  } else {
    resource.payee = { merchant_id: overrides.merchantId || MERCHANT };
  }
  return {
    id: overrides.id || "WH-SALE-1",
    event_type: "PAYMENT.SALE.COMPLETED",
    resource
  };
}

// --- 1. JWT / anonymous / identity ---

test("1a: JWT missing -> AUTH_REQUIRED", async () => {
  const result = await handleCreateSession({
    body: { plan_code: "monthly" },
    user: null,
    deps: baseDeps()
  });
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error.code, "AUTH_REQUIRED");
});

test("1b: anonymous -> ACCOUNT_UPGRADE_REQUIRED", async () => {
  const result = await handleCreateSession({
    body: { plan_code: "monthly" },
    user: officialUser({ is_anonymous: true, email_confirmed_at: null }),
    deps: baseDeps()
  });
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, "ACCOUNT_UPGRADE_REQUIRED");
});

test("1c: identity not verified -> IDENTITY_NOT_VERIFIED", async () => {
  const result = await handleCreateSession({
    body: { plan_code: "monthly" },
    user: officialUser({ email_confirmed_at: null, identities: [] }),
    deps: baseDeps()
  });
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, "IDENTITY_NOT_VERIFIED");
});

test("1d: google identity alone is enough", async () => {
  const result = await handleCreateSession({
    body: { plan_code: "monthly" },
    user: officialUser({
      email_confirmed_at: null,
      identities: [{ provider: "google" }]
    }),
    deps: baseDeps()
  });
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.ok, true);
});

// --- 2. monthly/yearly whitelist ---

test("2: monthly/yearly server whitelist amounts and plan_id", async () => {
  const monthly = await handleCreateSession({
    body: { plan_code: "monthly" },
    user: officialUser(),
    deps: baseDeps()
  });
  assert.equal(monthly.statusCode, 201);
  assert.equal(monthly.body.plan_code, "monthly");
  assert.equal(monthly.body.amount, "5.00");
  assert.equal(monthly.body.currency, "USD");
  assert.equal(monthly.body.plan_id, "P-MONTHLY-ALLOW");
  assert.ok(monthly.body.checkout_session_id);

  const yearly = await handleCreateSession({
    body: { plan_code: "yearly" },
    user: officialUser({ id: "user-2" }),
    deps: baseDeps()
  });
  assert.equal(yearly.body.plan_code, "yearly");
  assert.equal(yearly.body.amount, "48.00");
  assert.equal(yearly.body.plan_id, "P-YEARLY-ALLOW");
});

// --- 3. forged plan_code / plan_id ---

test("3a: forged plan_code rejected", async () => {
  const result = await handleCreateSession({
    body: { plan_code: "lifetime", plan_id: "P-FAKE" },
    user: officialUser(),
    deps: baseDeps()
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, "INVALID_PLAN");
});

test("3b: body plan_id ignored — server whitelist wins", async () => {
  const result = await handleCreateSession({
    body: { plan_code: "monthly", plan_id: "P-ATTACKER" },
    user: officialUser(),
    deps: baseDeps()
  });
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.plan_id, "P-MONTHLY-ALLOW");
  assert.notEqual(result.body.plan_id, "P-ATTACKER");
});

// --- 4. duplicate create session ---

test("4: duplicate create session for same user rejected", async () => {
  const repo = memorySubscriptionRepo();
  const deps = baseDeps({ subscriptionRepository: repo });
  const first = await handleCreateSession({
    body: { plan_code: "monthly" },
    user: officialUser(),
    deps
  });
  assert.equal(first.statusCode, 201);
  const second = await handleCreateSession({
    body: { plan_code: "monthly" },
    user: officialUser(),
    deps
  });
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.error.code, "SUBSCRIPTION_SLOT_OCCUPIED");
});

// --- 5–8 confirm ---

test("5: custom_id mismatch", async () => {
  const repo = memorySubscriptionRepo();
  const created = await repo.acquireSubscriptionSlot({
    userId: "user-1",
    planCode: "monthly",
    paypalPlanId: "P-MONTHLY-ALLOW"
  });
  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      status: "APPROVED",
      plan_id: "P-MONTHLY-ALLOW",
      custom_id: "WRONG-SESSION"
    }
  });
  const result = await handleConfirmSubscription({
    body: {
      subscriptionID: "I-SUB-1",
      checkout_session_id: created.checkout_session_id
    },
    user: officialUser(),
    deps: baseDeps({ subscriptionRepository: repo, paypalClient })
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, "CUSTOM_ID_MISMATCH");
});

test("6: subscription session belongs to another user", async () => {
  const repo = memorySubscriptionRepo();
  const created = await repo.acquireSubscriptionSlot({
    userId: "user-owner",
    planCode: "monthly",
    paypalPlanId: "P-MONTHLY-ALLOW"
  });
  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      status: "APPROVED",
      plan_id: "P-MONTHLY-ALLOW",
      custom_id: created.checkout_session_id
    }
  });
  const result = await handleConfirmSubscription({
    body: {
      subscriptionID: "I-SUB-1",
      checkout_session_id: created.checkout_session_id
    },
    user: officialUser({ id: "user-attacker" }),
    deps: baseDeps({ subscriptionRepository: repo, paypalClient })
  });
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, "CHECKOUT_SESSION_OWNER_MISMATCH");
});

test("7: duplicate confirm is idempotent", async () => {
  const repo = memorySubscriptionRepo();
  const created = await repo.acquireSubscriptionSlot({
    userId: "user-1",
    planCode: "monthly",
    paypalPlanId: "P-MONTHLY-ALLOW"
  });
  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      status: "ACTIVE",
      plan_id: "P-MONTHLY-ALLOW",
      custom_id: created.checkout_session_id
    }
  });
  const deps = baseDeps({ subscriptionRepository: repo, paypalClient });
  const first = await handleConfirmSubscription({
    body: {
      subscriptionID: "I-SUB-1",
      checkout_session_id: created.checkout_session_id
    },
    user: officialUser(),
    deps
  });
  const second = await handleConfirmSubscription({
    body: {
      subscriptionID: "I-SUB-1",
      checkout_session_id: created.checkout_session_id
    },
    user: officialUser(),
    deps
  });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.paypal_subscription_id, "I-SUB-1");
});

test("8: confirm does not grant paid_through", async () => {
  const repo = memorySubscriptionRepo();
  const created = await repo.acquireSubscriptionSlot({
    userId: "user-1",
    planCode: "monthly",
    paypalPlanId: "P-MONTHLY-ALLOW"
  });
  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      status: "ACTIVE",
      plan_id: "P-MONTHLY-ALLOW",
      custom_id: created.checkout_session_id,
      billing_info: { next_billing_time: "2026-10-01T00:00:00Z" }
    }
  });
  const result = await handleConfirmSubscription({
    body: {
      subscriptionID: "I-SUB-1",
      checkout_session_id: created.checkout_session_id
    },
    user: officialUser(),
    deps: baseDeps({ subscriptionRepository: repo, paypalClient })
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.paid_through, null);
  assert.equal(result.body.subscription.paid_through, null);
  const row = await repo.findByCheckoutSessionId(created.checkout_session_id);
  assert.equal(row.paid_through, null);
});

// --- 9–14 webhooks ---

test("9: SALE.COMPLETED extends paid_through", async () => {
  const repo = memorySubscriptionRepo({
    subscriptions: [{
      id: "sub-1",
      user_id: "user-1",
      checkout_session_id: "sess-1",
      paypal_subscription_id: "I-SUB-1",
      paypal_plan_id: "P-MONTHLY-ALLOW",
      plan_code: "monthly",
      status: "ACTIVE",
      currency: "USD",
      recurring_amount: 5,
      paid_through: null,
      reconciliation_status: "none",
      created_at: "2026-01-01T00:00:00Z"
    }]
  });
  const nextBilling = "2026-10-01T00:00:00Z";
  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      status: "ACTIVE",
      plan_id: "P-MONTHLY-ALLOW",
      billing_info: { next_billing_time: nextBilling }
    }
  });
  paypalClient.processSubscriptionWebhookEvent = repo.processSubscriptionWebhookEvent.bind(repo);

  const event = saleCompletedEvent();
  const rawBody = JSON.stringify(event);
  const result = await handlePaypalWebhookRequest({
    rawBody,
    headers: SIG_HEADERS,
    deps: {
      paypalClient,
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: {
        processWebhookEvent: async () => {
          throw new Error("Orders path must not run for SALE");
        },
        processSubscriptionWebhookEvent: repo.processSubscriptionWebhookEvent.bind(repo)
      }
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.outcome, "processed");
  assert.equal(repo.subscriptions[0].paid_through, nextBilling);
});

test("10: SALE merchant mismatch rejected", async () => {
  const repo = memorySubscriptionRepo({
    subscriptions: [{
      id: "sub-1",
      user_id: "user-1",
      checkout_session_id: "sess-1",
      paypal_subscription_id: "I-SUB-1",
      plan_code: "monthly",
      status: "ACTIVE",
      currency: "USD",
      recurring_amount: 5,
      paid_through: null,
      reconciliation_status: "none",
      created_at: "2026-01-01T00:00:00Z"
    }]
  });
  const event = saleCompletedEvent({ merchantId: "OTHER-MERCHANT" });
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(event),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: mockPaypalClient({
        subscription: {
          id: "I-SUB-1",
          plan_id: "P-MONTHLY-ALLOW",
          billing_info: { next_billing_time: "2026-10-01T00:00:00Z" }
        }
      }),
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: {
        processWebhookEvent: async () => ({ outcome: "processed" }),
        processSubscriptionWebhookEvent: repo.processSubscriptionWebhookEvent.bind(repo)
      }
    }
  });
  assert.equal(result.body.outcome, "rejected");
  assert.equal(result.body.error, "MERCHANT_MISMATCH");
  assert.equal(repo.subscriptions[0].paid_through, null);
});

test("10b: SALE amount mismatch rejected", async () => {
  const repo = memorySubscriptionRepo({
    subscriptions: [{
      id: "sub-1",
      user_id: "user-1",
      checkout_session_id: "sess-1",
      paypal_subscription_id: "I-SUB-1",
      plan_code: "monthly",
      status: "ACTIVE",
      currency: "USD",
      recurring_amount: 5,
      paid_through: null,
      reconciliation_status: "none",
      created_at: "2026-01-01T00:00:00Z"
    }]
  });
  const event = saleCompletedEvent({ amount: "99.00" });
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(event),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: mockPaypalClient({
        subscription: {
          id: "I-SUB-1",
          plan_id: "P-MONTHLY-ALLOW",
          billing_info: { next_billing_time: "2026-10-01T00:00:00Z" }
        }
      }),
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: {
        processWebhookEvent: async () => ({ outcome: "processed" }),
        processSubscriptionWebhookEvent: repo.processSubscriptionWebhookEvent.bind(repo)
      }
    }
  });
  assert.equal(result.body.outcome, "rejected");
  assert.ok(
    result.body.error === "AMOUNT_CURRENCY_MISMATCH"
    || result.body.error === "VALIDATION_FAILED"
  );
  assert.equal(repo.subscriptions[0].paid_through, null);
});

test("11: duplicate event / sale does not re-extend", async () => {
  const repo = memorySubscriptionRepo({
    subscriptions: [{
      id: "sub-1",
      user_id: "user-1",
      checkout_session_id: "sess-1",
      paypal_subscription_id: "I-SUB-1",
      plan_code: "monthly",
      status: "ACTIVE",
      currency: "USD",
      recurring_amount: 5,
      paid_through: null,
      reconciliation_status: "none",
      created_at: "2026-01-01T00:00:00Z"
    }]
  });
  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      plan_id: "P-MONTHLY-ALLOW",
      billing_info: { next_billing_time: "2026-10-01T00:00:00Z" }
    }
  });
  const deps = {
    paypalClient,
    paypalWebhookId: "WHID",
    paypalMerchantId: MERCHANT,
    planEnv: PLAN_ENV,
    webhookRepository: {
      processWebhookEvent: async () => ({ outcome: "processed" }),
      processSubscriptionWebhookEvent: repo.processSubscriptionWebhookEvent.bind(repo)
    }
  };
  const rawBody = JSON.stringify(saleCompletedEvent());
  const first = await handlePaypalWebhookRequest({ rawBody, headers: SIG_HEADERS, deps });
  assert.equal(first.body.outcome, "processed");
  const paid = repo.subscriptions[0].paid_through;
  const second = await handlePaypalWebhookRequest({ rawBody, headers: SIG_HEADERS, deps });
  assert.equal(second.body.outcome, "duplicate");
  assert.equal(repo.subscriptions[0].paid_through, paid);

  const third = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(saleCompletedEvent({ id: "WH-SALE-2", saleId: "SALE-1" })),
    headers: SIG_HEADERS,
    deps
  });
  assert.equal(third.body.outcome, "duplicate");
  assert.equal(repo.subscriptions[0].paid_through, paid);
});

test("12: webhook before confirm -> pending_resolution", async () => {
  const repo = memorySubscriptionRepo();
  const event = saleCompletedEvent();
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(event),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: mockPaypalClient({
        subscription: {
          id: "I-SUB-1",
          plan_id: "P-MONTHLY-ALLOW",
          billing_info: { next_billing_time: "2026-10-01T00:00:00Z" }
        }
      }),
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: {
        processWebhookEvent: async () => ({ outcome: "processed" }),
        processSubscriptionWebhookEvent: repo.processSubscriptionWebhookEvent.bind(repo)
      }
    }
  });
  assert.equal(result.body.outcome, "pending_resolution");
  assert.equal(repo.events[0].processing_status, "pending_resolution");
});

test("13: pending event resolved after confirm", async () => {
  const repo = memorySubscriptionRepo();
  const created = await repo.acquireSubscriptionSlot({
    userId: "user-1",
    planCode: "monthly",
    paypalPlanId: "P-MONTHLY-ALLOW"
  });

  await repo.processSubscriptionWebhookEvent({
    paypalEventId: "WH-EARLY",
    eventType: "PAYMENT.SALE.COMPLETED",
    paypalSubscriptionId: "I-SUB-1",
    paypalSaleId: "SALE-EARLY",
    amount: 5,
    currency: "USD",
    paymentTime: "2026-09-01T00:00:00Z",
    nextBillingTime: "2026-10-01T00:00:00Z",
    targetStatus: null,
    isFullRefund: false,
    sanitizedPayload: {
      event_type: "PAYMENT.SALE.COMPLETED",
      paypal_subscription_id: "I-SUB-1",
      paypal_sale_id: "SALE-EARLY",
      amount: 5,
      currency: "USD",
      payment_time: "2026-09-01T00:00:00Z",
      next_billing_time: "2026-10-01T00:00:00Z"
    }
  });
  assert.equal(repo.events[0].processing_status, "pending_resolution");

  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      status: "ACTIVE",
      plan_id: "P-MONTHLY-ALLOW",
      custom_id: created.checkout_session_id,
      billing_info: { next_billing_time: "2026-10-01T00:00:00Z" }
    }
  });

  const confirm = await handleConfirmSubscription({
    body: {
      subscriptionID: "I-SUB-1",
      checkout_session_id: created.checkout_session_id
    },
    user: officialUser(),
    deps: baseDeps({ subscriptionRepository: repo, paypalClient })
  });
  assert.equal(confirm.statusCode, 200);
  const row = await repo.findByCheckoutSessionId(created.checkout_session_id);
  assert.equal(row.paid_through, "2026-10-01T00:00:00Z");
});

test("14: payment failed does not extend paid_through", async () => {
  const repo = memorySubscriptionRepo({
    subscriptions: [{
      id: "sub-1",
      user_id: "user-1",
      checkout_session_id: "sess-1",
      paypal_subscription_id: "I-SUB-1",
      plan_code: "monthly",
      status: "ACTIVE",
      currency: "USD",
      recurring_amount: 5,
      paid_through: "2026-09-15T00:00:00Z",
      reconciliation_status: "none",
      created_at: "2026-01-01T00:00:00Z"
    }]
  });
  const event = {
    id: "WH-FAIL",
    event_type: "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
    resource: { id: "I-SUB-1", status: "ACTIVE" }
  };
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(event),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: mockPaypalClient({
        subscription: { id: "I-SUB-1", plan_id: "P-MONTHLY-ALLOW", status: "ACTIVE" }
      }),
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: {
        processWebhookEvent: async () => ({ outcome: "processed" }),
        processSubscriptionWebhookEvent: repo.processSubscriptionWebhookEvent.bind(repo)
      }
    }
  });
  assert.equal(result.body.outcome, "processed");
  assert.equal(repo.subscriptions[0].paid_through, "2026-09-15T00:00:00Z");
});

// --- 15–16 cancel slot protection ---

test("15/16: cancel sets CANCELLED but keeps slot occupied until paid_through", async () => {
  const future = "2099-01-01T00:00:00Z";
  const repo = memorySubscriptionRepo({
    subscriptions: [{
      id: "sub-1",
      user_id: "user-1",
      checkout_session_id: "sess-1",
      paypal_subscription_id: "I-SUB-1",
      plan_code: "monthly",
      status: "ACTIVE",
      currency: "USD",
      recurring_amount: 5,
      paid_through: future,
      reconciliation_status: "none",
      created_at: "2026-01-01T00:00:00Z"
    }],
    slots: {
      "user-1": {
        slot_state: "OCCUPIED",
        checkout_session_id: "sess-1",
        subscription_id: "sub-1",
        release_after: null
      }
    }
  });
  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      status: "ACTIVE",
      plan_id: "P-MONTHLY-ALLOW"
    }
  });
  const result = await handleCancelSubscription({
    body: {},
    user: officialUser(),
    deps: baseDeps({ subscriptionRepository: repo, paypalClient })
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.outcome, "cancelled");
  assert.equal(repo.subscriptions[0].status, "CANCELLED");
  assert.equal(repo.slots["user-1"].slot_state, "OCCUPIED");
  assert.equal(repo.slots["user-1"].release_after, future);
  assert.equal(repo.subscriptions[0].paid_through, future);

  // Second create still blocked
  const create = await handleCreateSession({
    body: { plan_code: "monthly" },
    user: officialUser(),
    deps: baseDeps({ subscriptionRepository: repo, paypalClient })
  });
  assert.equal(create.body.error.code, "SUBSCRIPTION_SLOT_OCCUPIED");
});

// --- 17 refund / reversal ---

test("17: refund/reversal blocks access", async () => {
  const repo = memorySubscriptionRepo({
    subscriptions: [{
      id: "sub-1",
      user_id: "user-1",
      checkout_session_id: "sess-1",
      paypal_subscription_id: "I-SUB-1",
      plan_code: "monthly",
      status: "ACTIVE",
      currency: "USD",
      recurring_amount: 5,
      paid_through: "2026-10-01T00:00:00Z",
      reconciliation_status: "none",
      created_at: "2026-01-01T00:00:00Z"
    }]
  });
  const refundEvent = {
    id: "WH-REFUND",
    event_type: "PAYMENT.SALE.REFUNDED",
    resource: {
      id: "SALE-1",
      billing_agreement_id: "I-SUB-1",
      amount: { total: "5.00", currency: "USD" },
      payee: { merchant_id: MERCHANT },
      state: "completed"
    }
  };
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(refundEvent),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: mockPaypalClient({
        subscription: { id: "I-SUB-1", plan_id: "P-MONTHLY-ALLOW" }
      }),
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: {
        processWebhookEvent: async () => ({ outcome: "processed" }),
        processSubscriptionWebhookEvent: repo.processSubscriptionWebhookEvent.bind(repo)
      }
    }
  });
  assert.equal(result.body.outcome, "processed");
  assert.ok(repo.subscriptions[0].access_blocked_at);
  assert.equal(repo.subscriptions[0].access_block_reason, "FULL_REFUND");
});

// --- 18 non-JSON PayPal error sanitization ---

test("18: non-JSON PayPal error does not leak body", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/v1/oauth2/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
        headers: { get: () => "application/json" }
      };
    }
    return {
      ok: false,
      status: 502,
      text: async () => "<html>secret stacktrace with token=abc</html>",
      headers: { get: (n) => (n === "content-type" ? "text/html" : null) }
    };
  };
  const client = createPaypalClient({
    clientId: "id",
    clientSecret: "secret",
    env: "sandbox",
    fetchImpl
  });
  await assert.rejects(
    () => client.getSubscription({ subscriptionId: "I-X" }),
    (err) => {
      assert.equal(err.code, "PAYPAL_GET_SUBSCRIPTION_FAILED");
      assert.equal(err.details.bodyOmitted, true);
      assert.ok(!JSON.stringify(err.details).includes("secret stacktrace"));
      assert.ok(!JSON.stringify(err.details).includes("token=abc"));
      return true;
    }
  );
});

// --- 19 Orders regression smoke (handler still routes Orders) ---

test("19: Orders CAPTURE event still uses Orders path (not subscription)", async () => {
  assert.equal(isSubscriptionEventType("PAYMENT.CAPTURE.COMPLETED"), false);
  assert.equal(isSubscriptionEventType("PAYMENT.SALE.COMPLETED"), true);

  let ordersCalled = false;
  let subCalled = false;
  const event = {
    id: "EVT-ORD-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAP-1",
      amount: { value: "5.00", currency_code: "USD" },
      supplementary_data: { related_ids: { order_id: "O-1" } },
      payee: { merchant_id: MERCHANT }
    }
  };
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(event),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: mockPaypalClient(),
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: {
        async processWebhookEvent() {
          ordersCalled = true;
          return { outcome: "processed", order_status: "paid" };
        },
        async processSubscriptionWebhookEvent() {
          subCalled = true;
          return { outcome: "processed" };
        }
      }
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.outcome, "processed");
  assert.equal(ordersCalled, true);
  assert.equal(subCalled, false);
});

test("get_status returns safe summary only", async () => {
  const repo = memorySubscriptionRepo({
    subscriptions: [{
      id: "sub-1",
      user_id: "user-1",
      checkout_session_id: "sess-1",
      paypal_subscription_id: "I-SUB-1",
      plan_code: "monthly",
      status: "ACTIVE",
      currency: "USD",
      recurring_amount: 5,
      paid_through: "2026-10-01T00:00:00Z",
      next_billing_time: "2026-10-01T00:00:00Z",
      cancelled_at: null,
      suspended_at: null,
      access_blocked_at: null,
      reconciliation_status: "none",
      created_at: "2026-01-01T00:00:00Z",
      payer_email: "secret@example.com"
    }]
  });
  const result = await handleGetStatus({
    user: officialUser(),
    deps: baseDeps({ subscriptionRepository: repo })
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(Object.keys(result.body.subscription).sort(), [
    "access_blocked",
    "cancelled_at",
    "next_billing_time",
    "paid_through",
    "plan_code",
    "reconciliation_status",
    "status",
    "suspended_at"
  ].sort());
  assert.equal(result.body.subscription.payer_email, undefined);
  assert.ok(!JSON.stringify(result.body).includes("secret@example.com"));
});

test("action router rejects unknown action", async () => {
  const result = await handlePaypalSubscriptionRequest({
    body: { action: "hack" },
    user: officialUser(),
    correlationId: "c1",
    deps: baseDeps()
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, "INVALID_REQUEST");
});

test("resolveSubscriptionPlanAllowlist uses env", () => {
  const monthly = resolveSubscriptionPlanAllowlist("monthly", PLAN_ENV);
  assert.equal(monthly.paypalPlanId, "P-MONTHLY-ALLOW");
  assert.equal(resolveSubscriptionPlanAllowlist("monthly", {}), null);
});

test("signature failure does not write subscription business tables", async () => {
  const repo = memorySubscriptionRepo();
  let wrote = false;
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(saleCompletedEvent()),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: {
        async verifyWebhookSignature() {
          return { verification_status: "FAILURE" };
        }
      },
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: {
        async processWebhookEvent() {
          wrote = true;
        },
        async processSubscriptionWebhookEvent() {
          wrote = true;
        }
      }
    }
  });
  assert.equal(result.statusCode, 401);
  assert.equal(wrote, false);
  assert.equal(repo.events.length, 0);
});


// --- Auth-07C.7E SALE persist + reconciliation ---

function activeSubSeed(overrides = {}) {
  return {
    id: "sub-1",
    user_id: "user-1",
    checkout_session_id: "sess-1",
    paypal_subscription_id: "I-SUB-1",
    paypal_plan_id: "P-MONTHLY-ALLOW",
    plan_code: "monthly",
    status: "ACTIVE",
    currency: "USD",
    recurring_amount: 5,
    paid_through: null,
    reconciliation_status: "none",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides
  };
}

test("07C.7E-1: SALE arrival always leaves received/processed event", async () => {
  const repo = memorySubscriptionRepo({ subscriptions: [activeSubSeed()] });
  const nextBilling = "2026-10-01T00:00:00Z";
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(saleCompletedEvent()),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: mockPaypalClient({
        subscription: {
          id: "I-SUB-1",
          plan_id: "P-MONTHLY-ALLOW",
          custom_id: "sess-1",
          billing_info: { next_billing_time: nextBilling }
        }
      }),
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: webhookRepoFrom(repo)
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.outcome, "processed");
  assert.ok(repo.events.some((e) => e.paypal_event_id === "WH-SALE-1"));
  assert.equal(repo.subscriptions[0].paid_through, nextBilling);
});

test("07C.7E-2: Resend same event is idempotent", async () => {
  const repo = memorySubscriptionRepo({ subscriptions: [activeSubSeed()] });
  const deps = {
    paypalClient: mockPaypalClient({
      subscription: {
        id: "I-SUB-1",
        plan_id: "P-MONTHLY-ALLOW",
        custom_id: "sess-1",
        billing_info: { next_billing_time: "2026-10-01T00:00:00Z" }
      }
    }),
    paypalWebhookId: "WHID",
    paypalMerchantId: MERCHANT,
    planEnv: PLAN_ENV,
    webhookRepository: webhookRepoFrom(repo)
  };
  const rawBody = JSON.stringify(saleCompletedEvent());
  const first = await handlePaypalWebhookRequest({ rawBody, headers: SIG_HEADERS, deps });
  const second = await handlePaypalWebhookRequest({ rawBody, headers: SIG_HEADERS, deps });
  assert.equal(first.body.outcome, "processed");
  assert.equal(second.body.outcome, "duplicate");
  assert.equal(repo.sales.size, 1);
  assert.equal(repo.events.filter((e) => e.paypal_event_id === "WH-SALE-1").length, 1);
});

test("07C.7E-3/5: missing payee merchant uses verified GET fallback", async () => {
  const repo = memorySubscriptionRepo({ subscriptions: [activeSubSeed()] });
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(saleCompletedEvent({ omitMerchant: true })),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: mockPaypalClient({
        subscription: {
          id: "I-SUB-1",
          plan_id: "P-MONTHLY-ALLOW",
          custom_id: "sess-1",
          billing_info: { next_billing_time: "2026-10-01T00:00:00Z" }
        }
      }),
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: webhookRepoFrom(repo)
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.outcome, "processed");
  assert.equal(repo.subscriptions[0].paid_through, "2026-10-01T00:00:00Z");
  const ev = repo.events.find((e) => e.paypal_event_id === "WH-SALE-1");
  assert.ok(ev);
  assert.equal(
    ev.payload.merchant_validation_source,
    "verified_webhook_plus_authenticated_paypal_get"
  );
});

test("07C.7E-4: payee present mismatch rejected and persisted", async () => {
  const repo = memorySubscriptionRepo({ subscriptions: [activeSubSeed()] });
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(saleCompletedEvent({ merchantId: "OTHER" })),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: mockPaypalClient({
        subscription: { id: "I-SUB-1", plan_id: "P-MONTHLY-ALLOW", custom_id: "sess-1" }
      }),
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: webhookRepoFrom(repo)
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.outcome, "rejected");
  assert.equal(result.body.error, "MERCHANT_MISMATCH");
  assert.equal(repo.subscriptions[0].paid_through, null);
  const ev = repo.events.find((e) => e.paypal_event_id === "WH-SALE-1");
  assert.ok(ev);
  assert.equal(ev.error_code, "MERCHANT_MISMATCH");
});

test("07C.7E-6: missing billing_agreement_id still saves failed event", async () => {
  const repo = memorySubscriptionRepo({ subscriptions: [activeSubSeed()] });
  const event = saleCompletedEvent({ omitMerchant: true });
  delete event.resource.billing_agreement_id;
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(event),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: mockPaypalClient({
        subscription: { id: "I-SUB-1", plan_id: "P-MONTHLY-ALLOW", custom_id: "sess-1" }
      }),
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: webhookRepoFrom(repo)
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.error, "MISSING_BILLING_AGREEMENT_ID");
  assert.ok(repo.events.some((e) => e.error_code === "MISSING_BILLING_AGREEMENT_ID"));
});

test("07C.7E-7: missing sale id still saves failed event", async () => {
  const repo = memorySubscriptionRepo({ subscriptions: [activeSubSeed()] });
  const event = saleCompletedEvent({ omitMerchant: true, saleId: "" });
  event.resource.id = "";
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(event),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: mockPaypalClient({
        subscription: { id: "I-SUB-1", plan_id: "P-MONTHLY-ALLOW", custom_id: "sess-1" }
      }),
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: webhookRepoFrom(repo)
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.error, "MISSING_SALE_ID");
  assert.ok(repo.events.some((e) => e.error_code === "MISSING_SALE_ID"));
});

test("07C.7E-8: RPC failure still saves error_code", async () => {
  const repo = memorySubscriptionRepo({ subscriptions: [activeSubSeed()] });
  const broken = webhookRepoFrom(repo);
  broken.processSubscriptionWebhookEvent = async () => {
    throw new Error("boom");
  };
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(saleCompletedEvent()),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: mockPaypalClient({
        subscription: {
          id: "I-SUB-1",
          plan_id: "P-MONTHLY-ALLOW",
          custom_id: "sess-1",
          billing_info: { next_billing_time: "2026-10-01T00:00:00Z" }
        }
      }),
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: broken
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.outcome, "rejected");
  assert.equal(result.body.error, "DB_ERROR");
  const ev = repo.events.find((e) => e.paypal_event_id === "WH-SALE-1");
  assert.ok(ev);
  assert.equal(ev.error_code, "DB_ERROR");
});

test("07C.7E-9/10: reconciliation processes COMPLETED and ignores pending", async () => {
  const repo = memorySubscriptionRepo({
    subscriptions: [activeSubSeed({ checkout_session_id: "sess-1" })]
  });
  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      status: "ACTIVE",
      plan_id: "P-MONTHLY-ALLOW",
      custom_id: "sess-1",
      billing_info: { next_billing_time: "2026-10-01T00:00:00Z" }
    },
    transactions: [
      {
        id: "SALE-PEND",
        status: "PENDING",
        amount_with_breakdown: { gross_amount: { value: "5.00", currency_code: "USD" } },
        time: "2026-09-01T00:00:00Z"
      },
      {
        id: "SALE-OK",
        status: "COMPLETED",
        amount_with_breakdown: { gross_amount: { value: "5.00", currency_code: "USD" } },
        time: "2026-09-01T00:00:00Z"
      }
    ]
  });
  const result = await handleGetStatus({
    user: officialUser(),
    deps: baseDeps({ subscriptionRepository: repo, paypalClient })
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.subscription.paid_through, "2026-10-01T00:00:00Z");
  assert.equal(repo.sales.has("SALE-OK"), true);
  assert.equal(repo.sales.has("SALE-PEND"), false);
  assert.equal(repo.transactions[0].audit_source, "paypal_api_reconciliation");
});

test("07C.7E-11/12/13: sale_id UNIQUE across webhook and reconciliation", async () => {
  const repo = memorySubscriptionRepo({ subscriptions: [activeSubSeed()] });
  const nextBilling = "2026-10-01T00:00:00Z";
  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      plan_id: "P-MONTHLY-ALLOW",
      custom_id: "sess-1",
      billing_info: { next_billing_time: nextBilling }
    },
    transactions: [
      {
        id: "SALE-1",
        status: "COMPLETED",
        amount_with_breakdown: { gross_amount: { value: "5.00", currency_code: "USD" } },
        time: "2026-09-01T00:00:00Z"
      }
    ]
  });

  // webhook first
  const wh = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(saleCompletedEvent({ saleId: "SALE-1" })),
    headers: SIG_HEADERS,
    deps: {
      paypalClient,
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: webhookRepoFrom(repo)
    }
  });
  assert.equal(wh.body.outcome, "processed");
  const paid1 = repo.subscriptions[0].paid_through;

  // reconciliation after webhook — duplicate, no second extend
  const st = await handleGetStatus({
    user: officialUser(),
    deps: baseDeps({ subscriptionRepository: repo, paypalClient })
  });
  assert.equal(st.body.subscription.paid_through, paid1);
  assert.equal(repo.sales.size, 1);

  // reverse: reconciliation first on fresh repo
  const repo2 = memorySubscriptionRepo({ subscriptions: [activeSubSeed()] });
  const paypalClient2 = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      plan_id: "P-MONTHLY-ALLOW",
      custom_id: "sess-1",
      billing_info: { next_billing_time: nextBilling }
    },
    transactions: [
      {
        id: "SALE-1",
        status: "COMPLETED",
        amount_with_breakdown: { gross_amount: { value: "5.00", currency_code: "USD" } },
        time: "2026-09-01T00:00:00Z"
      }
    ]
  });
  await handleGetStatus({
    user: officialUser(),
    deps: baseDeps({ subscriptionRepository: repo2, paypalClient: paypalClient2 })
  });
  assert.equal(repo2.subscriptions[0].paid_through, nextBilling);
  const wh2 = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(saleCompletedEvent({ saleId: "SALE-1" })),
    headers: SIG_HEADERS,
    deps: {
      paypalClient: paypalClient2,
      paypalWebhookId: "WHID",
      paypalMerchantId: MERCHANT,
      planEnv: PLAN_ENV,
      webhookRepository: webhookRepoFrom(repo2)
    }
  });
  assert.equal(wh2.body.outcome, "duplicate");
  assert.equal(repo2.sales.size, 1);
});

test("07C.7E-14: forged amount/currency rejected by reconciliation", async () => {
  const repo = memorySubscriptionRepo({ subscriptions: [activeSubSeed()] });
  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      plan_id: "P-MONTHLY-ALLOW",
      custom_id: "sess-1",
      billing_info: { next_billing_time: "2026-10-01T00:00:00Z" }
    },
    transactions: [
      {
        id: "SALE-BAD",
        status: "COMPLETED",
        amount_with_breakdown: { gross_amount: { value: "99.00", currency_code: "USD" } },
        time: "2026-09-01T00:00:00Z"
      }
    ]
  });
  const result = await handleGetStatus({
    user: officialUser(),
    deps: baseDeps({ subscriptionRepository: repo, paypalClient })
  });
  assert.equal(result.body.subscription.paid_through, null);
  assert.equal(repo.sales.size, 0);
});

test("07C.7E-15: browser cannot invoke reconcile action", async () => {
  const result = await handlePaypalSubscriptionRequest({
    body: {
      action: "reconcile_paypal_subscription_sale",
      paypal_sale_id: "SALE-1",
      amount: 5,
      currency: "USD"
    },
    user: officialUser(),
    correlationId: "c1",
    deps: baseDeps()
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, "INVALID_REQUEST");
});

test("07C.7E-16: owner isolation on reconciliation", async () => {
  const repo = memorySubscriptionRepo({
    subscriptions: [activeSubSeed({ user_id: "user-owner" })]
  });
  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      plan_id: "P-MONTHLY-ALLOW",
      custom_id: "sess-1",
      billing_info: { next_billing_time: "2026-10-01T00:00:00Z" }
    },
    transactions: [
      {
        id: "SALE-1",
        status: "COMPLETED",
        amount_with_breakdown: { gross_amount: { value: "5.00", currency_code: "USD" } },
        time: "2026-09-01T00:00:00Z"
      }
    ]
  });
  const result = await handleGetStatus({
    user: officialUser({ id: "user-attacker" }),
    deps: baseDeps({ subscriptionRepository: repo, paypalClient })
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.subscription, null);
  assert.equal(repo.subscriptions[0].paid_through, null);
});

test("07C.7E-17: reconciliation does not store payer PII", async () => {
  const repo = memorySubscriptionRepo({ subscriptions: [activeSubSeed()] });
  const paypalClient = mockPaypalClient({
    subscription: {
      id: "I-SUB-1",
      plan_id: "P-MONTHLY-ALLOW",
      custom_id: "sess-1",
      billing_info: { next_billing_time: "2026-10-01T00:00:00Z" },
      subscriber: { email_address: "payer@example.com", name: { given_name: "A" } }
    },
    transactions: [
      {
        id: "SALE-1",
        status: "COMPLETED",
        amount_with_breakdown: { gross_amount: { value: "5.00", currency_code: "USD" } },
        time: "2026-09-01T00:00:00Z",
        payer_email: "payer@example.com"
      }
    ]
  });
  await handleGetStatus({
    user: officialUser(),
    deps: baseDeps({ subscriptionRepository: repo, paypalClient })
  });
  const blob = JSON.stringify(repo.transactions);
  assert.ok(!blob.includes("payer@example.com"));
  assert.ok(!blob.includes("given_name"));
  assert.equal(repo.transactions[0].sanitized_payload.source, "paypal_api_reconciliation");
});
