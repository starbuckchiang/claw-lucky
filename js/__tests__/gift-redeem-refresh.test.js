"use strict";

/**
 * gift-redeem-refresh-hotfix: Node tests for `js/gift.js`'s `handleRedeem()`
 * post-redeem refresh behavior.
 *
 * ROOT CAUSE this hotfix targets: before this fix, the redeemGift() call
 * and the subsequent loadUserData()/loadPublicGifts()/loadRedeemHistory()
 * refresh calls all shared ONE try/catch. A refresh failure AFTER a
 * server-confirmed successful redemption fell into the SAME catch block as
 * a genuine redeem failure — showing "兌換失敗，請重新整理後再試" (misleading;
 * the redemption had already committed) and clearing the idempotency key
 * (dangerous: a user retrying after seeing "failed" would trigger a
 * genuinely NEW, second real redemption with a freshly-minted key).
 *
 * `js/gift.js` is a plain classic browser script (an IIFE with no
 * `module.exports`/`window.X =` export) that registers its real work via a
 * `document.addEventListener("DOMContentLoaded", ...)` callback. It is
 * loaded here under Node the same way `js/__tests__/api.test.js` loads
 * `js/api.js`: by defining minimal fake `global.document`/`global.window`
 * objects BEFORE `require()`-ing the file (free/undeclared `document`/
 * `window` references inside the script resolve against the Node global
 * object at call time). Because the IIFE only runs ONCE per `require()`
 * (Node caches modules), each test deletes gift.js from `require.cache`
 * and re-requires it against a FRESH fake document/window, so every test
 * gets fully independent module state (no leakage of `state.isRedeeming`/
 * `pendingRedeemGiftId` between tests).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const GIFT_JS_PATH = require.resolve(path.join(__dirname, "..", "gift.js"));

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createFakeElement() {
  const el = {
    textContent: "",
    innerHTML: "",
    dataset: {},
    _hiddenClass: false,
    _listeners: {},
    classList: {
      toggle(cls, force) {
        if (cls === "hidden") {
          el._hiddenClass = typeof force === "boolean" ? force : !el._hiddenClass;
        }
      },
      contains(cls) {
        return cls === "hidden" ? el._hiddenClass : false;
      }
    },
    addEventListener(type, handler) {
      el._listeners[type] = handler;
    }
  };
  return el;
}

function createFakeDocument() {
  const elements = {};
  const doc = {
    _domReadyHandler: null,
    _elements: elements,
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = createFakeElement();
      }
      return elements[id];
    },
    addEventListener(type, handler) {
      if (type === "DOMContentLoaded") {
        doc._domReadyHandler = handler;
      }
    }
  };
  return doc;
}

function clickRedeemButton(doc, giftId) {
  const gridListeners = doc._elements.giftGrid._listeners;
  const handler = gridListeners.click;
  assert.ok(handler, "giftGrid click handler was never bound");
  const button = { dataset: { giftId: String(giftId), action: "redeem" } };
  handler({ target: { closest: () => button } });
}

function buildFakeApi(overrides = {}) {
  const calls = {
    getGiftList: 0,
    getUser: 0,
    getGiftById: 0,
    getRedeemHistory: 0,
    redeemGift: 0,
    redeemGiftArgs: []
  };

  return {
    calls,
    async getGiftList() {
      calls.getGiftList += 1;
      if (overrides.getGiftListImpl) return overrides.getGiftListImpl(calls.getGiftList);
      return overrides.gifts || [];
    },
    async getUser(userId) {
      calls.getUser += 1;
      if (overrides.getUserImpl) return overrides.getUserImpl(userId, calls.getUser);
      return overrides.user;
    },
    async getGiftById(giftId) {
      calls.getGiftById += 1;
      if (overrides.getGiftByIdImpl) return overrides.getGiftByIdImpl(giftId, calls.getGiftById);
      return (overrides.gifts || []).find((g) => String(g.id) === String(giftId));
    },
    async getRedeemHistory(userId) {
      calls.getRedeemHistory += 1;
      if (overrides.getRedeemHistoryImpl) return overrides.getRedeemHistoryImpl(userId, calls.getRedeemHistory);
      return overrides.history || [];
    },
    async redeemGift(args) {
      calls.redeemGift += 1;
      calls.redeemGiftArgs.push(args);
      return overrides.redeemGiftImpl(args, calls.redeemGift);
    }
  };
}

function buildFakeWindow({ api, userId = "auth-uid-1", nickname = "Tester", confirmResult = true }) {
  let uuidCounter = 0;
  return {
    Api: api,
    UserStore: {
      initUser: async () => ({ user_id: userId, nickname })
    },
    supabaseClient: {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: userId } } },
          error: null
        })
      }
    },
    crypto: {
      randomUUID() {
        uuidCounter += 1;
        return `fake-uuid-${uuidCounter}`;
      }
    },
    confirm: () => confirmResult
  };
}

function loadFreshGiftModule({ document, window }) {
  delete require.cache[GIFT_JS_PATH];
  global.document = document;
  global.window = window;
  require(GIFT_JS_PATH);
  return () => document._domReadyHandler();
}

function baseGift(overrides = {}) {
  return {
    id: "g1",
    name: "測試禮物",
    description: "",
    points_cost: 10,
    tickets_cost: 0,
    coins_cost: 0,
    stock: 5,
    enabled: true,
    sort_order: 1,
    ...overrides
  };
}

function baseUser(overrides = {}) {
  return { user_id: "auth-uid-1", nickname: "Tester", points: 100, tickets: 5, coins: 0, ...overrides };
}

function successRedeemResult(gift, overrides = {}) {
  return {
    ok: true,
    user: { points: gift.points_cost ? 100 - gift.points_cost : 100, tickets: 5, coins: 0 },
    redeemRecord: {
      id: 1,
      gift_id: gift.id,
      gift_name: gift.name,
      points_cost: gift.points_cost,
      tickets_cost: gift.tickets_cost,
      coins_cost: gift.coins_cost
    },
    ...overrides
  };
}

test("success: redeeming reloads wallet, gift inventory, and history from the server exactly once each, then shows a success status", async () => {
  const doc = createFakeDocument();
  const gift = baseGift();
  const api = buildFakeApi({
    gifts: [gift],
    user: baseUser(),
    redeemGiftImpl: () => successRedeemResult(gift)
  });
  const win = buildFakeWindow({ api });
  const domReady = loadFreshGiftModule({ document: doc, window: win });

  domReady();
  await flush();

  const beforeUserCalls = api.calls.getUser;
  const beforeGiftListCalls = api.calls.getGiftList;
  const beforeHistoryCalls = api.calls.getRedeemHistory;

  clickRedeemButton(doc, gift.id);
  await flush();

  assert.equal(api.calls.redeemGift, 1, "redeemGift should be called exactly once");
  assert.ok(api.calls.getUser > beforeUserCalls, "wallet must be reloaded from the server after a successful redeem");
  assert.ok(api.calls.getGiftList > beforeGiftListCalls, "gift inventory must be reloaded from the server after a successful redeem");
  assert.ok(api.calls.getRedeemHistory > beforeHistoryCalls, "redeem history must be reloaded from the server after a successful redeem");

  const statusEl = doc._elements.giftPageStatus;
  assert.match(statusEl.textContent, /兌換成功/);
  assert.equal(statusEl.dataset.tone, "success");
});

test("button stays disabled until ALL THREE post-redeem refresh calls settle, then re-enables", async () => {
  const doc = createFakeDocument();
  const gift = baseGift();
  let resolveSecondGiftList;
  const pendingSecondGiftList = new Promise((resolve) => {
    resolveSecondGiftList = resolve;
  });

  const api = buildFakeApi({
    gifts: [gift],
    user: baseUser(),
    redeemGiftImpl: () => successRedeemResult(gift),
    getGiftListImpl: (callCount) => (callCount <= 1 ? [gift] : pendingSecondGiftList)
  });
  const win = buildFakeWindow({ api });
  const domReady = loadFreshGiftModule({ document: doc, window: win });

  domReady();
  await flush();

  clickRedeemButton(doc, gift.id);
  await flush();

  // The gift-inventory refresh is still pending — the button must still be
  // rendered disabled ("處理中"), proving the UI does not re-enable early.
  assert.match(doc._elements.giftGrid.innerHTML, /disabled/);
  assert.match(doc._elements.giftGrid.innerHTML, /處理中/);

  resolveSecondGiftList([gift]);
  await flush();

  assert.doesNotMatch(doc._elements.giftGrid.innerHTML, /disabled/);
  assert.match(doc._elements.giftGrid.innerHTML, /立即兌換/);
});

test("success but refresh failure: does NOT re-call gift-redeem, and shows the honest 'refresh failed' message instead of 'redeem failed'", async () => {
  const doc = createFakeDocument();
  const gift = baseGift();
  const api = buildFakeApi({
    gifts: [gift],
    user: baseUser(),
    redeemGiftImpl: () => successRedeemResult(gift),
    getUserImpl: (userId, callCount) => {
      if (callCount <= 2) {
        // call 1 = page init, call 2 = pre-redeem "latestUser" check
        return baseUser();
      }
      // call 3 = the post-success loadUserData() refresh — force it to fail
      throw new Error("refresh network error");
    }
  });
  const win = buildFakeWindow({ api });
  const domReady = loadFreshGiftModule({ document: doc, window: win });

  domReady();
  await flush();

  clickRedeemButton(doc, gift.id);
  await flush();

  assert.equal(api.calls.redeemGift, 1, "a refresh failure must never trigger a second, automatic gift-redeem call");

  const statusEl = doc._elements.giftPageStatus;
  assert.equal(statusEl.textContent, "兌換已完成，但資料刷新失敗，請重新整理頁面");
  assert.equal(statusEl.dataset.tone, "warn");
  assert.doesNotMatch(statusEl.textContent, /兌換失敗/, "must never claim the redemption itself failed once it actually succeeded");
});

test("redeemGift itself fails: no refresh calls happen and no false success is shown", async () => {
  const doc = createFakeDocument();
  const gift = baseGift();
  const api = buildFakeApi({
    gifts: [gift],
    user: baseUser(),
    redeemGiftImpl: () => {
      const error = new Error("點數不足");
      error.retryable = false;
      throw error;
    }
  });
  const win = buildFakeWindow({ api });
  const domReady = loadFreshGiftModule({ document: doc, window: win });

  domReady();
  await flush();

  const userCallsAfterInit = api.calls.getUser;
  const giftListCallsAfterInit = api.calls.getGiftList;
  const historyCallsAfterInit = api.calls.getRedeemHistory;

  clickRedeemButton(doc, gift.id);
  await flush();

  assert.equal(api.calls.redeemGift, 1);
  // Only the pre-redeem "latestUser" check should add ONE extra getUser
  // call beyond page init — no post-success refresh calls should ever run.
  assert.equal(api.calls.getUser, userCallsAfterInit + 1);
  assert.equal(api.calls.getGiftList, giftListCallsAfterInit);
  assert.equal(api.calls.getRedeemHistory, historyCallsAfterInit);

  const statusEl = doc._elements.giftPageStatus;
  assert.equal(statusEl.textContent, "點數不足");
  assert.equal(statusEl.dataset.tone, "error");
});

test("history load failure during init shows a load-failed message, never a fake empty-history state", async () => {
  const doc = createFakeDocument();
  const gift = baseGift();
  const api = buildFakeApi({
    gifts: [gift],
    user: baseUser(),
    getRedeemHistoryImpl: () => {
      throw new Error("history query failed");
    },
    redeemGiftImpl: () => successRedeemResult(gift)
  });
  const win = buildFakeWindow({ api });
  const domReady = loadFreshGiftModule({ document: doc, window: win });

  domReady();
  await flush();

  assert.equal(doc._elements.historyError._hiddenClass, false, "historyError must be shown");
  assert.equal(doc._elements.historyEmpty._hiddenClass, true, "historyEmpty must NOT be shown on a genuine query error");
});

test("rapid double-click only submits one redeem request", async () => {
  const doc = createFakeDocument();
  const gift = baseGift();
  const api = buildFakeApi({
    gifts: [gift],
    user: baseUser(),
    redeemGiftImpl: () => successRedeemResult(gift)
  });
  const win = buildFakeWindow({ api });
  const domReady = loadFreshGiftModule({ document: doc, window: win });

  domReady();
  await flush();

  // Two synchronous clicks before any await settles — the second must be
  // ignored because `state.isRedeeming` is already set synchronously by
  // the first call before its first `await`.
  clickRedeemButton(doc, gift.id);
  clickRedeemButton(doc, gift.id);
  await flush();

  assert.equal(api.calls.redeemGift, 1);
});

test("a retryable redeem failure reuses the SAME idempotency key on the next attempt for the same gift", async () => {
  const doc = createFakeDocument();
  const gift = baseGift();
  const api = buildFakeApi({
    gifts: [gift],
    user: baseUser(),
    redeemGiftImpl: (args, callCount) => {
      if (callCount === 1) {
        const error = new Error("網路逾時");
        error.retryable = true;
        throw error;
      }
      return successRedeemResult(gift);
    }
  });
  const win = buildFakeWindow({ api });
  const domReady = loadFreshGiftModule({ document: doc, window: win });

  domReady();
  await flush();

  clickRedeemButton(doc, gift.id);
  await flush();

  clickRedeemButton(doc, gift.id);
  await flush();

  assert.equal(api.calls.redeemGift, 2);
  const [firstArgs, secondArgs] = api.calls.redeemGiftArgs;
  assert.equal(firstArgs.idempotencyKey, secondArgs.idempotencyKey, "a retryable failure must keep the same idempotency key alive for the retry");
});

test("a non-retryable redeem failure clears the idempotency key, so a later attempt for the same gift gets a FRESH key", async () => {
  const doc = createFakeDocument();
  const gift = baseGift();
  const api = buildFakeApi({
    gifts: [gift],
    user: baseUser(),
    redeemGiftImpl: (args, callCount) => {
      if (callCount === 1) {
        const error = new Error("庫存不足");
        error.retryable = false;
        throw error;
      }
      return successRedeemResult(gift);
    }
  });
  const win = buildFakeWindow({ api });
  const domReady = loadFreshGiftModule({ document: doc, window: win });

  domReady();
  await flush();

  clickRedeemButton(doc, gift.id);
  await flush();

  clickRedeemButton(doc, gift.id);
  await flush();

  assert.equal(api.calls.redeemGift, 2);
  const [firstArgs, secondArgs] = api.calls.redeemGiftArgs;
  assert.notEqual(firstArgs.idempotencyKey, secondArgs.idempotencyKey, "a non-retryable failure must clear the key so a new manual attempt never reuses it");
});

test("uses the current Supabase Auth UID for the wallet/history/redeem calls (never a stale/legacy id)", async () => {
  const doc = createFakeDocument();
  const gift = baseGift();
  const authUid = "real-auth-uid-xyz";
  const seenUserIds = [];
  const api = buildFakeApi({
    gifts: [gift],
    user: baseUser({ user_id: authUid }),
    getUserImpl: (userId) => {
      seenUserIds.push(userId);
      return baseUser({ user_id: authUid });
    },
    getRedeemHistoryImpl: (userId) => {
      seenUserIds.push(userId);
      return [];
    },
    redeemGiftImpl: () => successRedeemResult(gift)
  });
  const win = buildFakeWindow({ api, userId: authUid });
  const domReady = loadFreshGiftModule({ document: doc, window: win });

  domReady();
  await flush();

  clickRedeemButton(doc, gift.id);
  await flush();

  assert.ok(seenUserIds.length > 0);
  for (const userId of seenUserIds) {
    assert.equal(userId, authUid);
  }
});
