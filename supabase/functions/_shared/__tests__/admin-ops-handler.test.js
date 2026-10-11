"use strict";

/**
 * PROD-RELEASE-DAY3C (line 151-198): minimal admin backend handler tests
 * (mock repo only, no real DB).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handleAdminOpsRequest,
  handleListPendingRefunds,
  handleReviewRefund,
  handleConfirmRefundSuccess,
  handleListShippableGifts,
  handleMarkShipped
} = require("../admin-ops-handler");

function adminUser() {
  return { id: "admin-1" };
}

function plainUser() {
  return { id: "user-1" };
}

function fakeRepo({
  isAdmin = true,
  pendingRefunds = [],
  shippableGifts = [],
  reviewThrows = null,
  confirmThrows = null,
  markShippedThrows = null
} = {}) {
  return {
    calls: { isAdminUser: [], reviewRefund: [], confirmRefundSuccess: [], markShipped: [] },
    async isAdminUser(userId) {
      this.calls.isAdminUser.push(userId);
      return isAdmin;
    },
    async listPendingRefunds() {
      return pendingRefunds;
    },
    async reviewRefund(input) {
      this.calls.reviewRefund.push(input);
      if (reviewThrows) throw new Error(reviewThrows);
      return { request_id: input.requestId, status: input.decision };
    },
    async confirmRefundSuccess(input) {
      this.calls.confirmRefundSuccess.push(input);
      if (confirmThrows) throw new Error(confirmThrows);
      return { request_id: input.requestId, refund_success: true };
    },
    async listShippableGifts() {
      return shippableGifts;
    },
    async markShipped(input) {
      this.calls.markShipped.push(input);
      if (markShippedThrows) throw new Error(markShippedThrows);
      return { entitlement_id: input.entitlementId, status: "shipped" };
    }
  };
}

test("every action: non-admin gets a generic 403 FORBIDDEN, repo business methods never called", async () => {
  const repo = fakeRepo({ isAdmin: false });
  const result = await handleListPendingRefunds({ user: plainUser(), deps: { repository: repo } });
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, "FORBIDDEN");
  assert.deepEqual(repo.calls.isAdminUser, ["user-1"]);
});

test("every action: no authenticated user gets 401 AUTH_REQUIRED, admin check never runs", async () => {
  const repo = fakeRepo();
  const result = await handleListPendingRefunds({ user: null, deps: { repository: repo } });
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error.code, "AUTH_REQUIRED");
  assert.deepEqual(repo.calls.isAdminUser, []);
});

test("handleListPendingRefunds: admin gets the real list", async () => {
  const repo = fakeRepo({ pendingRefunds: [{ id: "r-1", status: "pending" }] });
  const result = await handleListPendingRefunds({ user: adminUser(), deps: { repository: repo } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.refund_requests, [{ id: "r-1", status: "pending" }]);
});

test("handleReviewRefund: requestId and decision required", async () => {
  const repo = fakeRepo();
  const result = await handleReviewRefund({ body: {}, user: adminUser(), deps: { repository: repo } });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, "INVALID_REQUEST");
});

test("handleReviewRefund: forwards admin userId + requestId + decision + note", async () => {
  const repo = fakeRepo();
  const result = await handleReviewRefund({
    body: { requestId: "r-1", decision: "approved", note: "ok" },
    user: adminUser(),
    deps: { repository: repo }
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(repo.calls.reviewRefund[0], {
    adminUserId: "admin-1",
    requestId: "r-1",
    decision: "approved",
    note: "ok"
  });
});

test("handleReviewRefund: INVALID_DECISION / REFUND_REQUEST_NOT_PENDING map correctly", async () => {
  const repoA = fakeRepo({ reviewThrows: "INVALID_DECISION" });
  const a = await handleReviewRefund({ body: { requestId: "r-1", decision: "maybe" }, user: adminUser(), deps: { repository: repoA } });
  assert.equal(a.statusCode, 400);
  assert.equal(a.body.error.code, "INVALID_DECISION");

  const repoB = fakeRepo({ reviewThrows: "REFUND_REQUEST_NOT_PENDING" });
  const b = await handleReviewRefund({ body: { requestId: "r-1", decision: "approved" }, user: adminUser(), deps: { repository: repoB } });
  assert.equal(b.statusCode, 409);
  assert.equal(b.body.error.code, "REFUND_REQUEST_NOT_PENDING");
});

test("handleConfirmRefundSuccess: requestId and paypalRefundId required; never calls the repository without both", async () => {
  const repo = fakeRepo();
  const result = await handleConfirmRefundSuccess({ body: { requestId: "r-1" }, user: adminUser(), deps: { repository: repo } });
  assert.equal(result.statusCode, 400);
  assert.deepEqual(repo.calls.confirmRefundSuccess, []);
});

test("handleConfirmRefundSuccess: success forwards exact fields, returns refund_success:true", async () => {
  const repo = fakeRepo();
  const result = await handleConfirmRefundSuccess({
    body: { requestId: "r-1", paypalRefundId: "RF-123" },
    user: adminUser(),
    deps: { repository: repo }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.refund_success, true);
  assert.deepEqual(repo.calls.confirmRefundSuccess[0], {
    adminUserId: "admin-1",
    requestId: "r-1",
    paypalRefundId: "RF-123"
  });
});

test("handleConfirmRefundSuccess: REFUND_REQUEST_NOT_APPROVED / REFUND_ALREADY_CONFIRMED / REFUND_RECORD_REQUIRED map to expected statuses", async () => {
  const cases = [
    ["REFUND_REQUEST_NOT_APPROVED", 409],
    ["REFUND_ALREADY_CONFIRMED", 409],
    ["REFUND_RECORD_REQUIRED", 400]
  ];
  for (const [code, status] of cases) {
    const repo = fakeRepo({ confirmThrows: code });
    const result = await handleConfirmRefundSuccess({
      body: { requestId: "r-1", paypalRefundId: "RF-1" },
      user: adminUser(),
      deps: { repository: repo }
    });
    assert.equal(result.statusCode, status, code);
    assert.equal(result.body.error.code, code);
  }
});

test("handleListShippableGifts: admin gets the real list", async () => {
  const repo = fakeRepo({ shippableGifts: [{ id: "g-1", status: "awaiting_shipment" }] });
  const result = await handleListShippableGifts({ user: adminUser(), deps: { repository: repo } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.gifts, [{ id: "g-1", status: "awaiting_shipment" }]);
});

test("handleMarkShipped: entitlementId and trackingNumber required", async () => {
  const repo = fakeRepo();
  const result = await handleMarkShipped({ body: { entitlementId: "g-1" }, user: adminUser(), deps: { repository: repo } });
  assert.equal(result.statusCode, 400);
  assert.deepEqual(repo.calls.markShipped, []);
});

test("handleMarkShipped: success forwards exact fields", async () => {
  const repo = fakeRepo();
  const result = await handleMarkShipped({
    body: { entitlementId: "g-1", trackingNumber: "RR123456789TW" },
    user: adminUser(),
    deps: { repository: repo }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "shipped");
  assert.deepEqual(repo.calls.markShipped[0], {
    adminUserId: "admin-1",
    entitlementId: "g-1",
    trackingNumber: "RR123456789TW"
  });
});

test("handleMarkShipped: SHIPMENT_NOT_READY / SHIPMENT_HELD_BY_REFUND_REQUEST map to 409", async () => {
  for (const code of ["SHIPMENT_NOT_READY", "SHIPMENT_HELD_BY_REFUND_REQUEST"]) {
    const repo = fakeRepo({ markShippedThrows: code });
    const result = await handleMarkShipped({
      body: { entitlementId: "g-1", trackingNumber: "RR1" },
      user: adminUser(),
      deps: { repository: repo }
    });
    assert.equal(result.statusCode, 409, code);
    assert.equal(result.body.error.code, code);
  }
});

test("handleAdminOpsRequest: routes all 5 actions correctly", async () => {
  const repo = fakeRepo({
    pendingRefunds: [{ id: "r-1" }],
    shippableGifts: [{ id: "g-1" }]
  });
  const deps = { repository: repo };

  const list = await handleAdminOpsRequest({ body: { action: "list_pending_refunds" }, user: adminUser(), correlationId: "c-1", deps });
  assert.equal(list.statusCode, 200);

  const review = await handleAdminOpsRequest({ body: { action: "review_refund", requestId: "r-1", decision: "approved" }, user: adminUser(), correlationId: "c-2", deps });
  assert.equal(review.statusCode, 200);

  const confirm = await handleAdminOpsRequest({ body: { action: "confirm_refund_success", requestId: "r-1", paypalRefundId: "RF-1" }, user: adminUser(), correlationId: "c-3", deps });
  assert.equal(confirm.statusCode, 200);

  const gifts = await handleAdminOpsRequest({ body: { action: "list_shippable_gifts" }, user: adminUser(), correlationId: "c-4", deps });
  assert.equal(gifts.statusCode, 200);

  const shipped = await handleAdminOpsRequest({ body: { action: "mark_shipped", entitlementId: "g-1", trackingNumber: "RR1" }, user: adminUser(), correlationId: "c-5", deps });
  assert.equal(shipped.statusCode, 200);
});

test("handleAdminOpsRequest: unknown action lists all 5 valid actions", async () => {
  const result = await handleAdminOpsRequest({ body: { action: "nope" }, user: adminUser(), correlationId: "c-1", deps: {} });
  assert.equal(result.statusCode, 400);
  for (const action of ["list_pending_refunds", "review_refund", "confirm_refund_success", "list_shippable_gifts", "mark_shipped"]) {
    assert.match(result.body.error.message, new RegExp(action));
  }
});
