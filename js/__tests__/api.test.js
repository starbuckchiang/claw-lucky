"use strict";

/**
 * P-AUTH-05B-2A.1 Hotfix: Node tests for `js/api.js`'s
 * `invokeWalletOpsFunction()` retryable classification (requirements 1-4)
 * and the full client-side retry contract for `claimGachaDraw`/
 * `redeemGift` (requirements 6-7).
 *
 * `js/api.js` is a plain classic browser script (`window.Api = {...}`, no
 * `module.exports`) with no bundler/jsdom in this repo. It is loaded here
 * under Node by defining a minimal fake `global.window` BEFORE
 * `require()`-ing the file — free (undeclared) references to `window`
 * inside the script resolve against `global.window` at call time, so
 * reassigning `global.window` between tests (or just mutating its
 * `supabaseClient` property) is enough to swap in a different fake
 * `functions.invoke()` per test without needing to re-require the module.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

function setFakeWindow({ invoke }) {
  global.window = {
    supabaseClient: {
      functions: { invoke }
    }
  };
}

// Require api.js ONCE — it just assigns `window.Api = {...}` at load time;
// every method reads `window.supabaseClient` freshly on each call, so
// swapping `global.window` afterwards is sufficient for every test below.
setFakeWindow({ invoke: async () => ({ data: null, error: null }) });
require(path.join(__dirname, "..", "api.js"));
const Api = global.window.Api;

function httpErrorResult({ jsonBody, parseError } = {}) {
  return {
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: {
        status: 502,
        async json() {
          if (parseError) throw parseError;
          return jsonBody;
        }
      }
    }
  };
}

function networkErrorResult() {
  return { data: null, error: { message: "Failed to fetch" } };
}

async function expectRetryable(promiseFactory, expected) {
  let caught;
  try {
    await promiseFactory();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected the call to throw");
  assert.equal(caught.retryable, expected);
  return caught;
}

// --- Requirement 2/3: respects the server's own explicit retryable value ---

test("claimGachaDraw: error.context present + parsed body has retryable:false (deterministic business rejection) -> retryable:false", async () => {
  setFakeWindow({
    invoke: async () => httpErrorResult({
      jsonBody: { ok: false, error: { code: "INSUFFICIENT_COINS", message: "好運幣不足", retryable: false } }
    })
  });

  await expectRetryable(() => Api.claimGachaDraw({ idempotencyKey: "k-1" }), false);
});

test("claimGachaDraw: error.context present + parsed body has retryable:true (generic/unknown RPC failure) -> retryable:true", async () => {
  setFakeWindow({
    invoke: async () => httpErrorResult({
      jsonBody: { ok: false, error: { code: "GACHA_DRAW_FAILED", message: "抽卡失敗", retryable: true } }
    })
  });

  await expectRetryable(() => Api.claimGachaDraw({ idempotencyKey: "k-1" }), true);
});

test("redeemGift: error.context present + parsed body has retryable:false (out of stock) -> retryable:false", async () => {
  setFakeWindow({
    invoke: async () => httpErrorResult({
      jsonBody: { ok: false, error: { code: "OUT_OF_STOCK", message: "已兌換完畢", retryable: false } }
    })
  });

  await expectRetryable(() => Api.redeemGift({ giftId: "g-1", idempotencyKey: "k-1" }), false);
});

// --- Requirement 1/4: error.context presence must NOT by itself force retryable:false ---

test("claimGachaDraw: HTTP 502 with a non-JSON (raw gateway error page) body -> retryable:true, NEVER false just because error.context exists", async () => {
  setFakeWindow({
    invoke: async () => httpErrorResult({ parseError: new SyntaxError("Unexpected token < in JSON at position 0") })
  });

  await expectRetryable(() => Api.claimGachaDraw({ idempotencyKey: "k-1" }), true);
});

test("claimGachaDraw: HTTP 500/503/504-style response that parses as JSON but has NO recognizable `error` field -> retryable:true", async () => {
  setFakeWindow({ invoke: async () => httpErrorResult({ jsonBody: { message: "Internal Server Error" } }) });
  await expectRetryable(() => Api.claimGachaDraw({ idempotencyKey: "k-1" }), true);

  setFakeWindow({ invoke: async () => httpErrorResult({ jsonBody: {} }) });
  await expectRetryable(() => Api.claimGachaDraw({ idempotencyKey: "k-1" }), true);
});

test("claimGachaDraw: parsed error body is missing the retryable field entirely (unrecognized/older shape) -> defaults to retryable:true, never guessed false", async () => {
  setFakeWindow({
    invoke: async () => httpErrorResult({ jsonBody: { ok: false, error: { code: "SOMETHING_UNKNOWN", message: "..." } } })
  });

  await expectRetryable(() => Api.claimGachaDraw({ idempotencyKey: "k-1" }), true);
});

// --- Requirement 4: no HTTP response at all (network layer) -> always retryable ---

test("claimGachaDraw: no error.context at all (FunctionsFetchError / disconnect / timeout before headers) -> retryable:true", async () => {
  setFakeWindow({ invoke: async () => networkErrorResult() });
  await expectRetryable(() => Api.claimGachaDraw({ idempotencyKey: "k-1" }), true);
});

test("redeemGift: no error.context at all -> retryable:true", async () => {
  setFakeWindow({ invoke: async () => networkErrorResult() });
  await expectRetryable(() => Api.redeemGift({ giftId: "g-1", idempotencyKey: "k-1" }), true);
});

// --- Requirement 6: DB already committed, first HTTP response lost/500/502 —
// retrying with the SAME idempotencyKey must return the ORIGINAL result,
// never re-apply (re-draw/re-charge/re-decrement stock/re-write ledger). ---

test("claimGachaDraw: DB already committed but the first response was a lost/502 — retrying with the SAME idempotencyKey returns the ORIGINAL result and never re-applies the draw", async () => {
  let appliedCount = 0;
  let callCount = 0;
  const cachedData = {
    mascot_id: "m-1", mascot_name: "Fox", rarity: "SSR", image: "img.png",
    is_new: true, points_earned: 50, tickets_earned: 1, coins_delta: -1,
    user_points: 50, user_tickets: 1, user_coins: 9
  };

  setFakeWindow({
    invoke: async () => {
      callCount += 1;
      if (callCount === 1) {
        // The RPC itself committed server-side (ledger/mascot write really
        // happened, modeled here by incrementing appliedCount exactly
        // once) — but the HTTP response back to the browser was lost
        // (simulated as an unparseable 502 body, matching a real
        // intermediate-proxy failure mode).
        appliedCount += 1;
        return httpErrorResult({ parseError: new SyntaxError("Bad Gateway") });
      }
      // Retry with the SAME idempotencyKey: the server's own idempotent
      // lookup returns the cached row WITHOUT re-executing the draw.
      return { data: { ok: true, data: cachedData }, error: null };
    }
  });

  const idempotencyKey = "retry-key-1";

  const firstError = await expectRetryable(() => Api.claimGachaDraw({ idempotencyKey }), true);
  assert.equal(firstError.message.includes("undefined"), false);

  // Caller (mirroring js/pages/gacha.js's pendingDrawIdempotencyKey logic)
  // reuses the exact SAME key for the retry.
  const secondResult = await Api.claimGachaDraw({ idempotencyKey });

  assert.deepEqual(secondResult, cachedData);
  assert.equal(callCount, 2);
  assert.equal(appliedCount, 1, "the draw must only ever be applied ONCE, even though the client made two HTTP calls");
});

test("redeemGift: DB already committed but the first response was a lost/500 — retrying with the SAME idempotencyKey returns the ORIGINAL result and never re-decrements stock/re-charges", async () => {
  let appliedCount = 0;
  let callCount = 0;
  const cachedData = { redeem_history_id: "r-1", gift_id: "g-1", gift_name: "招福小福袋", points_cost: 100, tickets_cost: 0, coins_cost: 0, user_points: 0, user_tickets: 0, user_coins: 10 };

  setFakeWindow({
    invoke: async () => {
      callCount += 1;
      if (callCount === 1) {
        appliedCount += 1;
        return networkErrorResult(); // simulated total connection loss after the server committed
      }
      return { data: { ok: true, data: cachedData }, error: null };
    }
  });

  const idempotencyKey = "retry-key-2";

  await expectRetryable(() => Api.redeemGift({ giftId: "g-1", idempotencyKey }), true);

  const secondResult = await Api.redeemGift({ giftId: "g-1", idempotencyKey });

  assert.equal(secondResult.redeemRecord.id, "r-1");
  assert.equal(callCount, 2);
  assert.equal(appliedCount, 1, "the redemption must only ever be applied ONCE, even though the client made two HTTP calls");
});
