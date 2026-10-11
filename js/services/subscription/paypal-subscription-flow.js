"use strict";

/**
 * Auth-07C.6 — PayPal Subscriptions frontend flow helpers.
 * Pure / injectable logic for SDK params, createSubscription payload,
 * status UI modes, confirm polling, and cancel confirmation.
 * Never talks to PayPal REST directly; never hardcodes Plan IDs.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.PaypalSubscriptionFlow = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function factory() {
  const SDK_INTENT = "subscription";
  const SDK_VAULT = "true";
  const SDK_CURRENCY = "USD";
  const SDK_COMPONENTS = "buttons";

  const CANCEL_CONFIRM_MESSAGE =
    "取消後將不再自動續扣，但仍可使用至目前已付款週期結束。";

  const DEFAULT_POLL = Object.freeze({
    maxAttempts: 12,
    initialDelayMs: 1500,
    maxDelayMs: 8000,
    backoffFactor: 1.6
  });

  function buildPaypalSdkUrl(clientId) {
    const id = String(clientId || "").trim();
    if (!id) {
      throw new Error("PAYPAL_CLIENT_ID is required for PayPal SDK.");
    }
    const params = new URLSearchParams({
      "client-id": id,
      currency: SDK_CURRENCY,
      intent: SDK_INTENT,
      vault: SDK_VAULT,
      components: SDK_COMPONENTS
    });
    return `https://www.paypal.com/sdk/js?${params.toString()}`;
  }

  function isSubscriptionSdkUrl(src) {
    const url = String(src || "");
    if (!url.includes("paypal.com/sdk/js")) return false;
    return (
      /[?&]intent=subscription(?:&|$)/.test(url)
      && /[?&]vault=true(?:&|$)/.test(url)
      && !/[?&]intent=capture(?:&|$)/.test(url)
    );
  }

  function isLegacyOrdersSdkUrl(src) {
    const url = String(src || "");
    if (!url.includes("paypal.com/sdk/js")) return false;
    return /[?&]intent=capture(?:&|$)/.test(url);
  }

  // PROD-RELEASE-DAY3C (line 151-198): the NT$44 gift shipping-fee payment
  // is a one-time Orders v2 CAPTURE, fundamentally incompatible with the
  // subscription SDK config above (intent=subscription&vault=true) — the
  // PayPal JS SDK does not support mixing both in one script instance. By
  // the time this is needed the user is ALREADY a paying subscriber (the
  // gift is only ever granted after a first successful payment), so the
  // subscription SDK has already served its purpose and is safely replaced.
  function buildPaypalOrdersCaptureSdkUrl(clientId, currency) {
    const id = String(clientId || "").trim();
    if (!id) {
      throw new Error("PAYPAL_CLIENT_ID is required for PayPal SDK.");
    }
    const params = new URLSearchParams({
      "client-id": id,
      currency: String(currency || "TWD").trim().toUpperCase(),
      intent: "capture",
      components: SDK_COMPONENTS
    });
    return `https://www.paypal.com/sdk/js?${params.toString()}`;
  }

  function isOrdersCaptureSdkUrl(src) {
    const url = String(src || "");
    if (!url.includes("paypal.com/sdk/js")) return false;
    return (
      /[?&]intent=capture(?:&|$)/.test(url)
      && !/[?&]vault=true(?:&|$)/.test(url)
    );
  }

  /**
   * Load (or replace) the single PayPal SDK script with Orders v2 CAPTURE
   * params — replaces ANY other-configured SDK script already on the page
   * (mirrors loadPaypalSubscriptionSdk's own replace-in-place behavior).
   */
  function loadPaypalOrdersCaptureSdk({
    clientId,
    currency,
    documentRef,
    existingPaypal,
    createScriptElement
  } = {}) {
    const doc = documentRef || (typeof document !== "undefined" ? document : null);
    if (!doc) {
      return Promise.reject(new Error("document is required to load PayPal SDK."));
    }

    const desiredUrl = buildPaypalOrdersCaptureSdkUrl(clientId, currency);
    const scripts = Array.from(doc.querySelectorAll('script[src*="paypal.com/sdk/js"]'));

    for (const node of scripts) {
      if (!isOrdersCaptureSdkUrl(node.src)) {
        node.parentNode?.removeChild(node);
      }
    }

    const remaining = Array.from(doc.querySelectorAll('script[src*="paypal.com/sdk/js"]'));
    const matching = remaining.find((node) => isOrdersCaptureSdkUrl(node.src) && node.src === desiredUrl);

    if (matching && existingPaypal?.Buttons) {
      return Promise.resolve(existingPaypal);
    }

    if (matching && !existingPaypal?.Buttons) {
      return new Promise((resolve, reject) => {
        matching.addEventListener("load", () => {
          const scope = typeof window !== "undefined" ? window : globalThis;
          const paypal = scope.paypal || null;
          if (paypal?.Buttons) resolve(paypal);
          else reject(new Error("PayPal SDK 載入失敗。"));
        });
        matching.addEventListener("error", () => reject(new Error("PayPal SDK 無法載入。")));
      });
    }

    for (const node of remaining) {
      node.parentNode?.removeChild(node);
    }

    return new Promise((resolve, reject) => {
      const createEl = typeof createScriptElement === "function"
        ? createScriptElement
        : () => doc.createElement("script");
      const script = createEl();
      script.src = desiredUrl;
      script.async = true;
      script.dataset.paypalSdk = "orders-capture";
      script.onload = () => {
        const scope = typeof window !== "undefined" ? window : globalThis;
        const paypal = scope.paypal || null;
        if (paypal?.Buttons) resolve(paypal);
        else reject(new Error("PayPal SDK 載入失敗。"));
      };
      script.onerror = () => reject(new Error("PayPal SDK 無法載入。"));
      doc.head.appendChild(script);
    });
  }

  /**
   * createOrder/onApprove callback factory for the NT$44 gift shipping-fee
   * PayPal Buttons instance. Capture confirmation is ALWAYS re-verified
   * server-side afterward (confirmGiftShippingFeePayment) — the frontend's
   * own "approved" callback is never treated as proof of payment by itself.
   */
  function createGiftShippingFeeButtonHandlers({
    checkoutService,
    subscriptionService,
    busyLock,
    onOrderCreated,
    onAuthExpired,
    onSafeError
  }) {
    async function createOrder() {
      if (!busyLock.tryAcquire()) {
        throw new Error("BUSY");
      }
      try {
        const result = await checkoutService.createOrder({
          planCode: "gift_shipping_fee",
          idempotencyKey: `gift-shipping-fee:${Date.now()}`
        });
        if (isAuthExpiredError(result)) {
          busyLock.release();
          if (typeof onAuthExpired === "function") onAuthExpired(result);
          throw new Error("AUTH_EXPIRED");
        }
        if (!result?.ok || !result.orderId) {
          busyLock.release();
          const msg = sanitizeUserError(result, "無法建立運費付款，請稍後再試。");
          if (typeof onSafeError === "function") onSafeError(msg, result);
          throw new Error(msg);
        }
        if (typeof onOrderCreated === "function") onOrderCreated(result);
        return result.orderId;
      } catch (error) {
        if (busyLock.isBusy() && String(error?.message) !== "BUSY") {
          busyLock.release();
        }
        throw error;
      }
    }

    async function onApprove(data) {
      const orderId = String(data?.orderID || "").trim();
      try {
        const captured = await checkoutService.captureOrder({ orderId });
        if (isAuthExpiredError(captured)) {
          if (typeof onAuthExpired === "function") onAuthExpired(captured);
          return { ok: false, authExpired: true };
        }
        if (!captured?.ok) {
          return captured;
        }
        // Server-authoritative confirmation — never trust the capture
        // response alone to move the gift entitlement forward.
        const confirmed = await subscriptionService.confirmGiftShippingFeePayment({ paypalOrderId: orderId });
        if (isAuthExpiredError(confirmed)) {
          if (typeof onAuthExpired === "function") onAuthExpired(confirmed);
          return { ok: false, authExpired: true };
        }
        return confirmed;
      } finally {
        busyLock.release();
      }
    }

    function onCancel() {
      busyLock.release();
      return { message: "尚未完成運費付款", hint: "可再次點擊付款按鈕重試。" };
    }

    function onError() {
      busyLock.release();
      if (typeof onSafeError === "function") {
        onSafeError("運費付款發生錯誤，請稍後再試。");
      }
      return { message: "運費付款發生錯誤，請稍後再試。" };
    }

    return { createOrder, onApprove, onCancel, onError };
  }

  /**
   * Load (or replace) a single PayPal SDK script with subscription params.
   * Rejects duplicate inserts; replaces legacy capture SDK if found.
   */
  function loadPaypalSubscriptionSdk({
    clientId,
    documentRef,
    existingPaypal,
    createScriptElement
  } = {}) {
    const doc = documentRef || (typeof document !== "undefined" ? document : null);
    if (!doc) {
      return Promise.reject(new Error("document is required to load PayPal SDK."));
    }

    const desiredUrl = buildPaypalSdkUrl(clientId);
    const scripts = Array.from(doc.querySelectorAll('script[src*="paypal.com/sdk/js"]'));

    for (const node of scripts) {
      if (isLegacyOrdersSdkUrl(node.src) || !isSubscriptionSdkUrl(node.src)) {
        node.parentNode?.removeChild(node);
      }
    }

    const remaining = Array.from(doc.querySelectorAll('script[src*="paypal.com/sdk/js"]'));
    const matching = remaining.find((node) => isSubscriptionSdkUrl(node.src));

    if (matching && existingPaypal?.Buttons) {
      return Promise.resolve(existingPaypal);
    }

    if (matching && !existingPaypal?.Buttons) {
      return new Promise((resolve, reject) => {
        matching.addEventListener("load", () => {
          const scope = typeof window !== "undefined" ? window : globalThis;
          const paypal = scope.paypal || null;
          if (paypal?.Buttons) resolve(paypal);
          else reject(new Error("PayPal SDK 載入失敗。"));
        });
        matching.addEventListener("error", () => reject(new Error("PayPal SDK 無法載入。")));
      });
    }

    // Drop any leftover non-matching scripts so we never have two SDKs.
    for (const node of remaining) {
      node.parentNode?.removeChild(node);
    }

    return new Promise((resolve, reject) => {
      const createEl = typeof createScriptElement === "function"
        ? createScriptElement
        : () => doc.createElement("script");
      const script = createEl();
      script.src = desiredUrl;
      script.async = true;
      script.dataset.paypalSdk = "subscription";
      script.onload = () => {
        const scope = typeof window !== "undefined" ? window : globalThis;
        const paypal = scope.paypal || null;
        if (paypal?.Buttons) resolve(paypal);
        else reject(new Error("PayPal SDK 載入失敗。"));
      };
      script.onerror = () => reject(new Error("PayPal SDK 無法載入。"));
      doc.head.appendChild(script);
    });
  }

  function buildCreateSubscriptionPayload(session) {
    const planId = String(session?.plan_id || "").trim();
    const checkoutSessionId = String(session?.checkout_session_id || "").trim();
    if (!planId || !checkoutSessionId) {
      throw new Error("Server session is missing plan_id or checkout_session_id.");
    }
    return {
      plan_id: planId,
      custom_id: checkoutSessionId
    };
  }

  function parseTimeMs(value) {
    if (value == null || value === "") return null;
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : null;
  }

  function isPaidThroughValid(paidThrough, nowMs) {
    const ms = parseTimeMs(paidThrough);
    return ms != null && ms > nowMs;
  }

  function formatLocalDateTime(utcValue, timeZone) {
    const ms = parseTimeMs(utcValue);
    if (ms == null) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timeZone || undefined
      }).format(new Date(ms));
    } catch (_e) {
      return new Date(ms).toLocaleString();
    }
  }

  /**
   * Map get_status.subscription → UI view model.
   */
  function resolveSubscriptionUiState(subscription, { nowMs = Date.now() } = {}) {
    if (!subscription) {
      return {
        mode: "none",
        showPlanButtons: true,
        showPayButtons: true,
        showCancelButton: false,
        headline: "",
        detail: "",
        planCode: null,
        status: null,
        paidThroughLocal: "",
        nextBillingLocal: "",
        allowNewSubscription: true
      };
    }

    const status = String(subscription.status || "").toUpperCase();
    const planCode = subscription.plan_code || null;
    const paidThroughLocal = formatLocalDateTime(subscription.paid_through);
    const nextBillingLocal = formatLocalDateTime(subscription.next_billing_time);
    const paidOk = isPaidThroughValid(subscription.paid_through, nowMs);
    const accessBlocked = Boolean(subscription.access_blocked);

    if (accessBlocked) {
      return {
        mode: "access_blocked",
        showPlanButtons: false,
        showPayButtons: false,
        showCancelButton: false,
        headline: "訂閱權益已暫停",
        detail: "請聯絡客服協助處理。",
        planCode,
        status,
        paidThroughLocal,
        nextBillingLocal,
        allowNewSubscription: false
      };
    }

    if (status === "APPROVAL_PENDING" || status === "APPROVED") {
      return {
        mode: "processing",
        showPlanButtons: false,
        showPayButtons: false,
        showCancelButton: false,
        headline: "訂閱申請處理中",
        detail: "請稍候，系統正在確認訂閱申請。",
        planCode,
        status,
        paidThroughLocal,
        nextBillingLocal,
        allowNewSubscription: false
      };
    }

    if (status === "ACTIVE" && paidOk) {
      return {
        mode: "active",
        showPlanButtons: false,
        showPayButtons: false,
        showCancelButton: true,
        headline: "訂閱使用中",
        detail: "自動續訂進行中。可取消自動續訂；取消後仍可使用至已付款週期結束。",
        planCode,
        status,
        paidThroughLocal,
        nextBillingLocal,
        allowNewSubscription: false
      };
    }

    if (status === "ACTIVE" && !paidOk) {
      return {
        mode: "awaiting_first_payment",
        showPlanButtons: false,
        showPayButtons: false,
        showCancelButton: false,
        headline: "首期付款確認中",
        detail: "訂閱已核准，正在確認首期付款。權益啟用前請稍候。",
        planCode,
        status,
        paidThroughLocal,
        nextBillingLocal,
        allowNewSubscription: false
      };
    }

    if (status === "CANCELLED" && paidOk) {
      return {
        mode: "cancelled_with_access",
        showPlanButtons: false,
        showPayButtons: false,
        showCancelButton: false,
        headline: "已取消自動續訂",
        detail: paidThroughLocal
          ? `可使用至 ${paidThroughLocal}。到期前無法建立第二張訂閱。`
          : "可使用至目前已付款週期結束。到期前無法建立第二張訂閱。",
        planCode,
        status,
        paidThroughLocal,
        nextBillingLocal,
        allowNewSubscription: false
      };
    }

    if (status === "SUSPENDED") {
      return {
        mode: "suspended",
        showPlanButtons: false,
        showPayButtons: false,
        showCancelButton: false,
        headline: "訂閱已暫停",
        detail: "請至 PayPal 或聯絡客服確認付款方式後再試。",
        planCode,
        status,
        paidThroughLocal,
        nextBillingLocal,
        allowNewSubscription: false
      };
    }

    if (
      status === "EXPIRED"
      || status === "EXPIRED_SETUP"
      || (status === "CANCELLED" && !paidOk)
    ) {
      return {
        mode: "expired",
        showPlanButtons: true,
        showPayButtons: true,
        showCancelButton: false,
        headline: "訂閱已結束",
        detail: "可重新選擇方案訂閱。",
        planCode,
        status,
        paidThroughLocal,
        nextBillingLocal,
        allowNewSubscription: true
      };
    }

    return {
      mode: "unknown",
      showPlanButtons: false,
      showPayButtons: false,
      showCancelButton: false,
      headline: "訂閱狀態更新中",
      detail: "請稍後重新整理頁面。",
      planCode,
      status,
      paidThroughLocal,
      nextBillingLocal,
      allowNewSubscription: false
    };
  }

  function shouldStopStatusPoll(subscription, { nowMs = Date.now() } = {}) {
    if (!subscription) return false;
    if (subscription.access_blocked) return true;
    if (isPaidThroughValid(subscription.paid_through, nowMs)) return true;
    const status = String(subscription.status || "").toUpperCase();
    if (status === "SUSPENDED" || status === "EXPIRED" || status === "EXPIRED_SETUP") {
      return true;
    }
    if (status === "CANCELLED") return true;
    return false;
  }

  function createStatusPoller({
    getStatus,
    wait = (ms) => new Promise((r) => setTimeout(r, ms)),
    maxAttempts = DEFAULT_POLL.maxAttempts,
    initialDelayMs = DEFAULT_POLL.initialDelayMs,
    maxDelayMs = DEFAULT_POLL.maxDelayMs,
    backoffFactor = DEFAULT_POLL.backoffFactor,
    now = () => Date.now(),
    onTick
  } = {}) {
    if (typeof getStatus !== "function") {
      throw new Error("createStatusPoller requires getStatus().");
    }

    let stopped = false;

    function stop() {
      stopped = true;
    }

    async function run() {
      let delay = initialDelayMs;
      let last = null;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (stopped) {
          return { ok: true, stopped: true, subscription: last?.subscription ?? null, attempts: attempt };
        }

        if (attempt > 0) {
          await wait(delay);
          delay = Math.min(maxDelayMs, Math.round(delay * backoffFactor));
        }

        if (stopped) {
          return { ok: true, stopped: true, subscription: last?.subscription ?? null, attempts: attempt };
        }

        const result = await getStatus();
        last = result;

        if (typeof onTick === "function") {
          onTick(result, attempt);
        }

        if (result?.error?.code === "AUTH_EXPIRED" || result?.error?.code === "JWT_EXPIRED") {
          return { ok: false, authExpired: true, subscription: null, attempts: attempt + 1 };
        }

        const sub = result?.subscription ?? null;
        if (shouldStopStatusPoll(sub, { nowMs: now() })) {
          return { ok: true, subscription: sub, attempts: attempt + 1, complete: true };
        }
      }

      return {
        ok: true,
        subscription: last?.subscription ?? null,
        attempts: maxAttempts,
        timedOut: true
      };
    }

    return { run, stop };
  }

  function createBusyLock() {
    let busy = false;
    return {
      isBusy() {
        return busy;
      },
      tryAcquire() {
        if (busy) return false;
        busy = true;
        return true;
      },
      release() {
        busy = false;
      }
    };
  }

  function isAuthExpiredError(resultOrError) {
    const code = String(
      resultOrError?.error?.code
      || resultOrError?.code
      || ""
    ).toUpperCase();
    const message = String(
      resultOrError?.error?.message
      || resultOrError?.message
      || ""
    ).toLowerCase();
    if (
      code === "AUTH_EXPIRED"
      || code === "JWT_EXPIRED"
      || code === "UNAUTHORIZED"
      || code === "SESSION_EXPIRED"
    ) {
      return true;
    }
    if (message.includes("jwt") && (message.includes("expired") || message.includes("invalid"))) {
      return true;
    }
    if (message.includes("not authenticated") || message.includes("session expired")) {
      return true;
    }
    return false;
  }

  function sanitizeUserError(error, fallback = "操作失敗，請稍後再試。") {
    const message = String(error?.message || error?.error?.message || "").trim();
    if (!message) return fallback;
    // Never surface tokens / emails / paypal ids / raw bodies.
    if (
      /eyJ[A-Za-z0-9_-]+\./.test(message)
      || /@/.test(message)
      || /\bP-[A-Z0-9]+\b/i.test(message)
      || /\bI-[A-Z0-9]+\b/i.test(message)
      || /paypal/i.test(message) && /\{/.test(message)
    ) {
      return fallback;
    }
    if (message.length > 160) return fallback;
    return message;
  }

  /**
   * createSubscription callback factory used by PayPal Buttons.
   * Locks against double-click; only sends plan_code to Edge.
   */
  function createSubscriptionButtonHandlers({
    subscriptionService,
    planCode,
    busyLock,
    onSessionCreated,
    onAuthExpired,
    onSafeError
  }) {
    const code = String(planCode || "").trim().toLowerCase();
    let checkoutSessionId = "";

    async function createSubscription(_data, actions) {
      if (!busyLock.tryAcquire()) {
        throw new Error("BUSY");
      }
      try {
        const result = await subscriptionService.createSession({ planCode: code });
        if (isAuthExpiredError(result)) {
          busyLock.release();
          if (typeof onAuthExpired === "function") onAuthExpired(result);
          throw new Error("AUTH_EXPIRED");
        }
        if (!result?.ok) {
          busyLock.release();
          const msg = sanitizeUserError(result, "無法建立訂閱工作階段，請稍後再試。");
          if (typeof onSafeError === "function") onSafeError(msg, result);
          throw new Error(msg);
        }
        checkoutSessionId = String(result.checkout_session_id || "");
        const payload = buildCreateSubscriptionPayload(result);
        if (typeof onSessionCreated === "function") {
          onSessionCreated({
            checkoutSessionId,
            planId: payload.plan_id,
            planCode: result.plan_code,
            amount: result.amount,
            currency: result.currency
          });
        }
        return actions.subscription.create(payload);
      } catch (error) {
        if (busyLock.isBusy()) {
          // keep lock only while PayPal modal may still be opening after success;
          // failures already released above except unexpected throws
          if (String(error?.message) !== "BUSY") {
            busyLock.release();
          }
        }
        throw error;
      }
    }

    async function onApprove(data) {
      const subscriptionID = String(data?.subscriptionID || "").trim();
      try {
        const result = await subscriptionService.confirmSubscription({
          subscriptionID,
          checkoutSessionId
        });
        if (isAuthExpiredError(result)) {
          if (typeof onAuthExpired === "function") onAuthExpired(result);
          return { ok: false, authExpired: true };
        }
        return result;
      } finally {
        busyLock.release();
      }
    }

    function onCancel() {
      busyLock.release();
      return {
        message: "尚未完成訂閱",
        hint: "若已開始申請但未綁定，約 30 分鐘後可再嘗試。不會自動重開 PayPal。"
      };
    }

    function onError() {
      busyLock.release();
      if (typeof onSafeError === "function") {
        onSafeError("訂閱流程發生錯誤，請稍後再試。");
      }
      return { message: "訂閱流程發生錯誤，請稍後再試。" };
    }

    return {
      createSubscription,
      onApprove,
      onCancel,
      onError,
      getCheckoutSessionId: () => checkoutSessionId
    };
  }

  return {
    SDK_INTENT,
    SDK_VAULT,
    SDK_CURRENCY,
    SDK_COMPONENTS,
    CANCEL_CONFIRM_MESSAGE,
    DEFAULT_POLL,
    buildPaypalSdkUrl,
    isSubscriptionSdkUrl,
    isLegacyOrdersSdkUrl,
    loadPaypalSubscriptionSdk,
    buildPaypalOrdersCaptureSdkUrl,
    isOrdersCaptureSdkUrl,
    loadPaypalOrdersCaptureSdk,
    createGiftShippingFeeButtonHandlers,
    buildCreateSubscriptionPayload,
    resolveSubscriptionUiState,
    shouldStopStatusPoll,
    createStatusPoller,
    createBusyLock,
    isAuthExpiredError,
    sanitizeUserError,
    createSubscriptionButtonHandlers,
    formatLocalDateTime,
    isPaidThroughValid
  };
});
