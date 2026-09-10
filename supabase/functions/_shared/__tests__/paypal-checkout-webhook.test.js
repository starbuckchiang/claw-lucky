"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getPaypalPlan, PAYPAL_PLANS } = require("../lib/paypal-plans");
const {
  createPaypalClient,
  resolveApiBase,
  amountsEqual,
  normalizeMerchantId,
  buildSanitizedPaypalErrorDetails,
  SANDBOX_API_BASE
} = require("../lib/paypal-client");
const {
  handleCreateOrder,
  handleCaptureOrder,
  isFreshOpenOrder,
  OPEN_ORDER_TTL_MS
} = require("../paypal-checkout-handler");
const {
  handlePaypalWebhookRequest,
  extractResourceFields
} = require("../paypal-webhook-handler");

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

function officialUser() {
  return { id: "user-1", is_anonymous: false, email_confirmed_at: "2026-01-01T00:00:00Z" };
}

function memoryRepo(seed = []) {
  const rows = seed.map((r) => ({ ...r }));
  return {
    rows,
    async failStaleOpenOrders(userId, planCode, maxAgeMinutes = 15, nowMs = Date.now()) {
      const cutoff = nowMs - maxAgeMinutes * 60000;
      for (const r of rows) {
        if (
          r.user_id === userId
          && r.plan_code === planCode
          && ["created", "approved", "capture_pending"].includes(r.status)
          && Date.parse(r.created_at) < cutoff
        ) {
          r.status = "failed";
        }
      }
    },
    async findOpenOrderByUserPlan(userId, planCode, opts = {}) {
      const maxAgeMs = opts.maxAgeMs || OPEN_ORDER_TTL_MS;
      const nowMs = opts.nowMs || Date.now();
      return rows.find((r) =>
        r.user_id === userId
        && r.plan_code === planCode
        && ["created", "approved", "capture_pending"].includes(r.status)
        && (nowMs - Date.parse(r.created_at)) <= maxAgeMs
      ) || null;
    },
    async createPaymentOrder({ userId, planCode, amount, currency, createRequestId }) {
      const existing = rows.find((r) => r.create_request_id === createRequestId);
      if (existing) return existing;
      const open = rows.find((r) =>
        r.user_id === userId
        && r.plan_code === planCode
        && ["created", "approved", "capture_pending"].includes(r.status)
      );
      if (open) {
        const err = new Error("duplicate key value violates unique constraint uq_payment_orders_one_open_per_user_plan");
        throw err;
      }
      const row = {
        id: `int-${rows.length + 1}`,
        user_id: userId,
        plan_code: planCode,
        amount,
        currency,
        status: "created",
        paypal_order_id: null,
        paypal_capture_id: null,
        create_request_id: createRequestId,
        capture_request_id: null,
        created_at: new Date().toISOString()
      };
      rows.push(row);
      return row;
    },
    async attachPaypalOrderId(orderId, paypalOrderId) {
      const row = rows.find((r) => r.id === orderId);
      row.paypal_order_id = paypalOrderId;
      return row;
    },
    async findByPaypalOrderId(paypalOrderId) {
      return rows.find((r) => r.paypal_order_id === paypalOrderId) || null;
    },
    async findByPaypalCaptureId(paypalCaptureId) {
      return rows.find((r) => r.paypal_capture_id === paypalCaptureId) || null;
    },
    async transitionStatus(orderId, newStatus, paypalCaptureId, captureRequestId) {
      const row = rows.find((r) => r.id === orderId);
      const rank = {
        created: 10, approved: 20, capture_pending: 30, paid: 40,
        denied: 50, failed: 50, refunded: 60, reversed: 60
      };
      if (row.status !== newStatus && rank[newStatus] < rank[row.status]) {
        throw new Error("STATUS_REGRESSION_FORBIDDEN");
      }
      if (row.status === "paid" && !["paid", "refunded", "reversed"].includes(newStatus)) {
        throw new Error("STATUS_REGRESSION_FORBIDDEN");
      }
      if (["refunded", "reversed"].includes(row.status) && newStatus !== row.status) {
        throw new Error("STATUS_REGRESSION_FORBIDDEN");
      }
      if (paypalCaptureId) {
        const other = rows.find((r) => r.paypal_capture_id === paypalCaptureId && r.id !== orderId);
        if (other) throw new Error("CAPTURE_ID_REUSED");
      }
      row.status = newStatus;
      if (paypalCaptureId) row.paypal_capture_id = paypalCaptureId;
      if (captureRequestId) row.capture_request_id = captureRequestId;
      return row;
    }
  };
}

function mockVerifyClient(rawBody) {
  return {
    async verifyWebhookSignature({ rawBody: rb }) {
      assert.equal(typeof rb, "string");
      return { verification_status: "SUCCESS", webhookEvent: JSON.parse(rb) };
    }
  };
}

function completedEvent(overrides = {}) {
  return {
    id: "EVT-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAP-1",
      amount: { value: "5.00", currency_code: "USD" },
      payee: { merchant_id: "MERCH" },
      supplementary_data: { related_ids: { order_id: "PO-1" } }
    },
    ...overrides
  };
}

test("paypal-plans whitelist", () => {
  assert.equal(PAYPAL_PLANS.monthly.amount, "5.00");
  assert.equal(getPaypalPlan("x"), null);
});

test("paypal-client sandbox only", () => {
  assert.throws(() => resolveApiBase("live"), /PAYPAL_ENV_NOT_SANDBOX/);
  assert.equal(resolveApiBase("sandbox"), SANDBOX_API_BASE);
});

test("extractResourceFields: CAPTURE order id only from related_ids", () => {
  const fields = extractResourceFields({
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAP-X",
      amount: { value: "5.00", currency_code: "USD" },
      payee: { merchant_id: "M" },
      supplementary_data: { related_ids: { order_id: "PO-FROM-RELATED" } }
    }
  });
  assert.equal(fields.paypalOrderId, "PO-FROM-RELATED");
  assert.equal(fields.paypalCaptureId, "CAP-X");
});

test("isFreshOpenOrder: 14 min fresh, 16 min stale", () => {
  const now = Date.parse("2026-08-21T12:00:00.000Z");
  const fresh = {
    status: "created",
    created_at: new Date(now - 14 * 60000).toISOString()
  };
  const stale = {
    status: "created",
    created_at: new Date(now - 16 * 60000).toISOString()
  };
  assert.equal(isFreshOpenOrder(fresh, now), true);
  assert.equal(isFreshOpenOrder(stale, now), false);
  assert.equal(isFreshOpenOrder({ status: "failed", created_at: fresh.created_at }, now), false);
});

test("create-order: 14 min open order reused; 16 min stale not reused", async () => {
  const now = Date.now();
  const repo = memoryRepo([{
    id: "int-old",
    user_id: "user-1",
    plan_code: "monthly",
    amount: "5.00",
    currency: "USD",
    status: "created",
    paypal_order_id: "PO-OLD",
    create_request_id: "c-old",
    created_at: new Date(now - 14 * 60000).toISOString()
  }]);

  const reused = await handleCreateOrder({
    body: { planCode: "monthly", idempotencyKey: "k" },
    user: officialUser(),
    deps: {
      nowMs: () => now,
      paymentOrdersRepository: repo,
      paypalClient: { async createOrder() { throw new Error("should not create"); } }
    }
  });
  assert.equal(reused.body.orderId, "PO-OLD");

  repo.rows[0].created_at = new Date(now - 16 * 60000).toISOString();
  let created = false;
  const stale = await handleCreateOrder({
    body: { planCode: "monthly", idempotencyKey: "k2" },
    user: officialUser(),
    deps: {
      nowMs: () => now,
      paymentOrdersRepository: repo,
      paypalClient: {
        async createOrder() {
          created = true;
          return { id: "PO-NEW" };
        }
      }
    }
  });
  assert.equal(repo.rows[0].status, "failed");
  assert.equal(created, true);
  assert.equal(stale.body.orderId, "PO-NEW");
});

test("create-order: failed not reused", async () => {
  const now = Date.now();
  const repo = memoryRepo([{
    id: "int-f",
    user_id: "user-1",
    plan_code: "monthly",
    amount: "5.00",
    currency: "USD",
    status: "failed",
    paypal_order_id: "PO-FAIL",
    create_request_id: "c-f",
    created_at: new Date(now - 60000).toISOString()
  }]);
  let created = false;
  const result = await handleCreateOrder({
    body: { planCode: "monthly", idempotencyKey: "fresh-failed" },
    user: officialUser(),
    deps: {
      nowMs: () => now,
      paymentOrdersRepository: repo,
      paypalClient: {
        async createOrder() {
          created = true;
          return { id: "PO-OK" };
        }
      }
    }
  });
  assert.equal(created, true);
  assert.equal(result.body.orderId, "PO-OK");
  assert.equal(repo.rows.filter((r) => ["created", "approved", "capture_pending"].includes(r.status)).length, 1);
});

test("create-order: denied not reused", async () => {
  const now = Date.now();
  const repo = memoryRepo([{
    id: "int-d",
    user_id: "user-1",
    plan_code: "yearly",
    amount: "48.00",
    currency: "USD",
    status: "denied",
    paypal_order_id: "PO-DENY",
    create_request_id: "c-d",
    created_at: new Date(now - 60000).toISOString()
  }]);
  let created = false;
  const result = await handleCreateOrder({
    body: { planCode: "yearly", idempotencyKey: "fresh-denied" },
    user: officialUser(),
    deps: {
      nowMs: () => now,
      paymentOrdersRepository: repo,
      paypalClient: {
        async createOrder() {
          created = true;
          return { id: "PO-YEAR" };
        }
      }
    }
  });
  assert.equal(created, true);
  assert.equal(result.body.orderId, "PO-YEAR");
  assert.equal(repo.rows.find((r) => r.id === "int-d").status, "denied");
});

test("create-order: PayPal create failure marks internal order failed; retry can create new", async () => {
  const now = Date.now();
  const repo = memoryRepo([]);
  let calls = 0;
  const paypalClient = {
    async createOrder() {
      calls += 1;
      if (calls === 1) throw new Error("PAYPAL_CREATE_ORDER_FAILED");
      return { id: "PO-RETRY" };
    }
  };

  const first = await handleCreateOrder({
    body: { planCode: "monthly", idempotencyKey: "pfail" },
    user: officialUser(),
    deps: { nowMs: () => now, paymentOrdersRepository: repo, paypalClient }
  });
  assert.equal(first.statusCode, 502);
  assert.equal(first.body.error.code, "PAYPAL_CREATE_ORDER_FAILED");
  assert.equal(repo.rows[0].status, "failed");
  assert.equal(repo.rows[0].paypal_order_id, null);

  const second = await handleCreateOrder({
    body: { planCode: "monthly", idempotencyKey: "pfail" },
    user: officialUser(),
    deps: { nowMs: () => now, paymentOrdersRepository: repo, paypalClient }
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.orderId, "PO-RETRY");
  assert.equal(calls, 2);
  assert.equal(
    repo.rows.filter((r) => r.status === "created" && r.paypal_order_id === "PO-RETRY").length,
    1
  );
});

test("create-order: parallel unique race — B does not call PayPal; A creates once", async () => {
  const now = Date.now();
  const repo = memoryRepo([]);
  let paypalCalls = 0;

  const paypalClient = {
    async createOrder() {
      paypalCalls += 1;
      return { id: "PO-RACE" };
    }
  };

  // A starts creating: insert succeeds, PayPal not yet attached.
  const aCreate = repo.createPaymentOrder({
    userId: "user-1",
    planCode: "monthly",
    amount: "5.00",
    currency: "USD",
    createRequestId: "create:user-1:monthly:A"
  });
  const aRow = await aCreate;
  assert.equal(aRow.paypal_order_id, null);

  // B hits unique and must not call PayPal.
  const bResult = await handleCreateOrder({
    body: { planCode: "monthly", idempotencyKey: "B" },
    user: officialUser(),
    deps: {
      nowMs: () => now,
      paymentOrdersRepository: repo,
      paypalClient
    }
  });
  assert.equal(bResult.statusCode, 409);
  assert.equal(bResult.body.error.code, "ORDER_INITIALIZING");
  assert.equal(paypalCalls, 0);

  // A (owner of create_request_id) continues via full handler path with same key.
  // Seed is already open under A's request id — handler should find it initializing
  // when B already left it open. For A owning the row: call createOrder path by
  // using A's idempotency key after clearing... Actually A's row has create_request_id
  // create:user-1:monthly:A. handleCreateOrder with idempotencyKey A will try create
  // which returns existing A row (same request id), then A owns it and calls PayPal.
  const aResult = await handleCreateOrder({
    body: { planCode: "monthly", idempotencyKey: "A" },
    user: officialUser(),
    deps: {
      nowMs: () => now,
      paymentOrdersRepository: repo,
      paypalClient
    }
  });
  assert.equal(aResult.statusCode, 200);
  assert.equal(aResult.body.orderId, "PO-RACE");
  assert.equal(paypalCalls, 1);

  // B retries and gets same paypal_order_id; still one open.
  const bRetry = await handleCreateOrder({
    body: { planCode: "monthly", idempotencyKey: "B" },
    user: officialUser(),
    deps: {
      nowMs: () => now,
      paymentOrdersRepository: repo,
      paypalClient
    }
  });
  assert.equal(bRetry.statusCode, 200);
  assert.equal(bRetry.body.orderId, "PO-RACE");
  assert.equal(paypalCalls, 1);
  assert.equal(
    repo.rows.filter((r) => ["created", "approved", "capture_pending"].includes(r.status)).length,
    1
  );
});

test("fail_stale only affects specified user_id + plan_code", async () => {
  const now = Date.now();
  const repo = memoryRepo([
    {
      id: "u1",
      user_id: "user-1",
      plan_code: "monthly",
      amount: "5.00",
      currency: "USD",
      status: "created",
      paypal_order_id: "PO-U1",
      create_request_id: "c-u1",
      created_at: new Date(now - 20 * 60000).toISOString()
    },
    {
      id: "u2",
      user_id: "user-2",
      plan_code: "monthly",
      amount: "5.00",
      currency: "USD",
      status: "created",
      paypal_order_id: "PO-U2",
      create_request_id: "c-u2",
      created_at: new Date(now - 20 * 60000).toISOString()
    },
    {
      id: "u1y",
      user_id: "user-1",
      plan_code: "yearly",
      amount: "48.00",
      currency: "USD",
      status: "created",
      paypal_order_id: "PO-U1Y",
      create_request_id: "c-u1y",
      created_at: new Date(now - 20 * 60000).toISOString()
    }
  ]);

  await repo.failStaleOpenOrders("user-1", "monthly", 15, now);
  assert.equal(repo.rows.find((r) => r.id === "u1").status, "failed");
  assert.equal(repo.rows.find((r) => r.id === "u2").status, "created");
  assert.equal(repo.rows.find((r) => r.id === "u1y").status, "created");
});

test("capture-order: success and mismatches", async () => {
  const base = {
    id: "int-1",
    user_id: "user-1",
    plan_code: "monthly",
    amount: "5.00",
    currency: "USD",
    status: "created",
    paypal_order_id: "PO-2",
    create_request_id: "c2",
    capture_request_id: null,
    created_at: new Date().toISOString()
  };

  const okRepo = memoryRepo([{ ...base }]);
  const ok = await handleCaptureOrder({
    body: { orderId: "PO-2" },
    user: officialUser(),
    deps: {
      paymentOrdersRepository: okRepo,
      paypalMerchantId: "MERCH",
      paypalClient: {
        async captureOrder() {
          return {
            id: "PO-2",
            purchase_units: [{
              payee: { merchant_id: "MERCH" },
              payments: {
                captures: [{
                  id: "CAP-2",
                  status: "COMPLETED",
                  amount: { value: "5.00", currency_code: "USD" },
                  payee: { merchant_id: "MERCH" }
                }]
              }
            }]
          };
        }
      }
    }
  });
  assert.equal(ok.body.message, "付款正在確認");
  assert.equal(okRepo.rows[0].status, "paid");

  const mismatchRepo = memoryRepo([{ ...base, id: "int-2", paypal_order_id: "PO-3", create_request_id: "c3" }]);
  const orderMismatch = await handleCaptureOrder({
    body: { orderId: "PO-3" },
    user: officialUser(),
    deps: {
      paymentOrdersRepository: mismatchRepo,
      paypalMerchantId: "MERCH",
      paypalClient: {
        async captureOrder() {
          return {
            id: "OTHER-ORDER",
            purchase_units: [{
              payee: { merchant_id: "MERCH" },
              payments: {
                captures: [{
                  id: "CAP-3",
                  status: "COMPLETED",
                  amount: { value: "5.00", currency_code: "USD" }
                }]
              }
            }]
          };
        }
      }
    }
  });
  assert.equal(orderMismatch.body.error.code, "ORDER_MISMATCH");
  assert.equal(mismatchRepo.rows[0].status, "failed");
});

async function runWebhook(eventObj, repoResult) {
  const rawBody = JSON.stringify(eventObj);
  const calls = [];
  return handlePaypalWebhookRequest({
    rawBody,
    headers: SIG_HEADERS,
    deps: {
      paypalWebhookId: "WH",
      paypalMerchantId: "MERCH",
      paypalClient: mockVerifyClient(rawBody),
      webhookRepository: {
        async processWebhookEvent(input) {
          calls.push(input);
          if (typeof repoResult === "function") return repoResult(input);
          return repoResult;
        }
      }
    }
  }).then((result) => ({ result, calls }));
}

test("webhook: completed missing capture id -> rejected 200", async () => {
  const { result, calls } = await runWebhook(completedEvent({
    resource: {
      id: "",
      amount: { value: "5.00", currency_code: "USD" },
      payee: { merchant_id: "MERCH" },
      supplementary_data: { related_ids: { order_id: "PO-1" } }
    }
  }), (input) => {
    if (!input.paypalCaptureId) {
      return { outcome: "rejected", error_message: "MISSING_PAYPAL_CAPTURE_ID", event_processing_status: "failed" };
    }
    return { outcome: "processed", order_status: "paid" };
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.outcome, "rejected");
  assert.ok(calls[0]);
});

test("webhook: amount null and mismatch -> rejected 200", async () => {
  const nullAmt = await runWebhook(completedEvent({
    resource: {
      id: "CAP-1",
      amount: { value: null, currency_code: "USD" },
      payee: { merchant_id: "MERCH" },
      supplementary_data: { related_ids: { order_id: "PO-1" } }
    }
  }), () => ({ outcome: "rejected", error_message: "MISSING_AMOUNT", event_processing_status: "failed" }));
  assert.equal(nullAmt.result.body.outcome, "rejected");

  const mismatch = await runWebhook(completedEvent({
    resource: {
      id: "CAP-1",
      amount: { value: "9.99", currency_code: "USD" },
      payee: { merchant_id: "MERCH" },
      supplementary_data: { related_ids: { order_id: "PO-1" } }
    }
  }), () => ({ outcome: "rejected", error_message: "AMOUNT_MISMATCH", event_processing_status: "failed" }));
  assert.equal(mismatch.result.statusCode, 200);
  assert.equal(mismatch.result.body.error, "AMOUNT_MISMATCH");
});

test("webhook: currency null and mismatch -> rejected 200", async () => {
  const nullCur = await runWebhook(completedEvent({
    resource: {
      id: "CAP-1",
      amount: { value: "5.00", currency_code: null },
      payee: { merchant_id: "MERCH" },
      supplementary_data: { related_ids: { order_id: "PO-1" } }
    }
  }), () => ({ outcome: "rejected", error_message: "MISSING_CURRENCY", event_processing_status: "failed" }));
  assert.equal(nullCur.result.body.outcome, "rejected");

  const mismatch = await runWebhook(completedEvent({
    resource: {
      id: "CAP-1",
      amount: { value: "5.00", currency_code: "TWD" },
      payee: { merchant_id: "MERCH" },
      supplementary_data: { related_ids: { order_id: "PO-1" } }
    }
  }), () => ({ outcome: "rejected", error_message: "CURRENCY_MISMATCH", event_processing_status: "failed" }));
  assert.equal(mismatch.result.body.error, "CURRENCY_MISMATCH");
});

test("webhook: merchant null and mismatch -> rejected 200", async () => {
  const nullMerch = await runWebhook(completedEvent({
    resource: {
      id: "CAP-1",
      amount: { value: "5.00", currency_code: "USD" },
      payee: {},
      supplementary_data: { related_ids: { order_id: "PO-1" } }
    }
  }), () => ({ outcome: "rejected", error_message: "MISSING_ACTUAL_MERCHANT", event_processing_status: "failed" }));
  assert.equal(nullMerch.result.body.outcome, "rejected");

  const mismatch = await runWebhook(completedEvent({
    resource: {
      id: "CAP-1",
      amount: { value: "5.00", currency_code: "USD" },
      payee: { merchant_id: "OTHER" },
      supplementary_data: { related_ids: { order_id: "PO-1" } }
    }
  }), (input) => {
    assert.equal(input.actualMerchantId, "OTHER");
    assert.equal(input.expectedMerchantId, "MERCH");
    return { outcome: "rejected", error_message: "MERCHANT_MISMATCH", event_processing_status: "failed" };
  });
  assert.equal(mismatch.result.body.error, "MERCHANT_MISMATCH");
});

test("webhook: order mismatch / missing related order -> rejected", async () => {
  const { result } = await runWebhook(completedEvent({
    resource: {
      id: "CAP-1",
      amount: { value: "5.00", currency_code: "USD" },
      payee: { merchant_id: "MERCH" },
      supplementary_data: { related_ids: {} }
    }
  }), () => ({ outcome: "rejected", error_message: "MISSING_PAYPAL_ORDER_ID", event_processing_status: "failed" }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.outcome, "rejected");
});

test("webhook: capture ID conflict -> rejected 200", async () => {
  const { result } = await runWebhook(completedEvent(), () => ({
    outcome: "rejected",
    error_message: "CAPTURE_ID_REUSED",
    event_processing_status: "failed"
  }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.error, "CAPTURE_ID_REUSED");
});

test("webhook: duplicate completed -> 2xx no reprocess side effects", async () => {
  let n = 0;
  const { result } = await runWebhook(completedEvent(), () => {
    n += 1;
    return n === 1
      ? { outcome: "processed", order_status: "paid" }
      : { outcome: "duplicate", event_processing_status: "processed" };
  });
  assert.equal(result.body.outcome, "processed");

  const second = await runWebhook(completedEvent(), () => ({
    outcome: "duplicate",
    event_processing_status: "processed"
  }));
  assert.equal(second.result.statusCode, 200);
  assert.equal(second.result.body.outcome, "duplicate");
});

/**
 * In-memory webhook processor mirroring RPC transition rules
 * (not a fixed stub returning paid).
 */
function createStatefulWebhookRepo(orderSeed) {
  const orders = memoryRepo([orderSeed]);
  const events = new Set();
  const TARGET = {
    "PAYMENT.CAPTURE.COMPLETED": "paid",
    "PAYMENT.CAPTURE.PENDING": "capture_pending",
    "PAYMENT.CAPTURE.DENIED": "denied",
    "PAYMENT.CAPTURE.REFUNDED": "refunded",
    "PAYMENT.CAPTURE.REVERSED": "reversed",
    "CHECKOUT.ORDER.APPROVED": "approved"
  };

  return {
    orders,
    async processWebhookEvent(input) {
      if (events.has(input.paypalEventId)) {
        return { outcome: "duplicate", event_processing_status: "processed" };
      }
      events.add(input.paypalEventId);

      const target = TARGET[input.eventType];
      if (!target) {
        return { outcome: "ignored", event_processing_status: "ignored" };
      }

      const order = await orders.findByPaypalOrderId(input.paypalOrderId);
      if (!order) {
        return { outcome: "rejected", error_message: "ORDER_NOT_FOUND", event_processing_status: "failed" };
      }

      if (target === "paid") {
        if (!input.paypalCaptureId || input.expectedAmount == null || !input.expectedCurrency
          || !input.actualMerchantId || !input.expectedMerchantId
          || String(input.actualMerchantId) !== String(input.expectedMerchantId)
          || !amountsEqual(input.expectedAmount, order.amount)
          || String(input.expectedCurrency).toUpperCase() !== String(order.currency).toUpperCase()) {
          return { outcome: "rejected", error_message: "VALIDATION_FAILED", event_processing_status: "failed", order_status: order.status };
        }
      }

      try {
        await orders.transitionStatus(order.id, target, input.paypalCaptureId || null, null);
      } catch (error) {
        if (String(error.message).includes("STATUS_REGRESSION_FORBIDDEN")) {
          // Mirror RPC: record processed without regressing.
          return { outcome: "processed", order_status: order.status, event_processing_status: "processed" };
        }
        throw error;
      }

      const updated = await orders.findByPaypalOrderId(input.paypalOrderId);
      return { outcome: "processed", order_status: updated.status, event_processing_status: "processed" };
    }
  };
}

async function runStatefulWebhook(eventObj, orderSeed) {
  const rawBody = JSON.stringify(eventObj);
  const repo = createStatefulWebhookRepo(orderSeed);
  const result = await handlePaypalWebhookRequest({
    rawBody,
    headers: SIG_HEADERS,
    deps: {
      paypalWebhookId: "WH",
      paypalMerchantId: "MERCH",
      paypalClient: mockVerifyClient(rawBody),
      webhookRepository: repo
    }
  });
  return { result, repo };
}

const paidSeed = {
  id: "int-paid",
  user_id: "user-1",
  plan_code: "monthly",
  amount: "5.00",
  currency: "USD",
  status: "paid",
  paypal_order_id: "PO-1",
  paypal_capture_id: "CAP-1",
  create_request_id: "c-paid",
  created_at: new Date().toISOString()
};

test("state: paid then CHECKOUT.ORDER.APPROVED does not regress", async () => {
  const { result, repo } = await runStatefulWebhook({
    id: "EVT-APP",
    event_type: "CHECKOUT.ORDER.APPROVED",
    resource: {
      id: "PO-1",
      purchase_units: [{ amount: { value: "5.00", currency_code: "USD" }, payee: { merchant_id: "MERCH" } }]
    }
  }, { ...paidSeed });
  assert.equal(result.statusCode, 200);
  assert.equal(repo.orders.rows[0].status, "paid");
});

test("state: paid then PAYMENT.CAPTURE.PENDING does not regress", async () => {
  const { result, repo } = await runStatefulWebhook({
    id: "EVT-PEND",
    event_type: "PAYMENT.CAPTURE.PENDING",
    resource: {
      id: "CAP-1",
      amount: { value: "5.00", currency_code: "USD" },
      payee: { merchant_id: "MERCH" },
      supplementary_data: { related_ids: { order_id: "PO-1" } }
    }
  }, { ...paidSeed });
  assert.equal(result.statusCode, 200);
  assert.equal(repo.orders.rows[0].status, "paid");
});

test("state: refunded then PAYMENT.CAPTURE.COMPLETED does not return to paid", async () => {
  const { result, repo } = await runStatefulWebhook(completedEvent({ id: "EVT-REF-DONE" }), {
    ...paidSeed,
    status: "refunded",
    id: "int-ref"
  });
  assert.equal(result.statusCode, 200);
  assert.equal(repo.orders.rows[0].status, "refunded");
  assert.notEqual(repo.orders.rows[0].status, "paid");
});

test("state: reversed then PAYMENT.CAPTURE.COMPLETED does not return to paid", async () => {
  const { result, repo } = await runStatefulWebhook(completedEvent({ id: "EVT-REV-DONE" }), {
    ...paidSeed,
    status: "reversed",
    id: "int-rev"
  });
  assert.equal(result.statusCode, 200);
  assert.equal(repo.orders.rows[0].status, "reversed");
  assert.notEqual(repo.orders.rows[0].status, "paid");
});

test("webhook: verify failure does not call repo", async () => {
  let called = false;
  const result = await handlePaypalWebhookRequest({
    rawBody: "{}",
    headers: SIG_HEADERS,
    deps: {
      paypalWebhookId: "WH",
      paypalMerchantId: "MERCH",
      paypalClient: {
        async verifyWebhookSignature() {
          return { verification_status: "FAILURE" };
        }
      },
      webhookRepository: {
        async processWebhookEvent() {
          called = true;
        }
      }
    }
  });
  assert.equal(result.statusCode, 401);
  assert.equal(called, false);
});

test("webhook: DB failure returns 503", async () => {
  const result = await handlePaypalWebhookRequest({
    rawBody: JSON.stringify(completedEvent()),
    headers: SIG_HEADERS,
    deps: {
      paypalWebhookId: "WH",
      paypalMerchantId: "MERCH",
      paypalClient: mockVerifyClient(JSON.stringify(completedEvent())),
      webhookRepository: {
        async processWebhookEvent() {
          throw new Error("db down");
        }
      }
    }
  });
  assert.equal(result.statusCode, 503);
});

test("amountsEqual", () => {
  assert.equal(amountsEqual("5.00", 5), true);
  assert.equal(amountsEqual("5.00", "5.01"), false);
});

test("normalizeMerchantId trims and uppercases", () => {
  assert.equal(normalizeMerchantId("  merch "), "MERCH");
  assert.equal(normalizeMerchantId(""), null);
  assert.equal(normalizeMerchantId(null), null);
});

test("createPaypalClient uses Prefer representation and mock fetch only", async () => {
  const seen = [];
  const client = createPaypalClient({
    clientId: "c",
    clientSecret: "s",
    fetchImpl: async (url, init = {}) => {
      seen.push({ url: String(url), headers: init.headers || {}, method: init.method || "GET" });
      if (String(url).includes("oauth2")) {
        return { ok: true, async json() { return { access_token: "t", expires_in: 300 }; } };
      }
      return { ok: true, async json() { return { id: "O1" }; } };
    }
  });
  const order = await client.createOrder({
    amount: "5.00",
    currency: "USD",
    planCode: "monthly",
    planName: "月方案",
    requestId: "r1"
  });
  assert.equal(order.id, "O1");
  const createCall = seen.find((c) => c.url.includes("/v2/checkout/orders") && c.method === "POST");
  assert.ok(createCall);
  assert.equal(createCall.headers.Prefer, "return=representation");
  assert.equal(createCall.headers["PayPal-Request-Id"], "r1");
  assert.ok(createCall.headers.Authorization);

  await client.captureOrder({ orderId: "O1", requestId: "cap-1" });
  const captureCall = seen.find((c) => String(c.url).includes("/capture"));
  assert.ok(captureCall);
  assert.equal(captureCall.headers.Prefer, "return=representation");
  assert.equal(captureCall.headers["PayPal-Request-Id"], "cap-1");

  await client.getOrder({ orderId: "O1" });
  const getCall = seen.find((c) => c.method === "GET" && c.url.includes("/v2/checkout/orders/O1"));
  assert.ok(getCall);
  assert.equal(getCall.headers.Prefer, "return=representation");
});

test("07B.2.4C: sanitize helper keeps only allowed PayPal error fields", () => {
  const details = buildSanitizedPaypalErrorDetails({
    stage: "create_order",
    status: 422,
    paypalJson: {
      name: "INVALID_REQUEST",
      message: "Request is not well-formed, syntactically incorrect, or violates schema.",
      debug_id: "dbg-123",
      details: [{ issue: "INVALID_PARAMETER_VALUE", description: "secret payer email user@example.com" }],
      access_token: "should-not-leak",
      links: [{ href: "https://api.paypal.com" }]
    }
  });
  assert.equal(details.stage, "create_order");
  assert.equal(details.status, 422);
  assert.equal(details.paypalName, "INVALID_REQUEST");
  assert.equal(details.paypalIssue, "INVALID_PARAMETER_VALUE");
  assert.equal(details.debugId, "dbg-123");
  assert.equal(details.bodyOmitted, false);
  assert.equal(Object.prototype.hasOwnProperty.call(details, "access_token"), false);
  assert.equal(JSON.stringify(details).includes("user@example.com"), false);
  assert.equal(JSON.stringify(details).includes("should-not-leak"), false);
});

test("07B.2.4C: non-JSON PayPal response records bodyOmitted only", () => {
  const details = buildSanitizedPaypalErrorDetails({
    stage: "oauth",
    status: 502,
    contentType: "text/html",
    bodyOmitted: true
  });
  assert.equal(details.bodyOmitted, true);
  assert.equal(details.contentType, "text/html");
  assert.equal(details.paypalName, null);
  assert.equal(details.paypalIssue, null);
  assert.equal(details.debugId, null);
});

test("07B.2.4C: OAuth failure returns PAYPAL_OAUTH_FAILED with sanitized details", async () => {
  const now = Date.now();
  const repo = memoryRepo([]);
  const client = createPaypalClient({
    clientId: "c",
    clientSecret: "s",
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      headers: { get: () => "application/json" },
      async text() {
        return JSON.stringify({
          name: "AUTHENTICATION_FAILURE",
          message: "Authentication failed due to invalid authentication credentials.",
          debug_id: "oauth-dbg",
          details: [{ issue: "CLIENT_AUTHENTICATION_FAILED", description: "client secret wrong" }]
        });
      },
      async json() { throw new Error("should use text()"); }
    })
  });

  const result = await handleCreateOrder({
    body: { planCode: "monthly", idempotencyKey: "oauth-fail" },
    user: officialUser(),
    deps: { nowMs: () => now, paymentOrdersRepository: repo, paypalClient: client }
  });
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.code, "PAYPAL_OAUTH_FAILED");
  assert.equal(result.body.error.details.stage, "oauth");
  assert.equal(result.body.error.details.status, 401);
  assert.equal(result.body.error.details.paypalName, "AUTHENTICATION_FAILURE");
  assert.equal(result.body.error.details.paypalIssue, "CLIENT_AUTHENTICATION_FAILED");
  assert.equal(result.body.error.details.debugId, "oauth-dbg");
  assert.equal(JSON.stringify(result.body).includes("client secret"), false);
  assert.equal(repo.rows[0].status, "failed");
});

test("07B.2.4C: Create Order failure returns PAYPAL_CREATE_ORDER_FAILED with sanitized details", async () => {
  const now = Date.now();
  const repo = memoryRepo([]);
  const client = createPaypalClient({
    clientId: "c",
    clientSecret: "s",
    fetchImpl: async (url) => {
      if (String(url).includes("oauth2")) {
        return {
          ok: true,
          status: 200,
          async json() { return { access_token: "t", expires_in: 300 }; },
          async text() { return ""; }
        };
      }
      return {
        ok: false,
        status: 400,
        headers: { get: () => "application/json" },
        async text() {
          return JSON.stringify({
            name: "INVALID_REQUEST",
            message: "Invalid request.",
            debug_id: "create-dbg",
            details: [{ issue: "INVALID_PARAMETER_SYNTAX", description: "payer email alice@example.com" }],
            access_token: "leak"
          });
        }
      };
    }
  });

  const result = await handleCreateOrder({
    body: { planCode: "monthly", idempotencyKey: "create-fail" },
    user: officialUser(),
    deps: { nowMs: () => now, paymentOrdersRepository: repo, paypalClient: client }
  });
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.code, "PAYPAL_CREATE_ORDER_FAILED");
  assert.equal(result.body.error.details.stage, "create_order");
  assert.equal(result.body.error.details.status, 400);
  assert.equal(result.body.error.details.paypalName, "INVALID_REQUEST");
  assert.equal(result.body.error.details.paypalIssue, "INVALID_PARAMETER_SYNTAX");
  assert.equal(result.body.error.details.debugId, "create-dbg");
  assert.equal(JSON.stringify(result.body).includes("alice@example.com"), false);
  assert.equal(JSON.stringify(result.body).includes("leak"), false);
  assert.equal(repo.rows[0].status, "failed");
  assert.equal(repo.rows[0].paypal_order_id, null);
});

test("07B.2.4C.1: Create Order 2xx without id -> PAYPAL_CREATE_ORDER_INVALID_RESPONSE", async () => {
  const now = Date.now();
  const repo = memoryRepo([]);
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => {
    logs.push(args.map((a) => String(a)).join(" "));
  };

  try {
    const client = createPaypalClient({
      clientId: "c",
      clientSecret: "s",
      fetchImpl: async (url) => {
        if (String(url).includes("oauth2")) {
          return {
            ok: true,
            status: 200,
            async json() { return { access_token: "tok-secret", expires_in: 300 }; }
          };
        }
        return {
          ok: true,
          status: 201,
          async json() {
            return {
              status: "CREATED",
              // intentionally no id
              purchase_units: [{ amount: { value: "5.00" } }],
              payer: { email_address: "buyer@example.com" },
              access_token: "should-not-leak"
            };
          }
        };
      }
    });

    const result = await handleCreateOrder({
      body: { planCode: "monthly", idempotencyKey: "missing-id" },
      user: officialUser(),
      deps: { nowMs: () => now, paymentOrdersRepository: repo, paypalClient: client }
    });

    assert.equal(result.statusCode, 502);
    assert.equal(result.body.error.code, "PAYPAL_CREATE_ORDER_INVALID_RESPONSE");
    assert.equal(
      result.body.error.message,
      "PayPal create order returned an invalid response."
    );
    assert.equal(result.body.error.details.stage, "create_order");
    assert.equal(result.body.error.details.status, 201);
    assert.equal(result.body.error.details.paypalName, "INVALID_RESPONSE");
    assert.equal(result.body.error.details.paypalIssue, "MISSING_ORDER_ID");
    assert.equal(JSON.stringify(result.body).includes("buyer@example.com"), false);
    assert.equal(JSON.stringify(result.body).includes("tok-secret"), false);
    assert.equal(JSON.stringify(result.body).includes("should-not-leak"), false);
    assert.equal(repo.rows[0].status, "failed");
    assert.equal(repo.rows[0].paypal_order_id, null);

    const joined = logs.join("\n");
    assert.match(joined, /paypal_checkout_create_failed/);
    assert.match(joined, /PAYPAL_CREATE_ORDER_INVALID_RESPONSE/);
    assert.equal(joined.includes("buyer@example.com"), false);
    assert.equal(joined.includes("tok-secret"), false);
    assert.equal(joined.includes("should-not-leak"), false);
    assert.equal(joined.includes("purchase_units"), false);
  } finally {
    console.error = originalError;
  }
});

function captureBaseRow(overrides = {}) {
  return {
    id: "int-cap",
    user_id: "user-1",
    plan_code: "monthly",
    amount: "5.00",
    currency: "USD",
    status: "created",
    paypal_order_id: "PO-CAP",
    create_request_id: "c-cap",
    capture_request_id: null,
    paypal_capture_id: null,
    created_at: new Date().toISOString(),
    ...overrides
  };
}

function fullCaptureRepresentation(overrides = {}) {
  return {
    id: "PO-CAP",
    purchase_units: [{
      payee: { merchant_id: "MERCH" },
      payments: {
        captures: [{
          id: "CAP-OK",
          status: "COMPLETED",
          amount: { value: "5.00", currency_code: "USD" },
          ...overrides.capture
        }]
      },
      ...overrides.unit
    }],
    ...overrides.root
  };
}

function sparseCaptureWithoutPayee() {
  return {
    id: "PO-CAP",
    purchase_units: [{
      payments: {
        captures: [{
          id: "CAP-OK",
          status: "COMPLETED",
          amount: { value: "5.00", currency_code: "USD" }
        }]
      }
    }]
  };
}

test("07B.2.3: full representation capture succeeds without GET", async () => {
  const repo = memoryRepo([captureBaseRow()]);
  let getCalls = 0;
  const result = await handleCaptureOrder({
    body: { orderId: "PO-CAP" },
    user: officialUser(),
    deps: {
      paymentOrdersRepository: repo,
      paypalMerchantId: "MERCH",
      paypalClient: {
        async captureOrder() { return fullCaptureRepresentation(); },
        async getOrder() { getCalls += 1; throw new Error("should not GET"); }
      }
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "paid");
  assert.equal(repo.rows[0].status, "paid");
  assert.equal(getCalls, 0);
});

test("07B.2.3: sparse capture missing payee uses GET Order fallback", async () => {
  const repo = memoryRepo([captureBaseRow({ id: "int-sparse", paypal_order_id: "PO-SP", create_request_id: "c-sp" })]);
  let captureCalls = 0;
  let getCalls = 0;
  const result = await handleCaptureOrder({
    body: { orderId: "PO-SP" },
    user: officialUser(),
    deps: {
      paymentOrdersRepository: repo,
      paypalMerchantId: "MERCH",
      paypalClient: {
        async captureOrder() {
          captureCalls += 1;
          return {
            id: "PO-SP",
            purchase_units: [{
              payments: {
                captures: [{
                  id: "CAP-SP",
                  status: "COMPLETED",
                  amount: { value: "5.00", currency_code: "USD" }
                }]
              }
            }]
          };
        },
        async getOrder() {
          getCalls += 1;
          return {
            id: "PO-SP",
            purchase_units: [{
              payee: { merchant_id: "MERCH" },
              payments: {
                captures: [{
                  id: "CAP-SP",
                  status: "COMPLETED",
                  amount: { value: "5.00", currency_code: "USD" }
                }]
              }
            }]
          };
        }
      }
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "paid");
  assert.equal(repo.rows[0].status, "paid");
  assert.equal(captureCalls, 1);
  assert.equal(getCalls, 1);
});

test("07B.2.3: sparse capture + GET temporary failure keeps capture_pending", async () => {
  const repo = memoryRepo([captureBaseRow({ id: "int-pend", paypal_order_id: "PO-PEND", create_request_id: "c-pend" })]);
  const result = await handleCaptureOrder({
    body: { orderId: "PO-PEND" },
    user: officialUser(),
    deps: {
      paymentOrdersRepository: repo,
      paypalMerchantId: "MERCH",
      paypalClient: {
        async captureOrder() { return sparseCaptureWithoutPayee(); },
        async getOrder() { throw new Error("PAYPAL_GET_ORDER_FAILED"); }
      }
    }
  });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.error.code, "PAYPAL_ORDER_LOOKUP_FAILED");
  assert.equal(result.body.error.details.reason, "MERCHANT_ID_MISSING_FROM_CAPTURE_RESPONSE");
  assert.equal(repo.rows[0].status, "capture_pending");
  assert.notEqual(repo.rows[0].status, "failed");
});

test("07B.2.3: GET Order different merchant -> MERCHANT_MISMATCH", async () => {
  const repo = memoryRepo([captureBaseRow({ id: "int-mm", paypal_order_id: "PO-MM", create_request_id: "c-mm" })]);
  const result = await handleCaptureOrder({
    body: { orderId: "PO-MM" },
    user: officialUser(),
    deps: {
      paymentOrdersRepository: repo,
      paypalMerchantId: "MERCH",
      paypalClient: {
        async captureOrder() { return sparseCaptureWithoutPayee(); },
        async getOrder() {
          return {
            id: "PO-MM",
            purchase_units: [{
              payee: { merchant_id: "OTHER" },
              payments: {
                captures: [{
                  id: "CAP-MM",
                  status: "COMPLETED",
                  amount: { value: "5.00", currency_code: "USD" }
                }]
              }
            }]
          };
        }
      }
    }
  });
  assert.equal(result.body.error.code, "MERCHANT_MISMATCH");
  assert.equal(repo.rows[0].status, "failed");
});

test("07B.2.3: merchant id case/whitespace normalize as equal", async () => {
  const repo = memoryRepo([captureBaseRow({ id: "int-norm", paypal_order_id: "PO-NORM", create_request_id: "c-norm" })]);
  const result = await handleCaptureOrder({
    body: { orderId: "PO-NORM" },
    user: officialUser(),
    deps: {
      paymentOrdersRepository: repo,
      paypalMerchantId: "  merch ",
      paypalClient: {
        async captureOrder() {
          return {
            id: "PO-NORM",
            purchase_units: [{
              payee: { merchant_id: "Merch" },
              payments: {
                captures: [{
                  id: "CAP-NORM",
                  status: "COMPLETED",
                  amount: { value: "5.00", currency_code: "USD" }
                }]
              }
            }]
          };
        }
      }
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "paid");
  assert.equal(repo.rows[0].status, "paid");
});

test("07B.2.3: GET Order amount mismatch rejects paid", async () => {
  const repo = memoryRepo([captureBaseRow({ id: "int-amt", paypal_order_id: "PO-AMT", create_request_id: "c-amt" })]);
  const result = await handleCaptureOrder({
    body: { orderId: "PO-AMT" },
    user: officialUser(),
    deps: {
      paymentOrdersRepository: repo,
      paypalMerchantId: "MERCH",
      paypalClient: {
        async captureOrder() {
          return {
            id: "PO-AMT",
            purchase_units: [{
              payments: {
                captures: [{ id: "CAP-AMT", status: "COMPLETED" }]
              }
            }]
          };
        },
        async getOrder() {
          return {
            id: "PO-AMT",
            purchase_units: [{
              payee: { merchant_id: "MERCH" },
              payments: {
                captures: [{
                  id: "CAP-AMT",
                  status: "COMPLETED",
                  amount: { value: "9.99", currency_code: "USD" }
                }]
              }
            }]
          };
        }
      }
    }
  });
  assert.equal(result.body.error.code, "AMOUNT_MISMATCH");
  assert.equal(repo.rows[0].status, "failed");
});

test("07B.2.3: GET Order currency mismatch rejects paid", async () => {
  const repo = memoryRepo([captureBaseRow({ id: "int-cur", paypal_order_id: "PO-CUR", create_request_id: "c-cur" })]);
  const result = await handleCaptureOrder({
    body: { orderId: "PO-CUR" },
    user: officialUser(),
    deps: {
      paymentOrdersRepository: repo,
      paypalMerchantId: "MERCH",
      paypalClient: {
        async captureOrder() {
          return {
            id: "PO-CUR",
            purchase_units: [{
              payments: {
                captures: [{ id: "CAP-CUR", status: "COMPLETED" }]
              }
            }]
          };
        },
        async getOrder() {
          return {
            id: "PO-CUR",
            purchase_units: [{
              payee: { merchant_id: "MERCH" },
              payments: {
                captures: [{
                  id: "CAP-CUR",
                  status: "COMPLETED",
                  amount: { value: "5.00", currency_code: "TWD" }
                }]
              }
            }]
          };
        }
      }
    }
  });
  assert.equal(result.body.error.code, "AMOUNT_MISMATCH");
  assert.equal(repo.rows[0].status, "failed");
});

test("07B.2.3: signed webhook can move capture_pending to paid", async () => {
  const repo = memoryRepo([captureBaseRow({
    id: "int-wh",
    paypal_order_id: "PO-WH",
    create_request_id: "c-wh",
    status: "capture_pending",
    paypal_capture_id: "CAP-WH",
    capture_request_id: "capture:int-wh"
  })]);

  const { result } = await runWebhook(completedEvent({
    resource: {
      id: "CAP-WH",
      amount: { value: "5.00", currency_code: "USD" },
      payee: { merchant_id: "MERCH" },
      supplementary_data: { related_ids: { order_id: "PO-WH" } }
    }
  }), async (input) => {
    assert.equal(input.paypalOrderId, "PO-WH");
    assert.equal(input.paypalCaptureId, "CAP-WH");
    const row = repo.rows.find((r) => r.paypal_order_id === "PO-WH");
    row.status = "paid";
    row.paypal_capture_id = input.paypalCaptureId;
    return { outcome: "processed", order_status: "paid", order_id: row.id };
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.outcome, "processed");
  assert.equal(repo.rows[0].status, "paid");
});

test("07B.2.3: retry after capture id recorded does not call Capture again", async () => {
  const repo = memoryRepo([captureBaseRow({
    id: "int-retry",
    paypal_order_id: "PO-RETRY",
    create_request_id: "c-retry",
    status: "capture_pending",
    paypal_capture_id: "CAP-RETRY",
    capture_request_id: "capture:int-retry"
  })]);
  let captureCalls = 0;
  let getCalls = 0;
  const result = await handleCaptureOrder({
    body: { orderId: "PO-RETRY" },
    user: officialUser(),
    deps: {
      paymentOrdersRepository: repo,
      paypalMerchantId: "MERCH",
      paypalClient: {
        async captureOrder() {
          captureCalls += 1;
          throw new Error("should not capture again");
        },
        async getOrder() {
          getCalls += 1;
          return {
            id: "PO-RETRY",
            purchase_units: [{
              payee: { merchant_id: "MERCH" },
              payments: {
                captures: [{
                  id: "CAP-RETRY",
                  status: "COMPLETED",
                  amount: { value: "5.00", currency_code: "USD" }
                }]
              }
            }]
          };
        }
      }
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "paid");
  assert.equal(captureCalls, 0);
  assert.equal(getCalls, 1);
});
