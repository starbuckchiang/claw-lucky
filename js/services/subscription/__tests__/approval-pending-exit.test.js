"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const flow = require("../paypal-subscription-flow");

function sessionResult(overrides = {}) {
  return {
    ok: true,
    checkout_session_id: "sess-1",
    plan_id: "P-LIVE",
    plan_code: "monthly",
    amount: "1.00",
    currency: "USD",
    paypal_subscription_id: null,
    ...overrides
  };
}

test("pending card offers continue and abandon, not cancel", () => {
  const ui = flow.resolveSubscriptionUiState({
    status: "APPROVAL_PENDING",
    plan_code: "monthly",
    paid_through: null
  });
  assert.equal(ui.mode, "approval_pending");
  assert.equal(ui.showReauthorize, true);
  assert.equal(ui.showAbandonCheckout, true);
  assert.equal(ui.showCancelButton, false);
  assert.equal(ui.allowNewSubscription, false);
  assert.equal(ui.showPlanButtons, false);
});

test("same plan continues and a different plan requires abandon", () => {
  const pending = flow.resolveSubscriptionUiState({
    status: "APPROVAL_PENDING",
    plan_code: "monthly"
  });
  assert.equal(flow.resolvePendingPlanChoice(pending, "monthly"), "continue");
  assert.equal(flow.resolvePendingPlanChoice(pending, "yearly"), "require_abandon");
  const expired = flow.resolveSubscriptionUiState({
    status: "EXPIRED_SETUP",
    plan_code: "monthly"
  });
  assert.equal(expired.allowNewSubscription, true);
  assert.equal(expired.showAbandonCheckout, undefined);
  assert.equal(flow.resolvePendingPlanChoice(expired, "yearly"), "checkout");
});

test("saved subscription id is reused and does not create or activate another", async () => {
  let created = 0;
  let confirmed = 0;
  const handlers = flow.createSubscriptionButtonHandlers({
    planCode: "monthly",
    busyLock: flow.createBusyLock(),
    subscriptionService: {
      async createSession() {
        return sessionResult({ paypal_subscription_id: "I-SAVED123" });
      },
      async confirmSubscription() {
        confirmed += 1;
        return { ok: true, status: "ACTIVE", paid_through: "2099-01-01T00:00:00Z" };
      }
    }
  });
  const id = await handlers.createSubscription({}, {
    subscription: {
      async create() {
        created += 1;
        return "I-NEW999";
      }
    }
  });
  assert.equal(id, "I-SAVED123");
  assert.equal(created, 0);
  assert.equal(confirmed, 0);
});

test("sdk create binds the id before returning and releases it when bind fails", async () => {
  const calls = [];
  const handlers = flow.createSubscriptionButtonHandlers({
    planCode: "yearly",
    busyLock: flow.createBusyLock(),
    subscriptionService: {
      async createSession() {
        calls.push("createSession");
        return sessionResult({ plan_code: "yearly", amount: "48.00" });
      },
      async confirmSubscription(input) {
        calls.push(`confirm:${input.subscriptionID}`);
        return {
          ok: true,
          status: "APPROVAL_PENDING",
          paid_through: null
        };
      },
      async releaseUnboundSubscription() {
        calls.push("release");
        return { ok: true };
      }
    }
  });
  const id = await handlers.createSubscription({}, {
    subscription: {
      async create() {
        calls.push("sdk");
        return "I-NEW123";
      }
    }
  });
  assert.equal(id, "I-NEW123");
  assert.deepEqual(calls, ["createSession", "sdk", "confirm:I-NEW123"]);

  const failed = [];
  const failing = flow.createSubscriptionButtonHandlers({
    planCode: "monthly",
    busyLock: flow.createBusyLock(),
    subscriptionService: {
      async createSession() {
        return sessionResult();
      },
      async confirmSubscription() {
        return { ok: false, error: { code: "DB_ERROR", message: "保存失敗" } };
      },
      async releaseUnboundSubscription(input) {
        failed.push(input.subscriptionID);
        return { ok: true, cancelled: true };
      }
    }
  });
  await assert.rejects(
    () => failing.createSubscription({}, {
      subscription: { async create() { return "I-ORPHAN1"; } }
    }),
    /保存失敗/
  );
  assert.deepEqual(failed, ["I-ORPHAN1"]);
});

test("a second click while checkout is starting does not create another subscription", async () => {
  let created = 0;
  let releaseCreate;
  const gate = new Promise((resolve) => {
    releaseCreate = resolve;
  });
  const handlers = flow.createSubscriptionButtonHandlers({
    planCode: "monthly",
    busyLock: flow.createBusyLock(),
    subscriptionService: {
      async createSession() {
        await gate;
        return sessionResult({ paypal_subscription_id: "I-SAVED123" });
      }
    }
  });
  const actions = {
    subscription: {
      async create() {
        created += 1;
        return "I-SHOULDNOT";
      }
    }
  };
  const first = handlers.createSubscription({}, actions);
  const second = handlers.createSubscription({}, actions);
  releaseCreate();
  assert.equal(await first, "I-SAVED123");
  await assert.rejects(second, /BUSY/);
  assert.equal(created, 0);
});
