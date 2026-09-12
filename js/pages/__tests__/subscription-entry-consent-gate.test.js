"use strict";

// Frontend consent-gate tests for js/pages/subscription-entry.js
// (WEB-HOME-01A). Uses the js/gift.js testing pattern: fake
// global.window/document BEFORE require(), delete require.cache and
// re-require per test (the IIFE runs once per require).
//
// Proves (with backend mocked):
//  - unchecked consent checkbox  -> OTP never starts
//  - consent write FAILS         -> OTP never starts (localStorage never
//                                   treated as consent)
//  - consent write succeeds      -> OTP proceeds
//  - checkout consent write FAILS -> PayPal createSubscription (and the
//    session/slot acquisition inside it) is never invoked
//  - retry reuses the SAME consent idempotency key

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const PAGE_MODULE = path.join(__dirname, "..", "subscription-entry.js");

function makeEl() {
  const listeners = {};
  return {
    hidden: false,
    textContent: "",
    value: "",
    checked: false,
    disabled: false,
    innerHTML: "",
    dataset: {},
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    async click() {
      for (const fn of listeners.click || []) {
        await fn({ preventDefault() {} });
      }
    },
    _listeners: listeners
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function buildEnv({ consentImpl } = {}) {
  const registry = {};
  const getEl = (id) => (registry[id] = registry[id] || makeEl());

  const planButton = makeEl();
  planButton.dataset = { planId: "monthly", planLabel: "月訂閱" };

  const spies = {
    consentCalls: [],
    startUpgradeCalls: 0,
    createSessionCalls: 0,
    handlersCreateSubscriptionCalls: 0,
    capturedButtonsConfig: null
  };

  const consentRecord = consentImpl
    || (async () => ({ ok: true, data: { consentId: "c1" } }));

  const fakeDocument = {
    getElementById: getEl,
    querySelectorAll: (selector) => (selector === "[data-plan-id]" ? [planButton] : [])
  };

  const busyLockFactory = () => {
    let busy = false;
    return {
      tryAcquire() { if (busy) return false; busy = true; return true; },
      release() { busy = false; },
      isBusy() { return busy; }
    };
  };

  const handlersFake = {
    createSubscription: async () => {
      spies.handlersCreateSubscriptionCalls += 1;
      spies.createSessionCalls += 1;
      return "paypal-sub-id";
    },
    onApprove: async () => ({ ok: true }),
    onCancel: () => ({ message: "m", hint: "h" }),
    onError: () => ({ message: "m" })
  };

  const paypalFake = {
    Buttons: (config) => {
      spies.capturedButtonsConfig = config;
      return { render: async () => {} };
    }
  };

  const flowFake = {
    CANCEL_CONFIRM_MESSAGE: "confirm?",
    createBusyLock: busyLockFactory,
    sanitizeUserError: (error, fallback) => String(error?.message || fallback),
    isAuthExpiredError: () => false,
    resolveSubscriptionUiState: () => ({
      mode: "none",
      showPlanButtons: true,
      allowNewSubscription: true,
      showCancelButton: false
    }),
    createStatusPoller: () => ({ run: async () => ({}), stop() {} }),
    loadPaypalSubscriptionSdk: async () => paypalFake,
    createSubscriptionButtonHandlers: () => handlersFake
  };

  const guardInstance = {
    evaluateSubscriptionEntry: ({ checkoutContext }) => ({
      action: "ENTER_CHECKOUT",
      checkoutContext
    }),
    startUpgrade: async () => {
      spies.startUpgradeCalls += 1;
      return { ok: true, data: { otpPurpose: "email_change", email: "user@example.com" } };
    },
    startLoginOtp: async () => ({ ok: true, data: { otpPurpose: "email", email: "user@example.com" } }),
    beginAccountMerge: async () => ({ ok: false }),
    completeUpgradeAndResume: async () => ({ action: "NONE" }),
    completeLoginAndResume: async () => ({ action: "NONE" })
  };

  const fakeWindow = {
    PAYPAL_CLIENT_ID: "test-client-id",
    PAYPAL_ENV: "sandbox",
    localStorage: { getItem: () => null, setItem() {} },
    AuthService: { resolveAuthState: () => ({ isOfficialUser: false }) },
    EmailOtpService: { createEmailOtpService: () => ({}) },
    AccountMergeService: { createAccountMergeService: () => ({}) },
    SubscriptionEntryGuard: {
      ACTION: {
        ENTER_CHECKOUT: "ENTER_CHECKOUT",
        EXISTING_ACCOUNT_MERGE_REQUIRED: "EXISTING_ACCOUNT_MERGE_REQUIRED",
        UPGRADE_INCOMPLETE: "UPGRADE_INCOMPLETE"
      },
      createSubscriptionEntryGuard: () => guardInstance
    },
    PaypalSubscriptionService: {
      createPaypalSubscriptionService: () => ({
        getStatus: async () => ({ ok: true, subscription: null }),
        createSession: async () => ({ ok: true }),
        confirmSubscription: async () => ({ ok: true }),
        cancelSubscription: async () => ({ ok: true })
      })
    },
    PaypalSubscriptionFlow: flowFake,
    TermsConsent: {
      buildTermsConsentRecord: () => ({}),
      saveTermsConsentRecord: () => true
    },
    ConsentWriteService: {
      createConsentOpsInvoker: () => async () => ({ ok: true }),
      createConsentWriteService: () => ({
        recordConsent: async (payload) => {
          spies.consentCalls.push(payload);
          return consentRecord(payload);
        }
      })
    },
    supabaseClient: {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: "anon-user-1" } } },
          error: null
        })
      },
      functions: { invoke: async () => ({ data: { ok: true, subscription: null }, error: null }) }
    },
    UserStore: { initUser: async () => {} },
    confirm: () => true
  };

  return { fakeWindow, fakeDocument, registry, planButton, spies, guardInstance };
}

function loadPage(env) {
  global.window = env.fakeWindow;
  global.document = env.fakeDocument;
  delete require.cache[require.resolve(PAGE_MODULE)];
  require(PAGE_MODULE);
}

test("unchecked consent checkbox: OTP send is blocked, backend never called", async () => {
  const env = buildEnv();
  loadPage(env);

  const registry = env.registry;
  registry.otpEmailInput.value = "user@example.com";
  registry.termsConsentCheckbox.checked = false;

  await registry.sendOtpBtn.click();
  await flush();

  assert.equal(env.spies.startUpgradeCalls, 0);
  assert.equal(env.spies.consentCalls.length, 0);
  assert.match(registry.sendOtpStatus.textContent, /請先勾選/);
});

test("consent write FAILS: OTP send is blocked with a retryable zh-TW message", async () => {
  const env = buildEnv({
    consentImpl: async () => ({ ok: false, error: { code: "CONSENT_RECORD_FAILED", retryable: true } })
  });
  loadPage(env);

  const registry = env.registry;
  registry.otpEmailInput.value = "user@example.com";
  registry.termsConsentCheckbox.checked = true;

  await registry.sendOtpBtn.click();
  await flush();

  assert.equal(env.spies.consentCalls.length, 1);
  assert.equal(env.spies.startUpgradeCalls, 0);
  assert.match(registry.sendOtpStatus.textContent, /同意紀錄儲存失敗，請再試一次/);
});

test("consent write retry reuses the SAME idempotency key", async () => {
  const env = buildEnv({
    consentImpl: async () => ({ ok: false, error: { code: "CONSENT_RECORD_FAILED", retryable: true } })
  });
  loadPage(env);

  const registry = env.registry;
  registry.otpEmailInput.value = "user@example.com";
  registry.termsConsentCheckbox.checked = true;

  await registry.sendOtpBtn.click();
  await flush();
  await registry.sendOtpBtn.click();
  await flush();

  assert.equal(env.spies.consentCalls.length, 2);
  assert.equal(env.spies.consentCalls[0].idempotencyKey, env.spies.consentCalls[1].idempotencyKey);
  assert.equal(env.spies.consentCalls[0].consentScope, "account_upgrade");
  assert.equal(env.spies.consentCalls[0].source, "account_upgrade_form");
});

test("consent write succeeds: OTP proceeds (startUpgrade called once)", async () => {
  const env = buildEnv();
  loadPage(env);

  const registry = env.registry;
  registry.otpEmailInput.value = "user@example.com";
  registry.termsConsentCheckbox.checked = true;

  await registry.sendOtpBtn.click();
  await flush();

  assert.equal(env.spies.consentCalls.length, 1);
  assert.equal(env.spies.startUpgradeCalls, 1);
  // Frontend never sends versions/user id — only the 3 allowlisted fields.
  assert.deepEqual(
    Object.keys(env.spies.consentCalls[0]).sort(),
    ["consentScope", "idempotencyKey", "source"]
  );
});

test("checkout: consent write FAILS -> PayPal createSubscription/createSession never invoked", async () => {
  const env = buildEnv({
    consentImpl: async () => ({ ok: false, error: { code: "CONSENT_RECORD_FAILED", retryable: true } })
  });
  loadPage(env);

  // Reach the ready panel (official-user ENTER_CHECKOUT path).
  await env.planButton.click();
  await flush();
  await flush();

  const config = env.spies.capturedButtonsConfig;
  assert.ok(config, "PayPal Buttons config should have been captured");

  await assert.rejects(
    () => config.createSubscription({}, {}),
    /CONSENT_RECORD_FAILED/
  );

  assert.equal(env.spies.handlersCreateSubscriptionCalls, 0);
  assert.equal(env.spies.createSessionCalls, 0);
  assert.match(env.registry.paymentStatusText.textContent, /同意紀錄儲存失敗/);
});

test("checkout: consent write succeeds -> PayPal createSubscription proceeds", async () => {
  const env = buildEnv();
  loadPage(env);

  await env.planButton.click();
  await flush();
  await flush();

  const config = env.spies.capturedButtonsConfig;
  assert.ok(config, "PayPal Buttons config should have been captured");

  const result = await config.createSubscription({}, {});
  assert.equal(result, "paypal-sub-id");
  assert.equal(env.spies.handlersCreateSubscriptionCalls, 1);

  const checkoutCall = env.spies.consentCalls.find((c) => c.consentScope === "checkout");
  assert.ok(checkoutCall, "a checkout-scope consent write should have happened");
  assert.equal(checkoutCall.source, "subscription_page");
});

test("checkout: unchecked payment consent checkbox rejects the PayPal click", async () => {
  const env = buildEnv();
  loadPage(env);

  await env.planButton.click();
  await flush();
  await flush();

  const config = env.spies.capturedButtonsConfig;
  assert.ok(config);

  let rejected = false;
  let resolved = false;
  env.registry.paymentConsentCheckbox.checked = false;
  config.onClick({}, { reject: () => { rejected = true; }, resolve: () => { resolved = true; } });

  assert.equal(rejected, true);
  assert.equal(resolved, false);
  assert.match(env.registry.paymentStatusText.textContent, /請先勾選/);
});
