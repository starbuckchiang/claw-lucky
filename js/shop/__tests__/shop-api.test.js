"use strict";

/**
 * P-AUTH-05B-2B: Node tests for `js/shop/shop-api.js`'s
 * `invokeShopOpsFunction()` retryable classification (mirrors
 * `js/api.js`'s `invokeWalletOpsFunction()` contract exactly — see
 * `js/__tests__/api.test.js`'s header for the full rationale) and the
 * secure Cart/Checkout adapter methods.
 *
 * `js/shop/shop-api.js` is a plain classic browser script wrapped in an
 * IIFE (`(function () { ...; window.ShopApi = {...}; })();`), no
 * `module.exports`. Loaded here the same way as `js/api.js`: define a
 * minimal fake `global.window` BEFORE `require()`-ing the file — free
 * (undeclared) references to `window` inside the closure resolve against
 * `global.window` at CALL time, so reassigning `global.window` between
 * tests is enough to swap in a different fake `functions.invoke()` per
 * test without needing to re-require the module.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

function setFakeWindow({ invoke } = {}) {
  global.window = {
    supabaseClient: {
      functions: { invoke: invoke || (async () => ({ data: null, error: null })) }
    }
  };
}

setFakeWindow();
require(path.join(__dirname, "..", "shop-api.js"));
const ShopApi = global.window.ShopApi;

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

// --- Requirement: respects the server's own explicit retryable value ---

test("addToCart: error.context present + parsed body has retryable:false (deterministic business rejection) -> retryable:false", async () => {
  setFakeWindow({
    invoke: async () => httpErrorResult({
      jsonBody: { ok: false, error: { code: "OUT_OF_STOCK", message: "已超過庫存數量", retryable: false } }
    })
  });

  await expectRetryable(() => ShopApi.addToCart("p-1", 1), false);
});

test("checkoutCart: error.context present + parsed body has retryable:false (cart empty) -> retryable:false", async () => {
  setFakeWindow({
    invoke: async () => httpErrorResult({
      jsonBody: { ok: false, error: { code: "CART_EMPTY", message: "好運籃是空的", retryable: false } }
    })
  });

  await expectRetryable(() => ShopApi.checkoutCart({ idempotencyKey: "k-1" }), false);
});

test("checkoutCart: error.context present + parsed body has retryable:true (generic checkout failure) -> retryable:true", async () => {
  setFakeWindow({
    invoke: async () => httpErrorResult({
      jsonBody: { ok: false, error: { code: "CHECKOUT_FAILED", message: "建立訂單失敗", retryable: true } }
    })
  });

  await expectRetryable(() => ShopApi.checkoutCart({ idempotencyKey: "k-1" }), true);
});

// --- error.context presence must NOT by itself force retryable:false ---

test("checkoutCart: HTTP 502 with a non-JSON (raw gateway error page) body -> retryable:true, NEVER false just because error.context exists", async () => {
  setFakeWindow({
    invoke: async () => httpErrorResult({ parseError: new SyntaxError("Unexpected token < in JSON at position 0") })
  });

  await expectRetryable(() => ShopApi.checkoutCart({ idempotencyKey: "k-1" }), true);
});

test("checkoutCart: HTTP response that parses as JSON but has NO recognizable `error` field -> retryable:true", async () => {
  setFakeWindow({ invoke: async () => httpErrorResult({ jsonBody: { message: "Internal Server Error" } }) });
  await expectRetryable(() => ShopApi.checkoutCart({ idempotencyKey: "k-1" }), true);

  setFakeWindow({ invoke: async () => httpErrorResult({ jsonBody: {} }) });
  await expectRetryable(() => ShopApi.checkoutCart({ idempotencyKey: "k-1" }), true);
});

test("checkoutCart: parsed error body is missing the retryable field entirely -> defaults to retryable:true, never guessed false", async () => {
  setFakeWindow({
    invoke: async () => httpErrorResult({ jsonBody: { ok: false, error: { code: "CHECKOUT_FAILED", message: "x" } } })
  });
  await expectRetryable(() => ShopApi.checkoutCart({ idempotencyKey: "k-1" }), true);
});

test("checkoutCart: no HTTP response at all (network-layer failure) -> retryable:true", async () => {
  setFakeWindow({ invoke: async () => networkErrorResult() });
  await expectRetryable(() => ShopApi.checkoutCart({ idempotencyKey: "k-1" }), true);
});

// --- Business-authority / call-shape contract ---

test("addToCart: sends ONLY productId/quantity to shop-ops — no price/owner id is ever part of the invoke() payload", async () => {
  let capturedPath;
  let capturedBody;
  setFakeWindow({
    invoke: async (path, options) => {
      capturedPath = path;
      capturedBody = options?.body;
      return { data: { ok: true, data: { id: "c-1", quantity: 1 } }, error: null };
    }
  });

  await ShopApi.addToCart("p-1", 1);

  assert.equal(capturedPath, "shop-ops/cart-add");
  assert.deepEqual(capturedBody, { productId: "p-1", quantity: 1 });
});

test("updateCartItem: clamps quantity to a safe integer range (1-99) before sending, never trusts an out-of-range/non-integer caller value", async () => {
  let capturedBody;
  setFakeWindow({
    invoke: async (_path, options) => {
      capturedBody = options?.body;
      return { data: { ok: true, data: { id: "c-1", quantity: capturedBody.quantity } }, error: null };
    }
  });

  await ShopApi.updateCartItem("c-1", { quantity: 500 });
  assert.equal(capturedBody.quantity, 99);

  await ShopApi.updateCartItem("c-1", { quantity: -5 });
  assert.equal(capturedBody.quantity, 1);

  await ShopApi.updateCartItem("c-1", { quantity: 3.9 });
  assert.equal(capturedBody.quantity, 3);
});

test("checkoutCart: throws locally (never calls the network) when idempotencyKey is missing", async () => {
  let invoked = false;
  setFakeWindow({ invoke: async () => { invoked = true; return { data: null, error: null }; } });

  await assert.rejects(() => ShopApi.checkoutCart({}), /idempotencyKey/);
  assert.equal(invoked, false);
});

test("removeCartItem: tolerant of an already-removed/not-owned item — resolves to false, does not throw", async () => {
  setFakeWindow({ invoke: async () => ({ data: { ok: true, data: { removed: false } }, error: null }) });
  const removed = await ShopApi.removeCartItem("c-not-mine");
  assert.equal(removed, false);
});

test("clearCart: sends an empty body — no userId in the payload", async () => {
  let capturedBody;
  setFakeWindow({
    invoke: async (_path, options) => {
      capturedBody = options?.body;
      return { data: { ok: true, data: { removedCount: 2 } }, error: null };
    }
  });

  await ShopApi.clearCart();
  assert.deepEqual(capturedBody, {});
});
