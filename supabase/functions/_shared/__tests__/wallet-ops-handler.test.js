"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handleEnsureUserRequest,
  handleGachaDrawRequest,
  handleGiftRedeemRequest,
  validateEnsureUserRequestShape,
  validateGachaDrawRequestShape,
  validateGiftRedeemRequestShape,
  classifyGachaFailureReason,
  classifyGiftFailureReason,
  toHttpStatus
} = require("../wallet-ops-handler");

function authenticatedUser(id = "11111111-1111-1111-1111-111111111111") {
  return { id, is_anonymous: true };
}

function createFakeRepository(overrides = {}) {
  const calls = {};
  const methods = ["ensureUser", "claimGachaDraw", "redeemGift"];
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

// --- Owner ID forgery (requirement 2/9): shared across all THREE routes.
// P-AUTH-05B-2A Hotfix requirements 2/3 removed adjust-balance/upsert-mascot
// entirely — there is no route to test for them anymore.

const OWNER_ID_ROUTES = [
  { name: "ensure-user", handler: handleEnsureUserRequest, body: {} },
  { name: "gacha-draw", handler: handleGachaDrawRequest, body: { idempotencyKey: "k-1" } },
  { name: "gift-redeem", handler: handleGiftRedeemRequest, body: { giftId: "g-1", idempotencyKey: "k-1" } }
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
      assert.equal(Object.values(repository.calls).reduce((sum, c) => sum + c.length, 0), 0);
    });
  }

  test(`${route.name}: rejects an unauthenticated caller (401), never reaching the repository`, async () => {
    const repository = createFakeRepository();
    const result = await route.handler({ body: route.body, user: null, correlationId: "corr-1", deps: { repository } });

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error.code, "UNAUTHORIZED");
    assert.equal(Object.values(repository.calls).reduce((sum, c) => sum + c.length, 0), 0);
  });
}

// --- ensure-user ---

test("validateEnsureUserRequestShape: allows an empty body, rejects unknown fields", () => {
  assert.deepEqual(validateEnsureUserRequestShape({}), []);
  assert.deepEqual(validateEnsureUserRequestShape({ evil: "x" }), ["evil is not allowed in the request body."]);
});

test("handleEnsureUserRequest: resolves user id SOLELY from the verified user object, never from the body", async () => {
  const repository = createFakeRepository();
  await handleEnsureUserRequest({
    body: { nickname: "Alice" },
    user: authenticatedUser("real-user-id"),
    correlationId: "corr-1",
    deps: { repository }
  });

  assert.equal(repository.calls.ensureUser[0].userId, "real-user-id");
  assert.equal(repository.calls.ensureUser[0].nickname, "Alice");
});

test("handleEnsureUserRequest: repository failure -> generic 502, never leaking the raw error", async () => {
  const repository = createFakeRepository({ ensureUser: { error: new Error("relation users does not exist") } });
  const result = await handleEnsureUserRequest({ body: {}, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });

  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.code, "ENSURE_USER_FAILED");
  assert.doesNotMatch(JSON.stringify(result.body), /relation|does not exist/);
});

// --- gacha-draw ---
//
// P-AUTH-05B-2A Hotfix requirement 1: `claim_gacha_draw` now decides
// mascot/rarity/reward ENTIRELY server-side. The ONLY allowed field in the
// request body is `idempotencyKey` — `mascotId`/reward/points/tickets/
// rarity are allowlist violations (same 400 INVALID_REQUEST treatment as
// an owner-id-forgery attempt), exactly like requirement 6 demands
// ("竄改mascotId/reward/delta被拒絕", "最高稀有度不能由前端指定").

test("validateGachaDrawRequestShape: requires ONLY idempotencyKey — mascotId/reward/points/tickets/rarity are all allowlist violations", () => {
  assert.deepEqual(validateGachaDrawRequestShape({}), ["idempotencyKey is required."]);

  for (const forbiddenField of ["mascotId", "rewardPoints", "pointsEarned", "ticketsEarned", "rarity", "delta", "isNew"]) {
    const errors = validateGachaDrawRequestShape({ idempotencyKey: "k-1", [forbiddenField]: "SSR" });
    assert.deepEqual(errors, [`${forbiddenField} is not allowed in the request body.`], `expected ${forbiddenField} to be rejected`);
  }
});

test("validateGachaDrawRequestShape: a client attempting to force the highest rarity (mascotId + rarity:'SSR') is rejected outright, never reaching the repository", async () => {
  const repository = createFakeRepository();
  const result = await handleGachaDrawRequest({
    body: { idempotencyKey: "k-1", mascotId: "legendary-mascot", rarity: "SSR" },
    user: authenticatedUser(),
    correlationId: "corr-1",
    deps: { repository }
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, "INVALID_REQUEST");
  assert.equal(repository.calls.claimGachaDraw.length, 0);
});

test("handleGachaDrawRequest: resolves userId from the verified user, forwards ONLY idempotencyKey, returns server-authoritative result (mascot/rarity/reward chosen by the server)", async () => {
  const repository = createFakeRepository({
    claimGachaDraw: { data: { mascot_id: "m-1", mascot_name: "Fox", rarity: "SSR", image: "img.png", is_new: true, points_earned: 50, tickets_earned: 1, coins_delta: -1 } }
  });
  const result = await handleGachaDrawRequest({
    body: { idempotencyKey: "k-1" },
    user: authenticatedUser("real-user-id"),
    correlationId: "corr-1",
    deps: { repository }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.data.points_earned, 50);
  assert.equal(result.body.data.rarity, "SSR");
  assert.deepEqual(repository.calls.claimGachaDraw[0], { userId: "real-user-id", idempotencyKey: "k-1" });
});

test("handleGachaDrawRequest: insufficient coins -> 409 INSUFFICIENT_COINS", async () => {
  const repository = createFakeRepository({ claimGachaDraw: { error: new Error("claim_gacha_draw: insufficient coins (user=u-1, coins=0)") } });
  const result = await handleGachaDrawRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });

  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.code, "INSUFFICIENT_COINS");
});

test("handleGachaDrawRequest: mascot not found -> 404 MASCOT_NOT_FOUND (e.g. server-side catalog gap, never something the client can cause by choosing a mascot)", async () => {
  const repository = createFakeRepository({ claimGachaDraw: { error: new Error("claim_gacha_draw: mascot m-999 not found or not enabled") } });
  const result = await handleGachaDrawRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });

  assert.equal(result.statusCode, 404);
  assert.equal(result.body.error.code, "MASCOT_NOT_FOUND");
});

// Owner偽造/跨帳號 (requirement 9): a replayed idempotency key that belongs
// to a DIFFERENT user_id must NOT be distinguishable from any other
// unexpected failure — same generic 502, same generic message.
test("handleGachaDrawRequest: cross-user idempotency key replay is collapsed into the SAME generic failure as any other unknown error (never distinguished)", async () => {
  const crossUserRepository = createFakeRepository({ claimGachaDraw: { error: new Error("claim_gacha_draw: idempotency key does not belong to this user") } });
  const genericRepository = createFakeRepository({ claimGachaDraw: { error: new Error("totally different unexpected error") } });

  const crossUserResult = await handleGachaDrawRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository: crossUserRepository } });
  const genericResult = await handleGachaDrawRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-2", deps: { repository: genericRepository } });

  assert.equal(crossUserResult.statusCode, genericResult.statusCode);
  assert.equal(crossUserResult.body.error.code, "GACHA_DRAW_FAILED");
  assert.equal(genericResult.body.error.code, "GACHA_DRAW_FAILED");
  assert.equal(crossUserResult.body.error.message, genericResult.body.error.message);
});

test("handleGachaDrawRequest: generic RPC failure marks retryable:true (requirement 5); business rejections mark retryable:false", async () => {
  const genericRepository = createFakeRepository({ claimGachaDraw: { error: new Error("fetch failed") } });
  const genericResult = await handleGachaDrawRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository: genericRepository } });
  assert.equal(genericResult.body.error.retryable, true);

  const insufficientRepository = createFakeRepository({ claimGachaDraw: { error: new Error("claim_gacha_draw: insufficient coins (user=u-1, coins=0)") } });
  const insufficientResult = await handleGachaDrawRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-2", deps: { repository: insufficientRepository } });
  assert.equal(insufficientResult.body.error.retryable, false);
});

test("classifyGachaFailureReason: maps known messages to a fixed allowlist, collapsing unknown/cross-user reasons to UNKNOWN", () => {
  assert.equal(classifyGachaFailureReason(new Error("claim_gacha_draw: insufficient coins (user=u-1, coins=0)")), "INSUFFICIENT_COINS");
  assert.equal(classifyGachaFailureReason(new Error("claim_gacha_draw: mascot m-1 not found or not enabled")), "MASCOT_NOT_FOUND");
  assert.equal(classifyGachaFailureReason(new Error("claim_gacha_draw: user u-1 not found")), "USER_NOT_FOUND");
  assert.equal(classifyGachaFailureReason(new Error("claim_gacha_draw: idempotency key does not belong to this user")), "UNKNOWN");
  assert.equal(classifyGachaFailureReason(new Error("fetch failed")), "UNKNOWN");
});

// Duplicate click / concurrency / lost-response retry (requirement 6): a
// STATEFUL fake repository modeling the RPC's own idempotency (same
// idempotencyKey only "applies" once) — proves the HANDLER forwards
// results faithfully without adding its own double-execution, for both
// sequential resend (simulating a lost response, retried with the SAME
// key) and concurrent (Promise.all, simulating a real double-click)
// duplicate requests. Cannot prove real Postgres FOR UPDATE/MVCC
// concurrency (05C Staging Gate concern, see review-auth-05B-2A-hotfix.md).
function createStatefulGachaRepository() {
  let appliedCount = 0;
  const cachedByKey = new Map();
  return {
    get appliedCount() { return appliedCount; },
    async claimGachaDraw({ idempotencyKey }) {
      if (cachedByKey.has(idempotencyKey)) return cachedByKey.get(idempotencyKey);
      appliedCount += 1;
      const result = { mascot_id: `m-${appliedCount}`, is_new: true, points_earned: 50, tickets_earned: 1, coins_delta: -1 };
      cachedByKey.set(idempotencyKey, result);
      return result;
    }
  };
}

test("handleGachaDrawRequest: sequential resend with the SAME idempotencyKey (simulating a lost response, retried) applies the draw exactly ONCE", async () => {
  const repository = createStatefulGachaRepository();
  const first = await handleGachaDrawRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  const second = await handleGachaDrawRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-2", deps: { repository } });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(first.body.data, second.body.data);
  assert.equal(repository.appliedCount, 1);
});

test("handleGachaDrawRequest: real concurrent double-click (SAME idempotencyKey, Promise.all) applies the draw exactly ONCE", async () => {
  const repository = createStatefulGachaRepository();
  const [first, second, third] = await Promise.all([
    handleGachaDrawRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } }),
    handleGachaDrawRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-2", deps: { repository } }),
    handleGachaDrawRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-3", deps: { repository } })
  ]);

  for (const result of [first, second, third]) {
    assert.equal(result.statusCode, 200);
  }
  assert.equal(repository.appliedCount, 1);
});

// Requirement 5/6: "不同key代表兩次明確操作" — DIFFERENT idempotency keys
// (i.e. two genuinely separate draw attempts, e.g. two different button
// clicks each generating a fresh key) must EACH apply independently, never
// be conflated with each other.
test("handleGachaDrawRequest: DIFFERENT idempotencyKeys are two distinct, independently-applied draws", async () => {
  const repository = createStatefulGachaRepository();
  const first = await handleGachaDrawRequest({ body: { idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  const second = await handleGachaDrawRequest({ body: { idempotencyKey: "k-2" }, user: authenticatedUser(), correlationId: "corr-2", deps: { repository } });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.notDeepEqual(first.body.data, second.body.data);
  assert.equal(repository.appliedCount, 2);
});

// --- gift-redeem ---

test("validateGiftRedeemRequestShape: requires giftId and idempotencyKey, rejects extra fields (e.g. client-declared cost)", () => {
  assert.deepEqual(validateGiftRedeemRequestShape({}), ["giftId is required.", "idempotencyKey is required."]);
  const errors = validateGiftRedeemRequestShape({ giftId: "g-1", idempotencyKey: "k-1", pointsCost: 0 });
  assert.deepEqual(errors, ["pointsCost is not allowed in the request body."]);
});

test("handleGiftRedeemRequest: resolves userId from the verified user, forwards giftId/idempotencyKey, returns server-authoritative result", async () => {
  const repository = createFakeRepository({
    redeemGift: { data: { redeem_history_id: "r-1", gift_id: "g-1", points_cost: 100 } }
  });
  const result = await handleGiftRedeemRequest({
    body: { giftId: "g-1", idempotencyKey: "k-1" },
    user: authenticatedUser("real-user-id"),
    correlationId: "corr-1",
    deps: { repository }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.data.points_cost, 100);
  assert.equal(repository.calls.redeemGift[0].userId, "real-user-id");
});

const GIFT_FAILURE_SCENARIOS = [
  { name: "gift not found", error: new Error("redeem_gift_transaction: gift g-999 not found or not enabled"), code: "GIFT_NOT_FOUND", status: 404 },
  { name: "out of stock", error: new Error("redeem_gift_transaction: gift g-1 is out of stock"), code: "OUT_OF_STOCK", status: 409 },
  { name: "insufficient points", error: new Error("redeem_gift_transaction: insufficient points (user=u-1, required=100)"), code: "INSUFFICIENT_POINTS", status: 409 },
  { name: "insufficient tickets", error: new Error("redeem_gift_transaction: insufficient tickets (user=u-1, required=1)"), code: "INSUFFICIENT_TICKETS", status: 409 },
  { name: "insufficient coins", error: new Error("redeem_gift_transaction: insufficient coins (user=u-1, required=5)"), code: "INSUFFICIENT_COINS", status: 409 }
];

for (const scenario of GIFT_FAILURE_SCENARIOS) {
  test(`handleGiftRedeemRequest: ${scenario.name} -> ${scenario.status} ${scenario.code}`, async () => {
    const repository = createFakeRepository({ redeemGift: { error: scenario.error } });
    const result = await handleGiftRedeemRequest({ body: { giftId: "g-1", idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });

    assert.equal(result.statusCode, scenario.status);
    assert.equal(result.body.error.code, scenario.code);
    assert.equal(result.body.error.retryable, false);
  });
}

test("handleGiftRedeemRequest: cross-user idempotency key replay collapses to the SAME generic failure as any other unknown error", async () => {
  const crossUserRepository = createFakeRepository({ redeemGift: { error: new Error("redeem_gift_transaction: idempotency key does not belong to this user") } });
  const genericRepository = createFakeRepository({ redeemGift: { error: new Error("totally different unexpected error") } });

  const crossUserResult = await handleGiftRedeemRequest({ body: { giftId: "g-1", idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository: crossUserRepository } });
  const genericResult = await handleGiftRedeemRequest({ body: { giftId: "g-1", idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-2", deps: { repository: genericRepository } });

  assert.equal(crossUserResult.body.error.code, "GIFT_REDEEM_FAILED");
  assert.equal(genericResult.body.error.code, "GIFT_REDEEM_FAILED");
  assert.equal(crossUserResult.body.error.message, genericResult.body.error.message);
  assert.equal(crossUserResult.body.error.retryable, true);
});

// Partial-failure rollback (requirement 9): the HANDLER itself never
// returns a partial-success shape — a repository throw ALWAYS produces a
// clean `{ok:false}` error response, never a mix of "some data + an
// error". Real atomic rollback is enforced by the SQL transaction itself
// (05A/05B-2A migrations) — this only proves the JS boundary doesn't
// invent its own partial-success shape on top of that.
test("handleGiftRedeemRequest: a repository failure never leaks a partial-success data field", async () => {
  const repository = createFakeRepository({ redeemGift: { error: new Error("redeem_gift_transaction: gift g-1 is out of stock") } });
  const result = await handleGiftRedeemRequest({ body: { giftId: "g-1", idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });

  assert.equal(result.body.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.body, "data"), false);
});

function createStatefulGiftRepository() {
  let appliedCount = 0;
  const cachedByKey = new Map();
  return {
    get appliedCount() { return appliedCount; },
    async redeemGift({ idempotencyKey }) {
      if (cachedByKey.has(idempotencyKey)) return cachedByKey.get(idempotencyKey);
      appliedCount += 1;
      const result = { redeem_history_id: `r-${appliedCount}`, gift_id: "g-1", points_cost: 100 };
      cachedByKey.set(idempotencyKey, result);
      return result;
    }
  };
}

test("handleGiftRedeemRequest: sequential resend (lost-response retry) and concurrent duplicate clicks (SAME idempotencyKey) redeem exactly ONCE", async () => {
  const repository = createStatefulGiftRepository();

  const first = await handleGiftRedeemRequest({ body: { giftId: "g-1", idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  const second = await handleGiftRedeemRequest({ body: { giftId: "g-1", idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-2", deps: { repository } });
  assert.deepEqual(first.body.data, second.body.data);
  assert.equal(repository.appliedCount, 1);

  const repository2 = createStatefulGiftRepository();
  const [a, b] = await Promise.all([
    handleGiftRedeemRequest({ body: { giftId: "g-1", idempotencyKey: "k-2" }, user: authenticatedUser(), correlationId: "corr-3", deps: { repository: repository2 } }),
    handleGiftRedeemRequest({ body: { giftId: "g-1", idempotencyKey: "k-2" }, user: authenticatedUser(), correlationId: "corr-4", deps: { repository: repository2 } })
  ]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(repository2.appliedCount, 1);
});

test("handleGiftRedeemRequest: DIFFERENT idempotencyKeys are two distinct, independently-applied redemptions", async () => {
  const repository = createStatefulGiftRepository();
  const first = await handleGiftRedeemRequest({ body: { giftId: "g-1", idempotencyKey: "k-1" }, user: authenticatedUser(), correlationId: "corr-1", deps: { repository } });
  const second = await handleGiftRedeemRequest({ body: { giftId: "g-1", idempotencyKey: "k-2" }, user: authenticatedUser(), correlationId: "corr-2", deps: { repository } });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.notDeepEqual(first.body.data, second.body.data);
  assert.equal(repository.appliedCount, 2);
});

// --- Safe logging (requirement 8): never JWT/Email/UID/token/full body ---

test("handleGachaDrawRequest: console.error output never contains the user id or the raw error message", async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);

  try {
    const repository = createFakeRepository({ claimGachaDraw: { error: new Error("claim_gacha_draw: insufficient coins for user 11111111-1111-1111-1111-111111111111 (secret@example.com)") } });
    const result = await handleGachaDrawRequest({
      body: { idempotencyKey: "k-1" },
      user: authenticatedUser("11111111-1111-1111-1111-111111111111"),
      correlationId: "corr-log-1",
      deps: { repository }
    });

    assert.equal(result.statusCode, 409);
    assert.equal(logged.length, 1);
    const parsed = JSON.parse(logged[0]);
    assert.deepEqual(Object.keys(parsed).sort(), ["correlationId", "event", "level", "reason"]);
    assert.equal(parsed.correlationId, "corr-log-1");
    assert.doesNotMatch(logged[0], /11111111-1111-1111-1111-111111111111|secret@example\.com/);
  } finally {
    console.error = originalConsoleError;
  }
});

test("handleGiftRedeemRequest: console.error output never contains the user id or the raw error message", async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);

  try {
    const repository = createFakeRepository({ redeemGift: { error: new Error("redeem_gift_transaction: user 22222222-2222-2222-2222-222222222222 not found") } });
    await handleGiftRedeemRequest({
      body: { giftId: "g-1", idempotencyKey: "k-1" },
      user: authenticatedUser("22222222-2222-2222-2222-222222222222"),
      correlationId: "corr-log-2",
      deps: { repository }
    });

    assert.equal(logged.length, 1);
    const parsed = JSON.parse(logged[0]);
    assert.deepEqual(Object.keys(parsed).sort(), ["correlationId", "event", "level", "reason"]);
    assert.doesNotMatch(logged[0], /22222222-2222-2222-2222-222222222222/);
  } finally {
    console.error = originalConsoleError;
  }
});

test("classifyGiftFailureReason: fixed allowlist, unknown collapses to UNKNOWN", () => {
  assert.equal(classifyGiftFailureReason(new Error("redeem_gift_transaction: gift g-1 not found or not enabled")), "GIFT_NOT_FOUND");
  assert.equal(classifyGiftFailureReason(new Error("redeem_gift_transaction: idempotency key does not belong to this user")), "UNKNOWN");
});

test("toHttpStatus: maps known codes and falls back to 500", () => {
  assert.equal(toHttpStatus("INSUFFICIENT_COINS"), 409);
  assert.equal(toHttpStatus("MASCOT_NOT_FOUND"), 404);
  assert.equal(toHttpStatus("SOMETHING_UNKNOWN"), 500);
});

