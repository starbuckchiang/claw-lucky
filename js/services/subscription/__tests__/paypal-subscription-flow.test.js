"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const flow = require("../paypal-subscription-flow");

const ROOT = path.resolve(__dirname, "../../../..");

test("SDK URL uses vault=true intent=subscription currency=USD components=buttons", () => {
  const url = flow.buildPaypalSdkUrl("CLIENT");
  assert.match(url, /intent=subscription/);
  assert.match(url, /vault=true/);
  assert.match(url, /currency=USD/);
  assert.match(url, /components=buttons/);
  assert.doesNotMatch(url, /intent=capture/);
  assert.equal(flow.SDK_INTENT, "subscription");
  assert.equal(flow.SDK_VAULT, "true");
});

test("subscription.html does not load paypal-checkout or createOrder path", () => {
  const html = fs.readFileSync(path.join(ROOT, "subscription.html"), "utf8");
  assert.match(html, /paypal-subscription-service\.js/);
  assert.match(html, /paypal-subscription-flow\.js/);
  assert.doesNotMatch(html, /paypal-checkout-service\.js/);
  assert.match(html, /自動續訂/);
  assert.doesNotMatch(html, /一次性方案付款/);
  assert.match(html, /data-plan-id="monthly"/);
  assert.match(html, /data-plan-id="yearly"/);
});

test("subscription-entry.js does not call createOrder or capture_order", () => {
  const src = fs.readFileSync(path.join(ROOT, "js/pages/subscription-entry.js"), "utf8");
  assert.doesNotMatch(src, /\bcreateOrder\b/);
  assert.doesNotMatch(src, /\bcapture_order\b/);
  assert.doesNotMatch(src, /\bcaptureOrder\b/);
  assert.doesNotMatch(src, /paypal-checkout/);
  assert.match(src, /createSubscription/);
  assert.match(src, /onApprove/);
  assert.match(src, /paypal-subscription/);
  assert.match(src, /cancelSubscription/);
});

test("buildCreateSubscriptionPayload uses server plan_id and custom_id=checkout_session_id", () => {
  const payload = flow.buildCreateSubscriptionPayload({
    checkout_session_id: "sess-abc",
    plan_id: "P-FROM-SERVER",
    plan_code: "monthly",
    amount: "5.00",
    currency: "USD"
  });
  assert.deepEqual(payload, {
    plan_id: "P-FROM-SERVER",
    custom_id: "sess-abc"
  });
});

test("frontend flow never hardcodes PayPal Plan IDs", () => {
  const flowSrc = fs.readFileSync(
    path.join(ROOT, "js/services/subscription/paypal-subscription-flow.js"),
    "utf8"
  );
  const entrySrc = fs.readFileSync(path.join(ROOT, "js/pages/subscription-entry.js"), "utf8");
  assert.doesNotMatch(flowSrc, /\bP-[0-9][A-Z0-9]{6,}\b/);
  assert.doesNotMatch(entrySrc, /\bP-[0-9][A-Z0-9]{6,}\b/);
  assert.doesNotMatch(flowSrc, /PAYPAL_PLAN_ID_/);
  assert.doesNotMatch(entrySrc, /plan_id:\s*["']P-/);
});

test("createSubscription handlers: plan_code only, custom_id, double-click lock", async () => {
  const calls = [];
  const lock = flow.createBusyLock();
  const createdPayloads = [];
  const svc = {
    async createSession(input) {
      calls.push(input);
      return {
        ok: true,
        checkout_session_id: "sess-1",
        plan_id: "P-SERVER",
        plan_code: "monthly",
        amount: "5.00",
        currency: "USD"
      };
    },
    async confirmSubscription() {
      return { ok: true };
    }
  };

  const handlers = flow.createSubscriptionButtonHandlers({
    subscriptionService: svc,
    planCode: "monthly",
    busyLock: lock
  });

  const actions = {
    subscription: {
      create(payload) {
        createdPayloads.push(payload);
        return Promise.resolve("I-SUB");
      }
    }
  };

  await handlers.createSubscription({}, actions);
  assert.deepEqual(calls[0], { planCode: "monthly" });
  assert.deepEqual(createdPayloads[0], {
    plan_id: "P-SERVER",
    custom_id: "sess-1"
  });
  assert.equal(lock.isBusy(), true);

  await assert.rejects(() => handlers.createSubscription({}, actions), /BUSY/);
  assert.equal(calls.length, 1);

  lock.release();
});

test("onApprove confirms with subscriptionID + checkout_session_id only", async () => {
  const confirms = [];
  const lock = flow.createBusyLock();
  const handlers = flow.createSubscriptionButtonHandlers({
    subscriptionService: {
      async createSession() {
        return {
          ok: true,
          checkout_session_id: "sess-9",
          plan_id: "P-1",
          plan_code: "yearly",
          amount: "48.00",
          currency: "USD"
        };
      },
      async confirmSubscription(input) {
        confirms.push(input);
        return {
          ok: true,
          subscription: {
            plan_code: "yearly",
            status: "APPROVED",
            paid_through: null,
            access_blocked: false
          }
        };
      }
    },
    planCode: "yearly",
    busyLock: lock
  });

  await handlers.createSubscription({}, {
    subscription: { create: async () => "I-9" }
  });
  assert.equal(lock.isBusy(), true);

  const result = await handlers.onApprove({ subscriptionID: "I-9" });
  assert.equal(result.ok, true);
  assert.deepEqual(confirms[0], {
    subscriptionID: "I-9",
    checkoutSessionId: "sess-9"
  });
  assert.equal(lock.isBusy(), false);
  assert.equal(result.subscription.paid_through, null);
});

test("confirm success UI must not claim entitlement without paid_through", () => {
  const awaiting = flow.resolveSubscriptionUiState({
    plan_code: "monthly",
    status: "ACTIVE",
    paid_through: null,
    access_blocked: false
  });
  assert.equal(awaiting.mode, "awaiting_first_payment");
  assert.match(awaiting.headline, /首期付款確認中/);
  assert.equal(awaiting.allowNewSubscription, false);
  assert.doesNotMatch(awaiting.headline, /訂閱使用中/);

  const future = new Date(Date.now() + 86400000).toISOString();
  const active = flow.resolveSubscriptionUiState({
    plan_code: "monthly",
    status: "ACTIVE",
    paid_through: future,
    access_blocked: false
  });
  assert.equal(active.mode, "active");
  assert.equal(active.headline, "訂閱使用中");
  assert.equal(active.showCancelButton, true);
  assert.equal(active.showPayButtons, false);
});

test("status modes: processing / cancelled access / suspended / blocked / expired", () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();

  assert.equal(
    flow.resolveSubscriptionUiState({
      status: "APPROVAL_PENDING",
      plan_code: "monthly"
    }).mode,
    "processing"
  );
  assert.equal(
    flow.resolveSubscriptionUiState({
      status: "APPROVED",
      plan_code: "monthly"
    }).showPlanButtons,
    false
  );

  const cancelled = flow.resolveSubscriptionUiState({
    status: "CANCELLED",
    plan_code: "yearly",
    paid_through: future
  });
  assert.equal(cancelled.mode, "cancelled_with_access");
  assert.equal(cancelled.allowNewSubscription, false);
  assert.match(cancelled.detail, /可使用至/);

  assert.equal(
    flow.resolveSubscriptionUiState({
      status: "SUSPENDED",
      plan_code: "monthly"
    }).showPayButtons,
    false
  );

  assert.equal(
    flow.resolveSubscriptionUiState({
      status: "ACTIVE",
      paid_through: future,
      access_blocked: true
    }).mode,
    "access_blocked"
  );

  assert.equal(
    flow.resolveSubscriptionUiState({
      status: "EXPIRED_SETUP",
      paid_through: past
    }).allowNewSubscription,
    true
  );

  assert.equal(flow.resolveSubscriptionUiState(null).showPlanButtons, true);
});

test("status poller stops on paid_through, respects maxAttempts, supports stop()", async () => {
  const waits = [];
  let n = 0;
  const poller = flow.createStatusPoller({
    maxAttempts: 5,
    initialDelayMs: 1,
    maxDelayMs: 2,
    backoffFactor: 2,
    wait: async (ms) => {
      waits.push(ms);
    },
    getStatus: async () => {
      n += 1;
      if (n < 3) {
        return {
          ok: true,
          subscription: {
            status: "ACTIVE",
            paid_through: null,
            access_blocked: false
          }
        };
      }
      return {
        ok: true,
        subscription: {
          status: "ACTIVE",
          paid_through: new Date(Date.now() + 60000).toISOString(),
          access_blocked: false
        }
      };
    }
  });

  const outcome = await poller.run();
  assert.equal(outcome.complete, true);
  assert.ok(outcome.subscription.paid_through);
  assert.ok(outcome.attempts >= 3);
  assert.ok(waits.length >= 1);

  const timed = flow.createStatusPoller({
    maxAttempts: 2,
    initialDelayMs: 1,
    wait: async () => {},
    getStatus: async () => ({
      ok: true,
      subscription: { status: "ACTIVE", paid_through: null }
    })
  });
  const timedOut = await timed.run();
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.attempts, 2);

  let calls = 0;
  const stoppable = flow.createStatusPoller({
    maxAttempts: 10,
    initialDelayMs: 1,
    wait: async () => {},
    getStatus: async () => {
      calls += 1;
      return { ok: true, subscription: { status: "ACTIVE", paid_through: null } };
    }
  });
  const runPromise = stoppable.run();
  stoppable.stop();
  const stopped = await runPromise;
  assert.equal(stopped.stopped, true);
  assert.ok(calls <= 2);
});

test("cancel confirmation message and busy lock prevent double cancel", () => {
  assert.match(flow.CANCEL_CONFIRM_MESSAGE, /不再自動續扣/);
  assert.match(flow.CANCEL_CONFIRM_MESSAGE, /已付款週期結束/);
  const lock = flow.createBusyLock();
  assert.equal(lock.tryAcquire(), true);
  assert.equal(lock.tryAcquire(), false);
  lock.release();
  assert.equal(lock.tryAcquire(), true);
});

test("onCancel does not auto-retry and shows safe message", () => {
  const lock = flow.createBusyLock();
  lock.tryAcquire();
  const handlers = flow.createSubscriptionButtonHandlers({
    subscriptionService: { createSession: async () => ({ ok: true }) },
    planCode: "monthly",
    busyLock: lock
  });
  const info = handlers.onCancel();
  assert.match(info.message, /尚未完成訂閱/);
  assert.match(info.hint, /30/);
  assert.equal(lock.isBusy(), false);
});

test("auth expired detection stops payment flow safely", async () => {
  assert.equal(
    flow.isAuthExpiredError({ error: { code: "AUTH_EXPIRED" } }),
    true
  );
  const lock = flow.createBusyLock();
  let authHits = 0;
  const handlers = flow.createSubscriptionButtonHandlers({
    subscriptionService: {
      async createSession() {
        return { ok: false, error: { code: "AUTH_EXPIRED", message: "expired" } };
      }
    },
    planCode: "monthly",
    busyLock: lock,
    onAuthExpired: () => {
      authHits += 1;
    }
  });

  await assert.rejects(
    () => handlers.createSubscription({}, { subscription: { create: async () => "x" } }),
    /AUTH_EXPIRED/
  );
  assert.equal(authHits, 1);
  assert.equal(lock.isBusy(), false);
});

test("sanitizeUserError strips JWT, emails, plan/sub ids, paypal bodies", () => {
  assert.equal(
    flow.sanitizeUserError({ message: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb" }),
    "操作失敗，請稍後再試。"
  );
  assert.equal(
    flow.sanitizeUserError({ message: "fail user@example.com" }),
    "操作失敗，請稍後再試。"
  );
  assert.equal(
    flow.sanitizeUserError({ message: "plan P-5KH0123456789" }),
    "操作失敗，請稍後再試。"
  );
  assert.equal(
    flow.sanitizeUserError({ message: "訂閱請求失敗，請稍後再試。" }),
    "訂閱請求失敗，請稍後再試。"
  );
});

test("loadPaypalSubscriptionSdk replaces capture SDK and avoids duplicate scripts", async () => {
  const removed = [];
  const appended = [];
  const nodes = [
    {
      src: "https://www.paypal.com/sdk/js?client-id=X&currency=USD&intent=capture",
      parentNode: { removeChild(n) { removed.push(n); } }
    }
  ];

  const fakeDoc = {
    querySelectorAll(sel) {
      if (String(sel).includes("paypal.com/sdk/js")) {
        return nodes.filter((n) => !removed.includes(n));
      }
      return [];
    },
    createElement() {
      return {
        src: "",
        async: false,
        dataset: {},
        onload: null,
        onerror: null,
        addEventListener() {}
      };
    },
    head: {
      appendChild(script) {
        appended.push(script);
        nodes.push(script);
        setTimeout(() => {
          globalThis.paypal = { Buttons() {} };
          if (script.onload) script.onload();
        }, 0);
      }
    }
  };

  const paypal = await flow.loadPaypalSubscriptionSdk({
    clientId: "CLIENT",
    documentRef: fakeDoc,
    existingPaypal: null
  });

  assert.equal(removed.length, 1);
  assert.equal(appended.length, 1);
  assert.match(appended[0].src, /intent=subscription/);
  assert.match(appended[0].src, /vault=true/);
  assert.ok(paypal.Buttons);
  delete globalThis.paypal;
});

test("yearly and monthly plan codes are the only UI plan codes", () => {
  const html = fs.readFileSync(path.join(ROOT, "subscription.html"), "utf8");
  const ids = [...html.matchAll(/data-plan-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), ["monthly", "yearly"]);
});
