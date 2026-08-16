"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handleCartAddRequest,
  handleCartUpdateRequest,
  handleCartRemoveRequest,
  handleCartClearRequest,
  handleCheckoutRequest,
  validateCartAddRequestShape,
  validateCartUpdateRequestShape,
  validateCartRemoveRequestShape,
  validateCartClearRequestShape,
  validateCheckoutRequestShape,
  classifyCartAddFailureReason,
  classifyCartUpdateFailureReason,
  classifyCheckoutFailureReason,
  toHttpStatus
} = require("../shop-ops-handler");

function authenticatedUser(id = "11111111-1111-1111-1111-111111111111") {
  return { id, is_anonymous: true };
}

function createFakeRepository(overrides = {}) {
  const calls = {};
  const methods = ["addCartItem", "updateCartItemQuantity", "removeCartItem", "clearCart", "checkoutCart"];
  const repo = { calls };

  for (const method of methods) {
    calls[method] = [];
    repo[method] = async (input) => {
      calls[method].push(input);
      const override = overrides[method];
      if (override?.error) throw override.error;
      return override?.data ?? {};
    };
  }

  return repo;
}

function totalCalls(repository) {
  return Object.values(repository.calls).reduce((sum, c) => sum + c.length, 0);
}

// --- Requirement 1/4: owner-id forgery is rejected on EVERY route, never
// reaching the repository (structural: userId/user_id/ownerId/owner_id are
// not in ANY allowlist). ---

const OWNER_ID_ROUTES = [
  { name: "cart-add", handler: handleCartAddRequest, body: { productId: "p-1" } },
  { name: "cart-update", handler: handleCartUpdateRequest, body: { cartId: "c-1", quantity: 2 } },
  { name: "cart-remove", handler: handleCartRemoveRequest, body: { cartId: "c-1" } },
  { name: "cart-clear", handler: handleCartClearRequest, body: {} },
  { name: "checkout", handler: handleCheckoutRequest, body: { idempotencyKey: "k-1" } }
];

for (const route of OWNER_ID_ROUTES) {
  for (const forgedField of ["userId", "user_id", "ownerId", "owner_id"]) {
    test(`${route.name}: rejects an owner-id-forgery attempt (${forgedField} in body) with 400, never reaching the repository`, async () => {
      const repository = createFakeRepository();
      const result = await route.handler({
        body: { ...route.body, [forgedField]: "attacker-controlled-victim-id" },
        user: authenticatedUser(),
        correlationId: "corr-1",
        deps: { repository }
      });

      assert.equal(result.statusCode, 400);
      assert.equal(result.body.error.code, "INVALID_REQUEST");
      assert.equal(totalCalls(repository), 0);
    });
  }

  test(`${route.name}: rejects an unauthenticated caller (401), never reaching the repository — fail closed`, async () => {
    const repository = createFakeRepository();
    const result = await route.handler({ body: route.body, user: null, correlationId: "corr-1", deps: { repository } });

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error.code, "UNAUTHORIZED");
    assert.equal(totalCalls(repository), 0);
  });

  test(`${route.name}: allowlist rejects a forged price/subtotal/total/stock field outright — there is no such input channel`, async () => {
    const repository = createFakeRepository();
    for (const forgedField of ["price", "unitPrice", "subtotal", "total", "totalAmount", "stock", "productName"]) {
      const result = await route.handler({
        body: { ...route.body, [forgedField]: 0 },
        user: authenticatedUser(),
        correlationId: "corr-1",
        deps: { repository }
      });
      assert.equal(result.statusCode, 400, `expected ${forgedField} to be rejected on ${route.name}`);
      assert.equal(result.body.error.code, "INVALID_REQUEST");
    }
    assert.equal(totalCalls(repository), 0);
  });
}

// --- cart-add ---

test("validateCartAddRequestShape: requires productId, quantity optional but must be a safe integer 1-99 when present", () => {
  assert.deepEqual(validateCartAddRequestShape({}), ["productId is required."]);
  assert.deepEqual(validateCartAddRequestShape({ productId: "p-1" }), []);
  assert.deepEqual(validateCartAddRequestShape({ productId: "p-1", quantity: 0 }), ["quantity must be an integer between 1 and 99."]);
  assert.deepEqual(validateCartAddRequestShape({ productId: "p-1", quantity: 100 }), ["quantity must be an integer between 1 and 99."]);
  assert.deepEqual(validateCartAddRequestShape({ productId: "p-1", quantity: 1.5 }), ["quantity must be an integer between 1 and 99."]);
  assert.deepEqual(validateCartAddRequestShape({ productId: "p-1", quantity: 5 }), []);
});

test("handleCartAddRequest: resolves userId SOLELY from the verified user, defaults quantity to 1, returns server-authoritative cart row", async () => {
  const repository = createFakeRepository({ addCartItem: { data: { id: "c-1", quantity: 1 } } });
  const result = await handleCartAddRequest({ body: { productId: "p-1" }, user: authenticatedUser("real-user-id"), correlationId: "corr-1", deps: { repository } });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(repository.calls.addCartItem[0], { userId: "real-user-id", productId: "p-1", quantity: 1 });
});

test("handleCartAddRequest: invalid/disabled product -> 404 PRODUCT_NOT_FOUND", async () => {
  const repository = createFakeRepository({ addCartItem: { error: new Error("add_cart_item: product p-9 not found or not enabled") } });
  const result = await handleCartAddRequest({ body: { productId: "p-9" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 404);
  assert.equal(result.body.error.code, "PRODUCT_NOT_FOUND");
});

test("handleCartAddRequest: out of stock -> 409 OUT_OF_STOCK, non-retryable", async () => {
  const repository = createFakeRepository({ addCartItem: { error: new Error("add_cart_item: insufficient stock for product p-1") } });
  const result = await handleCartAddRequest({ body: { productId: "p-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.code, "OUT_OF_STOCK");
  assert.equal(result.body.error.retryable, false);
});

test("handleCartAddRequest: mascot not unlocked -> 403 MASCOT_NOT_UNLOCKED", async () => {
  const repository = createFakeRepository({ addCartItem: { error: new Error("add_cart_item: required mascot not unlocked for product p-1") } });
  const result = await handleCartAddRequest({ body: { productId: "p-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, "MASCOT_NOT_UNLOCKED");
});

test("handleCartAddRequest: generic RPC failure -> 502, retryable:true, never leaking the raw error", async () => {
  const repository = createFakeRepository({ addCartItem: { error: new Error("relation shop_products does not exist") } });
  const result = await handleCartAddRequest({ body: { productId: "p-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(result.body), /relation|does not exist/);
});

// --- cart-update ---

test("validateCartUpdateRequestShape: requires cartId AND a safe integer quantity", () => {
  assert.deepEqual(validateCartUpdateRequestShape({}), ["cartId is required.", "quantity must be an integer between 1 and 99."]);
  assert.deepEqual(validateCartUpdateRequestShape({ cartId: "c-1", quantity: 2 }), []);
  assert.deepEqual(validateCartUpdateRequestShape({ cartId: "c-1", quantity: -1 }), ["quantity must be an integer between 1 and 99."]);
});

test("handleCartUpdateRequest: a caller-forged low price cannot affect anything — the field doesn't even parse (extra allowlist violation)", async () => {
  const repository = createFakeRepository();
  const result = await handleCartUpdateRequest({
    body: { cartId: "c-1", quantity: 2, price: 1 },
    user: authenticatedUser(),
    correlationId: "corr-1",
    deps: { repository }
  });
  assert.equal(result.statusCode, 400);
  assert.equal(repository.calls.updateCartItemQuantity.length, 0);
});

test("handleCartUpdateRequest: cannot modify another user's cart item — RPC-level ownership check surfaces as CART_ITEM_NOT_FOUND, indistinguishable from a truly missing id", async () => {
  const repository = createFakeRepository({ updateCartItemQuantity: { error: new Error("update_cart_item_quantity: cart item c-999 not found") } });
  const result = await handleCartUpdateRequest({ body: { cartId: "c-999", quantity: 2 }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 404);
  assert.equal(result.body.error.code, "CART_ITEM_NOT_FOUND");
});

test("handleCartUpdateRequest: quantity 0, negative, non-integer, and over-limit are all rejected", async () => {
  const repository = createFakeRepository();
  for (const badQuantity of [0, -5, 1.5, 1000, "3"]) {
    const result = await handleCartUpdateRequest({ body: { cartId: "c-1", quantity: badQuantity }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
    assert.equal(result.statusCode, 400, `expected quantity=${JSON.stringify(badQuantity)} to be rejected`);
  }
  assert.equal(repository.calls.updateCartItemQuantity.length, 0);
});

test("handleCartUpdateRequest: out of stock -> 409 OUT_OF_STOCK", async () => {
  const repository = createFakeRepository({ updateCartItemQuantity: { error: new Error("update_cart_item_quantity: insufficient stock for product p-1") } });
  const result = await handleCartUpdateRequest({ body: { cartId: "c-1", quantity: 50 }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.code, "OUT_OF_STOCK");
});

// --- cart-remove ---

test("handleCartRemoveRequest: forwards ONLY cartId + verified userId; backend failure never falls back to a direct write (there is nothing else to fall back to — repository is the only path)", async () => {
  const repository = createFakeRepository({ removeCartItem: { data: true } });
  const result = await handleCartRemoveRequest({ body: { cartId: "c-1" }, user: authenticatedUser("real-user-id"), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.data.removed, true);
  assert.deepEqual(repository.calls.removeCartItem[0], { userId: "real-user-id", cartId: "c-1" });
});

test("handleCartRemoveRequest: removing an already-removed / non-owned item returns removed:false, not an error (idempotent-friendly)", async () => {
  const repository = createFakeRepository({ removeCartItem: { data: false } });
  const result = await handleCartRemoveRequest({ body: { cartId: "c-not-mine" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.data.removed, false);
});

test("handleCartRemoveRequest: repository failure -> 502 CART_REMOVE_FAILED, retryable:true, never a raw error leak", async () => {
  const repository = createFakeRepository({ removeCartItem: { error: new Error("connection reset") } });
  const result = await handleCartRemoveRequest({ body: { cartId: "c-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(result.body), /connection reset/);
});

// --- cart-clear ---

test("handleCartClearRequest: accepts an empty body, forwards ONLY the verified userId", async () => {
  const repository = createFakeRepository({ clearCart: { data: 4 } });
  const result = await handleCartClearRequest({ body: {}, user: authenticatedUser("real-user-id"), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.data.removedCount, 4);
  assert.deepEqual(repository.calls.clearCart[0], { userId: "real-user-id" });
});

// --- checkout ---

test("validateCheckoutRequestShape: requires ONLY idempotencyKey", () => {
  assert.deepEqual(validateCheckoutRequestShape({}), ["idempotencyKey is required."]);
  assert.deepEqual(validateCheckoutRequestShape({ idempotencyKey: "k-1" }), []);
});

test("handleCheckoutRequest: forwards ONLY idempotencyKey + verified userId — no cart contents/prices/total from the caller", async () => {
  const repository = createFakeRepository({
    checkoutCart: { data: { order_id: "o-1", order_no: "20260817-0001", total_amount: 500, total_items: 2, status: "pending", items: [] } }
  });
  const result = await handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser("real-user-id"), correlationId: "corr-1", deps: { repository } });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(repository.calls.checkoutCart[0], { userId: "real-user-id", idempotencyKey: "k-1" });
  assert.equal(result.body.data.status, "pending");
});

test("handleCheckoutRequest: never declares payment success — status is always whatever the server (pending) returned, this layer never rewrites it", async () => {
  const repository = createFakeRepository({
    checkoutCart: { data: { order_id: "o-1", status: "pending" } }
  });
  const result = await handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.body.data.status, "pending");
  assert.notEqual(result.body.data.status, "paid");
  assert.notEqual(result.body.data.status, "completed");
});

test("handleCheckoutRequest: empty cart -> 409 CART_EMPTY, no partial order created (repository is the sole DB path and threw before returning)", async () => {
  const repository = createFakeRepository({ checkoutCart: { error: new Error("checkout_cart: cart is empty (user=u-1)") } });
  const result = await handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.code, "CART_EMPTY");
});

test("handleCheckoutRequest: stale/disabled product in cart -> 404 PRODUCT_NOT_FOUND, whole checkout fails (no partial order)", async () => {
  const repository = createFakeRepository({ checkoutCart: { error: new Error("checkout_cart: product p-1 not found or not enabled") } });
  const result = await handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 404);
  assert.equal(result.body.error.code, "PRODUCT_NOT_FOUND");
});

test("handleCheckoutRequest: insufficient stock -> 409 OUT_OF_STOCK, whole checkout fails", async () => {
  const repository = createFakeRepository({ checkoutCart: { error: new Error("checkout_cart: insufficient stock for product p-1") } });
  const result = await handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.code, "OUT_OF_STOCK");
});

test("handleCheckoutRequest: generic RPC failure marks retryable:true; business rejections mark retryable:false", async () => {
  const genericRepository = createFakeRepository({ checkoutCart: { error: new Error("fetch failed") } });
  const genericResult = await handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository: genericRepository } });
  assert.equal(genericResult.body.error.retryable, true);

  const emptyRepository = createFakeRepository({ checkoutCart: { error: new Error("checkout_cart: cart is empty (user=u-1)") } });
  const emptyResult = await handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-2", deps: { repository: emptyRepository } });
  assert.equal(emptyResult.body.error.retryable, false);
});

test("classifyCheckoutFailureReason: cross-user idempotency replay and internal data-inconsistency both collapse to UNKNOWN, never distinguished from a random unexpected error", () => {
  assert.equal(classifyCheckoutFailureReason(new Error("checkout_cart: idempotency key does not belong to this user")), "UNKNOWN");
  assert.equal(classifyCheckoutFailureReason(new Error("checkout_cart: cached order o-1 missing for idempotency key")), "UNKNOWN");
  assert.equal(classifyCheckoutFailureReason(new Error("totally different unexpected error")), "UNKNOWN");
});

// --- Idempotency: duplicate click / lost-response retry / concurrency ---
//
// STATEFUL fake repository modeling checkout_cart's own DB-level
// idempotency (same idempotencyKey only "applies" once, returns the SAME
// cached order on any resend) — proves the HANDLER forwards results
// faithfully without adding its own double-execution, for sequential
// resend (simulating a lost response) AND real concurrent duplicate
// requests (Promise.all, simulating a double-click). Cannot prove real
// Postgres FOR UPDATE/MVCC concurrency — that is a 05C Staging Gate
// concern (see review-auth-05B-2B.md).
function createStatefulCheckoutRepository() {
  let appliedCount = 0;
  const cachedByKey = new Map();
  return {
    get appliedCount() { return appliedCount; },
    async checkoutCart({ idempotencyKey }) {
      if (cachedByKey.has(idempotencyKey)) return cachedByKey.get(idempotencyKey);
      appliedCount += 1;
      const result = { order_id: `o-${appliedCount}`, total_amount: 500, status: "pending", items: [] };
      cachedByKey.set(idempotencyKey, result);
      return result;
    }
  };
}

test("handleCheckoutRequest: sequential resend with the SAME idempotencyKey (simulating a lost response, retried) creates exactly ONE order", async () => {
  const repository = createStatefulCheckoutRepository();
  const first = await handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  const second = await handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-2", deps: { repository } });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(first.body.data, second.body.data);
  assert.equal(repository.appliedCount, 1);
});

test("handleCheckoutRequest: real concurrent double-click (SAME idempotencyKey, Promise.all) creates exactly ONE order", async () => {
  const repository = createStatefulCheckoutRepository();
  const [first, second, third] = await Promise.all([
    handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } }),
    handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-2", deps: { repository } }),
    handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-3", deps: { repository } })
  ]);

  for (const result of [first, second, third]) {
    assert.equal(result.statusCode, 200);
  }
  assert.equal(repository.appliedCount, 1);
});

test("handleCheckoutRequest: DIFFERENT idempotencyKeys are two distinct, independently-applied checkout intents", async () => {
  const repository = createStatefulCheckoutRepository();
  const first = await handleCheckoutRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  const second = await handleCheckoutRequest({ body: { idempotencyKey: "k-2" }, user: authenticatedUser(), correlationId: "corr-2", deps: { repository } });

  assert.notDeepEqual(first.body.data, second.body.data);
  assert.equal(repository.appliedCount, 2);
});

// --- P-AUTH-05B-2B.1 Hotfix: claim-then-lock race simulation ---
//
// LABEL: SIMULATED — this fake models the CONTRACT the real
// `checkout_cart()` SQL (20260817000500_shop_checkout_atomic_claim_fix.sql)
// must satisfy (a second concurrent same-key call WAITS for the first to
// settle, then either reads its committed result or safely takes over
// after a rollback), using a JS promise-based mutex + an artificial
// `setTimeout(0)` yield point to force real interleaving under
// `Promise.all`. It does NOT execute any SQL and is NOT proof of real
// Postgres `INSERT ... ON CONFLICT` / `FOR UPDATE` behavior — that is a
// STATIC PASS at the migration-text level only (see
// `shop-checkout-atomic-claim-fix-shape.test.js`) plus an explicit RUNTIME
// NOT RUN item requiring a real 05C staging run (see
// `scripts/verify-checkout-concurrency-staging.js`).
function createClaimLockCheckoutRepository({ firstAttemptShouldFail = false } = {}) {
  const locks = new Map(); // idempotencyKey -> Promise that settles when the current holder finishes
  const completed = new Map(); // idempotencyKey -> { userId, result }
  let appliedCount = 0;
  let attemptCount = 0;

  return {
    get appliedCount() { return appliedCount; },
    async checkoutCart({ userId, idempotencyKey }) {
      // Mirrors "INSERT ... ON CONFLICT DO NOTHING" + "SELECT ... FOR
      // UPDATE" waiting for any other in-flight holder of the SAME key.
      while (locks.has(idempotencyKey)) {
        await locks.get(idempotencyKey);
      }

      const cached = completed.get(idempotencyKey);
      if (cached) {
        // Identity check ALWAYS applied to a completed claim, mirroring
        // the migration's unconditional ownership check.
        if (cached.userId !== userId) {
          throw new Error("checkout_cart: idempotency key does not belong to this user");
        }
        return cached.result;
      }

      attemptCount += 1;
      const isFirstAttempt = attemptCount === 1;
      let settle;
      const lockPromise = new Promise((resolve) => { settle = resolve; });
      locks.set(idempotencyKey, lockPromise);

      try {
        await new Promise((resolve) => setTimeout(resolve, 0)); // force real interleaving

        if (isFirstAttempt && firstAttemptShouldFail) {
          // Mirrors a transaction ROLLBACK: nothing is cached, the claim
          // row itself is gone (never committed) — a following attempt
          // with the SAME key can freely become the new claimant.
          throw new Error(`checkout_cart: cart is empty (user=${userId})`);
        }

        appliedCount += 1;
        const result = { order_id: `o-${appliedCount}`, total_amount: 500, status: "pending", items: [] };
        completed.set(idempotencyKey, { userId, result });
        return result;
      } finally {
        locks.delete(idempotencyKey);
        settle();
      }
    }
  };
}

test("[SIMULATED, not real Postgres] handleCheckoutRequest: TRUE concurrent (Promise.all) same-UID same-key checkout creates exactly ONE order, both responses return the SAME order_id", async () => {
  const repository = createClaimLockCheckoutRepository();
  const user = authenticatedUser("user-real-1");

  const [first, second] = await Promise.all([
    handleCheckoutRequest({ body: { idempotencyKey: "k-race" }, user, correlationId: "corr-1", deps: { repository } }),
    handleCheckoutRequest({ body: { idempotencyKey: "k-race" }, user, correlationId: "corr-2", deps: { repository } })
  ]);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.body.data.order_id, second.body.data.order_id);
  assert.deepEqual(first.body.data, second.body.data);
  // Proxy for "stock only decremented once / order_items only created
  // once": only ONE real order-creation attempt ever committed.
  assert.equal(repository.appliedCount, 1);
});

test("[SIMULATED, not real Postgres] handleCheckoutRequest: three-way concurrent (Promise.all) same-UID same-key checkout still creates exactly ONE order", async () => {
  const repository = createClaimLockCheckoutRepository();
  const user = authenticatedUser("user-real-1");

  const results = await Promise.all([
    handleCheckoutRequest({ body: { idempotencyKey: "k-race-3" }, user, correlationId: "corr-1", deps: { repository } }),
    handleCheckoutRequest({ body: { idempotencyKey: "k-race-3" }, user, correlationId: "corr-2", deps: { repository } }),
    handleCheckoutRequest({ body: { idempotencyKey: "k-race-3" }, user, correlationId: "corr-3", deps: { repository } })
  ]);

  for (const result of results) {
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.order_id, results[0].body.data.order_id);
  }
  assert.equal(repository.appliedCount, 1);
});

test("[SIMULATED, not real Postgres] handleCheckoutRequest: first attempt rolls back (cart empty) — second attempt with the SAME key safely takes over and succeeds, never returning a half-completed result", async () => {
  const repository = createClaimLockCheckoutRepository({ firstAttemptShouldFail: true });
  const user = authenticatedUser("user-real-1");

  const first = await handleCheckoutRequest({ body: { idempotencyKey: "k-rollback" }, user, correlationId: "corr-1", deps: { repository } });
  assert.equal(first.statusCode, 409);
  assert.equal(first.body.error.code, "CART_EMPTY");

  const second = await handleCheckoutRequest({ body: { idempotencyKey: "k-rollback" }, user, correlationId: "corr-2", deps: { repository } });
  assert.equal(second.statusCode, 200);
  assert.ok(second.body.data.order_id, "second attempt must return a full, real order — not a half-completed result");
  assert.equal(repository.appliedCount, 1);
});

test("[SIMULATED, not real Postgres] handleCheckoutRequest: a resend of an ALREADY-COMPLETED key never re-runs the cart-empty check — CART_EMPTY can never overwrite/mask a completed result", async () => {
  const repository = createClaimLockCheckoutRepository();
  const user = authenticatedUser("user-real-1");

  const first = await handleCheckoutRequest({ body: { idempotencyKey: "k-completed" }, user, correlationId: "corr-1", deps: { repository } });
  assert.equal(first.statusCode, 200);

  // A resend of the SAME already-completed key must return the cached
  // order — never CART_EMPTY, even though (in a real DB) the cart is now
  // genuinely empty after the first successful checkout cleared it.
  const resend = await handleCheckoutRequest({ body: { idempotencyKey: "k-completed" }, user, correlationId: "corr-2", deps: { repository } });
  assert.equal(resend.statusCode, 200);
  assert.notEqual(resend.body?.error?.code, "CART_EMPTY");
  assert.deepEqual(resend.body.data, first.body.data);
  assert.equal(repository.appliedCount, 1);
});

test("[SIMULATED, not real Postgres] handleCheckoutRequest: a DIFFERENT UID reusing the SAME idempotency key never receives the first user's order — generic failure only, never a distinguishing message", async () => {
  const repository = createClaimLockCheckoutRepository();
  const userA = authenticatedUser("user-A");
  const userB = authenticatedUser("user-B");

  const first = await handleCheckoutRequest({ body: { idempotencyKey: "k-shared" }, user: userA, correlationId: "corr-1", deps: { repository } });
  assert.equal(first.statusCode, 200);

  const second = await handleCheckoutRequest({ body: { idempotencyKey: "k-shared" }, user: userB, correlationId: "corr-2", deps: { repository } });
  assert.notEqual(second.statusCode, 200);
  assert.equal(second.body.error.code, "CHECKOUT_FAILED");
  assert.doesNotMatch(JSON.stringify(second.body), new RegExp(first.body.data.order_id));
});

test("classifyCartAddFailureReason / classifyCartUpdateFailureReason: map known messages to a fixed allowlist", () => {
  assert.equal(classifyCartAddFailureReason(new Error("add_cart_item: product p-1 not found or not enabled")), "PRODUCT_NOT_FOUND");
  assert.equal(classifyCartAddFailureReason(new Error("add_cart_item: required mascot not unlocked for product p-1")), "MASCOT_NOT_UNLOCKED");
  assert.equal(classifyCartAddFailureReason(new Error("add_cart_item: insufficient stock for product p-1")), "OUT_OF_STOCK");
  assert.equal(classifyCartUpdateFailureReason(new Error("update_cart_item_quantity: cart item c-1 not found")), "CART_ITEM_NOT_FOUND");
});

test("toHttpStatus: maps every known code, defaults unknown codes to 500", () => {
  assert.equal(toHttpStatus("OUT_OF_STOCK"), 409);
  assert.equal(toHttpStatus("PRODUCT_NOT_FOUND"), 404);
  assert.equal(toHttpStatus("UNAUTHORIZED"), 401);
  assert.equal(toHttpStatus("SOMETHING_UNKNOWN"), 500);
});
