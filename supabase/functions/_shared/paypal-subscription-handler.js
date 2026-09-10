"use strict";

/**
 * Auth-07C.4 paypal-subscription shared handler (Node twin).
 * JWT Edge actions: create_session / confirm_subscription / get_status / cancel_subscription.
 * user_id ONLY from verified JWT — never request body.
 * Entitlement (paid_through) is granted only via verified PAYMENT.SALE.COMPLETED webhook.
 */

const {
  resolveSubscriptionPlanAllowlist,
  isAllowlistedPaypalPlanId,
  planCodeForPaypalPlanId,
  getPaypalPlan
} = require("./lib/paypal-plans");
const {
  createPaypalClient,
  normalizeMerchantId,
  amountsEqual
} = require("./lib/paypal-client");

const ACCEPTABLE_CONFIRM_STATUSES = new Set([
  "APPROVAL_PENDING",
  "APPROVED",
  "ACTIVE"
]);

const CANCELLABLE_STATUSES = new Set([
  "APPROVAL_PENDING",
  "APPROVED",
  "ACTIVE",
  "SUSPENDED"
]);

const CANCEL_REASON = "Customer requested cancellation";

const ERROR_HTTP_STATUS = Object.freeze({
  AUTH_REQUIRED: 401,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  ACCOUNT_UPGRADE_REQUIRED: 403,
  IDENTITY_NOT_VERIFIED: 403,
  INVALID_REQUEST: 400,
  INVALID_PLAN: 400,
  PLAN_NOT_CONFIGURED: 503,
  SUBSCRIPTION_SLOT_OCCUPIED: 409,
  CHECKOUT_SESSION_NOT_FOUND: 404,
  CHECKOUT_SESSION_OWNER_MISMATCH: 403,
  CHECKOUT_SESSION_EXPIRED: 410,
  CUSTOM_ID_MISMATCH: 400,
  PLAN_ID_MISMATCH: 400,
  SUBSCRIPTION_STATUS_INVALID: 409,
  SUBSCRIPTION_NOT_FOUND: 404,
  SUBSCRIPTION_OWNER_MISMATCH: 403,
  SUBSCRIPTION_NOT_CANCELLABLE: 409,
  PAYPAL_CONFIG: 503,
  PAYPAL_GET_SUBSCRIPTION_FAILED: 502,
  PAYPAL_CANCEL_SUBSCRIPTION_FAILED: 502,
  DB_ERROR: 503,
  INTERNAL_ERROR: 500
});

function toHttpStatus(code) {
  return ERROR_HTTP_STATUS[code] || 500;
}

function errorBody(code, message, details = null) {
  return {
    ok: false,
    error: { code, message, details }
  };
}

function sanitizePaypalFailureDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  return {
    stage: details.stage != null ? String(details.stage) : null,
    status: details.status != null ? details.status : null,
    paypalName: details.paypalName != null ? String(details.paypalName) : null,
    paypalIssue: details.paypalIssue != null ? String(details.paypalIssue) : null,
    debugId: details.debugId != null ? String(details.debugId) : null,
    message: details.message != null ? String(details.message).slice(0, 120) : null,
    bodyOmitted: details.bodyOmitted === true,
    contentType: details.contentType != null ? String(details.contentType).slice(0, 80) : null
  };
}

function isEmailVerified(user) {
  return Boolean(user?.email_confirmed_at);
}

function isGoogleVerified(user) {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return identities.some((identity) => identity?.provider === "google");
}

/**
 * Official user + at least one verified identity (email OR Google).
 * user_id must come from this object — never from body.
 */
function requireVerifiedOfficialUser(user) {
  if (!user || !user.id) {
    return { ok: false, code: "AUTH_REQUIRED", message: "Authentication required." };
  }
  if (user.is_anonymous === true) {
    return {
      ok: false,
      code: "ACCOUNT_UPGRADE_REQUIRED",
      message: "Anonymous users cannot manage subscriptions."
    };
  }
  if (!isEmailVerified(user) && !isGoogleVerified(user)) {
    return {
      ok: false,
      code: "IDENTITY_NOT_VERIFIED",
      message: "At least one verified identity (email or Google) is required."
    };
  }
  return { ok: true, userId: String(user.id) };
}

function mapRpcException(error) {
  const msg = String(error?.message || error?.code || error || "");
  const known = [
    "SUBSCRIPTION_SLOT_OCCUPIED",
    "INVALID_PLAN",
    "INVALID_PAYPAL_PLAN_ID",
    "INVALID_USER",
    "INVALID_CHECKOUT_SESSION",
    "CHECKOUT_SESSION_NOT_FOUND",
    "CHECKOUT_SESSION_OWNER_MISMATCH",
    "CHECKOUT_SESSION_EXPIRED",
    "PAYPAL_SUBSCRIPTION_ALREADY_BOUND",
    "PAYPAL_SUBSCRIPTION_ID_IN_USE",
    "INVALID_PAYPAL_SUBSCRIPTION_ID"
  ];
  for (const code of known) {
    if (msg.includes(code)) {
      return {
        code,
        message: code === "SUBSCRIPTION_SLOT_OCCUPIED"
          ? "A subscription slot is already occupied."
          : code.replace(/_/g, " ").toLowerCase() + "."
      };
    }
  }
  return { code: "DB_ERROR", message: "Database operation failed." };
}

function formatAmount(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(2);
}

function safeSubscriptionSummary(row) {
  if (!row) return null;
  return {
    plan_code: row.plan_code || null,
    status: row.status || null,
    next_billing_time: row.next_billing_time || null,
    paid_through: row.paid_through || null,
    cancelled_at: row.cancelled_at || null,
    suspended_at: row.suspended_at || null,
    access_blocked: Boolean(row.access_blocked_at),
    reconciliation_status: row.reconciliation_status || "none"
  };
}

function extractPaypalPlanId(subscription) {
  return String(
    subscription?.plan_id
    || subscription?.planId
    || subscription?.billing_info?.plan_id
    || ""
  ).trim();
}

function extractCustomId(subscription) {
  const custom = subscription?.custom_id ?? subscription?.customId ?? null;
  return custom == null ? "" : String(custom).trim();
}

function extractNextBillingTime(subscription) {
  const raw = subscription?.billing_info?.next_billing_time
    || subscription?.billing_info?.next_billing_time
    || null;
  return raw ? String(raw) : null;
}

function extractSaleFieldsFromTransaction(tx) {
  if (!tx || typeof tx !== "object") return null;
  const status = String(tx.status || "").trim().toUpperCase();
  const saleId = String(tx.id || tx.sale_id || "").trim();
  const gross = tx.amount_with_breakdown?.gross_amount
    || tx.amount
    || null;
  const amount = gross?.value != null ? Number(gross.value) : (
    gross?.total != null ? Number(gross.total) : null
  );
  const currency = gross?.currency_code || gross?.currency || null;
  const paymentTime = tx.time || tx.create_time || null;
  return {
    status,
    saleId,
    amount: Number.isFinite(amount) ? amount : null,
    currency: currency ? String(currency).toUpperCase() : null,
    paymentTime: paymentTime ? String(paymentTime) : null
  };
}

/**
 * Auth-07C.7E: when ACTIVE + paid_through null, reconcile COMPLETED sales via
 * authenticated PayPal GET transactions + service-role RPC.
 * Browser never submits sale_id / amount / currency / paid_through.
 */
async function reconcileActiveSubscriptionIfNeeded({
  userId,
  row,
  deps
}) {
  if (!row) return row;
  const status = String(row.status || "").toUpperCase();
  if (status !== "ACTIVE") return row;
  if (row.paid_through) return row;

  const paypalSubscriptionId = String(row.paypal_subscription_id || "").trim();
  if (!paypalSubscriptionId) return row;

  const paypalClient = deps.paypalClient;
  const repo = deps.subscriptionRepository;
  const planEnv = deps.planEnv || {};

  if (!paypalClient?.getSubscription || !paypalClient?.getSubscriptionTransactions) {
    return row;
  }
  if (!repo?.reconcilePaypalSubscriptionSale) {
    return row;
  }

  let paypalSub;
  try {
    paypalSub = await paypalClient.getSubscription({
      subscriptionId: paypalSubscriptionId
    });
  } catch (_e) {
    return row;
  }

  const planId = extractPaypalPlanId(paypalSub);
  if (!planId || !isAllowlistedPaypalPlanId(planId, planEnv)) {
    return row;
  }
  const planCode = planCodeForPaypalPlanId(planId, planEnv);
  const plan = planCode ? getPaypalPlan(planCode) : null;
  if (!plan) return row;

  const customId = extractCustomId(paypalSub);
  const localSession = String(row.checkout_session_id || "").trim();
  if (!customId || !localSession || customId !== localSession) {
    return row;
  }
  if (String(row.user_id) !== String(userId)) {
    return row;
  }

  const nextBillingTime = extractNextBillingTime(paypalSub);

  let txPayload;
  try {
    txPayload = await paypalClient.getSubscriptionTransactions({
      subscriptionId: paypalSubscriptionId
    });
  } catch (_e) {
    return row;
  }

  const transactions = Array.isArray(txPayload?.transactions)
    ? txPayload.transactions
    : [];

  for (const tx of transactions) {
    const fields = extractSaleFieldsFromTransaction(tx);
    if (!fields || fields.status !== "COMPLETED") continue;
    if (!fields.saleId) continue;
    if (fields.currency !== plan.currency) continue;
    if (fields.amount == null || !amountsEqual(fields.amount, plan.amount)) continue;

    try {
      await repo.reconcilePaypalSubscriptionSale({
        userId,
        paypalSubscriptionId,
        paypalSaleId: fields.saleId,
        amount: fields.amount,
        currency: fields.currency,
        paymentTime: fields.paymentTime,
        nextBillingTime,
        sanitizedAudit: {
          source: "paypal_api_reconciliation",
          plan_id: planId,
          amount: fields.amount,
          currency: fields.currency
        }
      });
    } catch (_e) {
      // continue other sales
    }
  }

  if (typeof repo.findLatestByUserId === "function") {
    try {
      const refreshed = await repo.findLatestByUserId(userId);
      if (refreshed) return refreshed;
    } catch (_e) {
      // keep prior row
    }
  }
  return row;
}

async function handleCreateSession({ body, user, deps }) {
  const auth = requireVerifiedOfficialUser(user);
  if (!auth.ok) {
    return { statusCode: toHttpStatus(auth.code), body: errorBody(auth.code, auth.message) };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      statusCode: 400,
      body: errorBody("INVALID_REQUEST", "Request body must be a JSON object.")
    };
  }

  if (Object.prototype.hasOwnProperty.call(body, "userId")
    || Object.prototype.hasOwnProperty.call(body, "user_id")) {
    return {
      statusCode: 400,
      body: errorBody("INVALID_REQUEST", "user_id is not allowed in the request body.")
    };
  }

  const planCode = String(body.plan_code || body.planCode || "").trim().toLowerCase();
  const planEnv = deps.planEnv || {};
  const allowlisted = resolveSubscriptionPlanAllowlist(planCode, planEnv);
  if (!allowlisted) {
    const base = getPaypalPlan(planCode);
    if (!base) {
      return {
        statusCode: toHttpStatus("INVALID_PLAN"),
        body: errorBody("INVALID_PLAN", "plan_code must be monthly or yearly.")
      };
    }
    return {
      statusCode: toHttpStatus("PLAN_NOT_CONFIGURED"),
      body: errorBody("PLAN_NOT_CONFIGURED", "Subscription plan id is not configured.")
    };
  }

  const repo = deps.subscriptionRepository;
  if (!repo?.acquireSubscriptionSlot) {
    return {
      statusCode: 503,
      body: errorBody("DB_ERROR", "Subscription repository is not configured.")
    };
  }

  let slot;
  try {
    slot = await repo.acquireSubscriptionSlot({
      userId: auth.userId,
      planCode: allowlisted.planCode,
      paypalPlanId: allowlisted.paypalPlanId
    });
  } catch (error) {
    const mapped = mapRpcException(error);
    return {
      statusCode: toHttpStatus(mapped.code),
      body: errorBody(mapped.code, mapped.message)
    };
  }

  return {
    statusCode: 201,
    body: {
      ok: true,
      checkout_session_id: slot.checkout_session_id,
      plan_code: allowlisted.planCode,
      amount: formatAmount(slot.recurring_amount ?? allowlisted.amount),
      currency: slot.currency || allowlisted.currency,
      plan_id: allowlisted.paypalPlanId
    }
  };
}

async function resolvePendingEventsAfterBind(repo, paypalSubscriptionId, paypalClient, planEnv) {
  if (!repo?.listPendingResolutionEvents || !repo?.processSubscriptionWebhookEvent) {
    return;
  }

  let pending = [];
  try {
    pending = await repo.listPendingResolutionEvents(paypalSubscriptionId);
  } catch (_e) {
    return;
  }

  if (!Array.isArray(pending) || pending.length === 0) return;

  for (const event of pending) {
    try {
      const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
      const fields = {
        paypalEventId: String(event.paypal_event_id || event.paypalEventId || "").trim(),
        eventType: String(event.event_type || event.eventType || payload.event_type || "").trim(),
        paypalSubscriptionId: String(
          event.paypal_subscription_id
          || payload.paypal_subscription_id
          || paypalSubscriptionId
        ).trim(),
        paypalSaleId: event.paypal_sale_id || payload.paypal_sale_id || null,
        amount: payload.amount != null ? payload.amount : null,
        currency: payload.currency || null,
        paymentTime: payload.payment_time || null,
        nextBillingTime: payload.next_billing_time || null,
        targetStatus: payload.target_status || null,
        isFullRefund: payload.is_full_refund === true,
        sanitizedPayload: payload,
        processingHint: "processed"
      };

      if (!fields.paypalEventId || !fields.eventType) {
        continue;
      }

      // Refresh next_billing from PayPal when SALE and still missing.
      if (
        fields.eventType === "PAYMENT.SALE.COMPLETED"
        && !fields.nextBillingTime
        && paypalClient?.getSubscription
      ) {
        try {
          const sub = await paypalClient.getSubscription({
            subscriptionId: fields.paypalSubscriptionId
          });
          const planId = extractPaypalPlanId(sub);
          if (planId && !isAllowlistedPaypalPlanId(planId, planEnv || {})) {
            continue;
          }
          fields.nextBillingTime = extractNextBillingTime(sub);
          if (fields.nextBillingTime) {
            fields.sanitizedPayload = {
              ...fields.sanitizedPayload,
              next_billing_time: fields.nextBillingTime
            };
          }
        } catch (_e) {
          // skip safely
        }
      }

      if (typeof repo.deleteWebhookEvent === "function") {
        await repo.deleteWebhookEvent(fields.paypalEventId);
      }

      await repo.processSubscriptionWebhookEvent(fields);
    } catch (_e) {
      // skip safely — never fail confirm because of pending resolve
    }
  }
}

async function handleConfirmSubscription({ body, user, deps }) {
  const auth = requireVerifiedOfficialUser(user);
  if (!auth.ok) {
    return { statusCode: toHttpStatus(auth.code), body: errorBody(auth.code, auth.message) };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      statusCode: 400,
      body: errorBody("INVALID_REQUEST", "Request body must be a JSON object.")
    };
  }

  const subscriptionID = String(body.subscriptionID || body.subscription_id || "").trim();
  const checkoutSessionId = String(body.checkout_session_id || body.checkoutSessionId || "").trim();

  if (!subscriptionID || !checkoutSessionId) {
    return {
      statusCode: 400,
      body: errorBody(
        "INVALID_REQUEST",
        "subscriptionID and checkout_session_id are required."
      )
    };
  }

  const paypalClient = deps.paypalClient;
  const repo = deps.subscriptionRepository;
  const planEnv = deps.planEnv || {};

  if (!paypalClient?.getSubscription || !repo?.bindPaypalSubscription) {
    return {
      statusCode: 503,
      body: errorBody("PAYPAL_CONFIG", "Subscription confirm is not configured.")
    };
  }

  let paypalSub;
  try {
    paypalSub = await paypalClient.getSubscription({ subscriptionId: subscriptionID });
  } catch (error) {
    const details = sanitizePaypalFailureDetails(error?.details);
    return {
      statusCode: toHttpStatus("PAYPAL_GET_SUBSCRIPTION_FAILED"),
      body: errorBody(
        "PAYPAL_GET_SUBSCRIPTION_FAILED",
        "Failed to load PayPal subscription.",
        details
      )
    };
  }

  const customId = extractCustomId(paypalSub);
  if (customId !== checkoutSessionId) {
    return {
      statusCode: toHttpStatus("CUSTOM_ID_MISMATCH"),
      body: errorBody("CUSTOM_ID_MISMATCH", "PayPal custom_id does not match checkout session.")
    };
  }

  const paypalPlanId = extractPaypalPlanId(paypalSub);
  if (!paypalPlanId || !isAllowlistedPaypalPlanId(paypalPlanId, planEnv)) {
    return {
      statusCode: toHttpStatus("PLAN_ID_MISMATCH"),
      body: errorBody("PLAN_ID_MISMATCH", "PayPal plan_id is not allowlisted.")
    };
  }

  const paypalStatus = String(paypalSub.status || "").trim().toUpperCase();
  if (!ACCEPTABLE_CONFIRM_STATUSES.has(paypalStatus)) {
    return {
      statusCode: toHttpStatus("SUBSCRIPTION_STATUS_INVALID"),
      body: errorBody(
        "SUBSCRIPTION_STATUS_INVALID",
        "PayPal subscription status is not acceptable for confirm."
      )
    };
  }

  let bound;
  try {
    bound = await repo.bindPaypalSubscription({
      userId: auth.userId,
      checkoutSessionId,
      paypalSubscriptionId: subscriptionID
    });
  } catch (error) {
    const mapped = mapRpcException(error);
    return {
      statusCode: toHttpStatus(mapped.code),
      body: errorBody(mapped.code, mapped.message)
    };
  }

  // Confirm MUST NOT set paid_through — entitlement waits for SALE.COMPLETED
  // (or Auth-07C.7E server-side reconciliation of COMPLETED transactions).
  await resolvePendingEventsAfterBind(
    repo,
    subscriptionID,
    paypalClient,
    planEnv
  );

  // Re-read after pending resolve so summary reflects SALE if resolved.
  let summaryRow = bound;
  if (typeof repo.findByCheckoutSessionId === "function") {
    try {
      const refreshed = await repo.findByCheckoutSessionId(checkoutSessionId);
      if (refreshed) summaryRow = refreshed;
    } catch (_e) {
      // keep bound
    }
  }

  summaryRow = await reconcileActiveSubscriptionIfNeeded({
    userId: auth.userId,
    row: summaryRow,
    deps
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      checkout_session_id: checkoutSessionId,
      paypal_subscription_id: subscriptionID,
      plan_code: summaryRow.plan_code || planCodeForPaypalPlanId(paypalPlanId, planEnv),
      status: summaryRow.status || paypalStatus,
      paid_through: summaryRow.paid_through || null,
      subscription: safeSubscriptionSummary(summaryRow)
    }
  };
}

async function handleGetStatus({ user, deps }) {
  const auth = requireVerifiedOfficialUser(user);
  if (!auth.ok) {
    return { statusCode: toHttpStatus(auth.code), body: errorBody(auth.code, auth.message) };
  }

  const repo = deps.subscriptionRepository;
  if (!repo?.findLatestByUserId) {
    return {
      statusCode: 503,
      body: errorBody("DB_ERROR", "Subscription repository is not configured.")
    };
  }

  let row;
  try {
    if (typeof repo.releaseSubscriptionSlotIfDue === "function") {
      await repo.releaseSubscriptionSlotIfDue(auth.userId);
    }
    row = await repo.findLatestByUserId(auth.userId);
  } catch (_error) {
    return {
      statusCode: toHttpStatus("DB_ERROR"),
      body: errorBody("DB_ERROR", "Failed to load subscription status.")
    };
  }

  if (!row) {
    return {
      statusCode: 200,
      body: { ok: true, subscription: null }
    };
  }

  row = await reconcileActiveSubscriptionIfNeeded({
    userId: auth.userId,
    row,
    deps
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      subscription: safeSubscriptionSummary(row)
    }
  };
}

async function handleCancelSubscription({ body, user, deps }) {
  const auth = requireVerifiedOfficialUser(user);
  if (!auth.ok) {
    return { statusCode: toHttpStatus(auth.code), body: errorBody(auth.code, auth.message) };
  }

  const repo = deps.subscriptionRepository;
  const paypalClient = deps.paypalClient;

  if (!repo?.findLatestByUserId || !paypalClient?.cancelSubscription) {
    return {
      statusCode: 503,
      body: errorBody("PAYPAL_CONFIG", "Subscription cancel is not configured.")
    };
  }

  let row;
  try {
    row = await repo.findLatestByUserId(auth.userId);
  } catch (_error) {
    return {
      statusCode: toHttpStatus("DB_ERROR"),
      body: errorBody("DB_ERROR", "Failed to load subscription.")
    };
  }

  if (!row || !row.paypal_subscription_id) {
    return {
      statusCode: toHttpStatus("SUBSCRIPTION_NOT_FOUND"),
      body: errorBody("SUBSCRIPTION_NOT_FOUND", "No cancellable subscription found.")
    };
  }

  if (String(row.user_id) !== auth.userId) {
    return {
      statusCode: toHttpStatus("SUBSCRIPTION_OWNER_MISMATCH"),
      body: errorBody("SUBSCRIPTION_OWNER_MISMATCH", "Subscription does not belong to this user.")
    };
  }

  const localStatus = String(row.status || "").toUpperCase();
  if (localStatus === "CANCELLED") {
    return {
      statusCode: 200,
      body: {
        ok: true,
        subscription: safeSubscriptionSummary(row),
        outcome: "already_cancelled"
      }
    };
  }

  if (!CANCELLABLE_STATUSES.has(localStatus)) {
    return {
      statusCode: toHttpStatus("SUBSCRIPTION_NOT_CANCELLABLE"),
      body: errorBody("SUBSCRIPTION_NOT_CANCELLABLE", "Subscription cannot be cancelled in its current status.")
    };
  }

  const paypalSubId = String(row.paypal_subscription_id);

  try {
    await paypalClient.cancelSubscription({
      subscriptionId: paypalSubId,
      reason: CANCEL_REASON
    });
  } catch (error) {
    const details = sanitizePaypalFailureDetails(error?.details);
    // If already cancelled on PayPal, continue to confirm via GET.
    const issue = String(details?.paypalIssue || details?.paypalName || "").toUpperCase();
    if (!/CANCEL|RESOURCE_NOT_FOUND|SUBSCRIPTION_STATUS_INVALID/i.test(issue)
      && error?.code !== "PAYPAL_CANCEL_SUBSCRIPTION_FAILED") {
      return {
        statusCode: toHttpStatus("PAYPAL_CANCEL_SUBSCRIPTION_FAILED"),
        body: errorBody(
          "PAYPAL_CANCEL_SUBSCRIPTION_FAILED",
          "PayPal cancel failed.",
          details
        )
      };
    }
    if (error?.code === "PAYPAL_CANCEL_SUBSCRIPTION_FAILED"
      && !/CANCEL|ALREADY|INVALID_STATUS|RESOURCE_NOT_FOUND/i.test(
        String(details?.paypalIssue || details?.paypalName || details?.message || "")
      )) {
      return {
        statusCode: toHttpStatus("PAYPAL_CANCEL_SUBSCRIPTION_FAILED"),
        body: errorBody(
          "PAYPAL_CANCEL_SUBSCRIPTION_FAILED",
          "PayPal cancel failed.",
          details
        )
      };
    }
  }

  let confirmed;
  try {
    confirmed = await paypalClient.getSubscription({ subscriptionId: paypalSubId });
  } catch (error) {
    const details = sanitizePaypalFailureDetails(error?.details);
    return {
      statusCode: toHttpStatus("PAYPAL_GET_SUBSCRIPTION_FAILED"),
      body: errorBody(
        "PAYPAL_GET_SUBSCRIPTION_FAILED",
        "Failed to confirm cancellation with PayPal.",
        details
      )
    };
  }

  const confirmedStatus = String(confirmed?.status || "").toUpperCase();
  if (confirmedStatus === "CANCELLED" && repo.processSubscriptionWebhookEvent) {
    try {
      await repo.processSubscriptionWebhookEvent({
        paypalEventId: `edge-cancel:${paypalSubId}`,
        eventType: "BILLING.SUBSCRIPTION.CANCELLED",
        paypalSubscriptionId: paypalSubId,
        paypalSaleId: null,
        amount: null,
        currency: null,
        paymentTime: null,
        nextBillingTime: extractNextBillingTime(confirmed),
        targetStatus: "CANCELLED",
        isFullRefund: false,
        sanitizedPayload: {
          source: "edge_cancel",
          paypal_subscription_id: paypalSubId,
          target_status: "CANCELLED"
        },
        processingHint: "processed"
      });
    } catch (_e) {
      // do not release slot early; surface DB error
      return {
        statusCode: toHttpStatus("DB_ERROR"),
        body: errorBody("DB_ERROR", "Failed to record cancellation.")
      };
    }
  }

  let refreshed = row;
  if (typeof repo.findLatestByUserId === "function") {
    try {
      refreshed = await repo.findLatestByUserId(auth.userId) || row;
    } catch (_e) {
      refreshed = row;
    }
  }

  return {
    statusCode: 200,
    body: {
      ok: true,
      subscription: safeSubscriptionSummary({
        ...refreshed,
        status: confirmedStatus === "CANCELLED" ? "CANCELLED" : refreshed.status
      }),
      outcome: confirmedStatus === "CANCELLED" ? "cancelled" : "cancel_pending"
    }
  };
}

async function handlePaypalSubscriptionRequest({ body, user, correlationId, deps = {} }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      statusCode: 400,
      body: errorBody("INVALID_REQUEST", "Request body must be a JSON object."),
      correlationId
    };
  }

  const action = String(body.action || "").trim();

  if (action === "create_session") {
    const result = await handleCreateSession({ body, user, deps });
    return { ...result, correlationId };
  }
  if (action === "confirm_subscription") {
    const result = await handleConfirmSubscription({ body, user, deps });
    return { ...result, correlationId };
  }
  if (action === "get_status") {
    const result = await handleGetStatus({ user, deps });
    return { ...result, correlationId };
  }
  if (action === "cancel_subscription") {
    const result = await handleCancelSubscription({ body, user, deps });
    return { ...result, correlationId };
  }

  return {
    statusCode: 400,
    body: errorBody(
      "INVALID_REQUEST",
      "action must be create_session, confirm_subscription, get_status, or cancel_subscription."
    ),
    correlationId
  };
}

function createSubscriptionRepositoryFromSupabase(serviceClient) {
  return {
    async acquireSubscriptionSlot({ userId, planCode, paypalPlanId }) {
      const { data, error } = await serviceClient.rpc("acquire_subscription_slot", {
        p_user_id: userId,
        p_plan_code: planCode,
        p_paypal_plan_id: paypalPlanId
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async bindPaypalSubscription({ userId, checkoutSessionId, paypalSubscriptionId }) {
      const { data, error } = await serviceClient.rpc("bind_paypal_subscription", {
        p_user_id: userId,
        p_checkout_session_id: checkoutSessionId,
        p_paypal_subscription_id: paypalSubscriptionId
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async processSubscriptionWebhookEvent(input) {
      const { data, error } = await serviceClient.rpc(
        "process_paypal_subscription_webhook_event",
        {
          p_paypal_event_id: input.paypalEventId,
          p_event_type: input.eventType,
          p_paypal_subscription_id: input.paypalSubscriptionId,
          p_paypal_sale_id: input.paypalSaleId,
          p_amount: input.amount,
          p_currency: input.currency,
          p_payment_time: input.paymentTime,
          p_next_billing_time: input.nextBillingTime,
          p_target_status: input.targetStatus,
          p_is_full_refund: input.isFullRefund === true,
          p_sanitized_payload: input.sanitizedPayload || {},
          p_processing_hint: input.processingHint || null
        }
      );
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async reconcilePaypalSubscriptionSale(input) {
      const { data, error } = await serviceClient.rpc(
        "reconcile_paypal_subscription_sale",
        {
          p_user_id: input.userId,
          p_paypal_subscription_id: input.paypalSubscriptionId,
          p_paypal_sale_id: input.paypalSaleId,
          p_amount: input.amount,
          p_currency: input.currency,
          p_payment_time: input.paymentTime,
          p_next_billing_time: input.nextBillingTime,
          p_sanitized_audit: input.sanitizedAudit || {}
        }
      );
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async findLatestByUserId(userId) {
      const { data, error } = await serviceClient
        .from("paypal_subscriptions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async findByCheckoutSessionId(checkoutSessionId) {
      const { data, error } = await serviceClient
        .from("paypal_subscriptions")
        .select("*")
        .eq("checkout_session_id", checkoutSessionId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async releaseSubscriptionSlotIfDue(userId) {
      const { error } = await serviceClient.rpc("release_subscription_slot_if_due", {
        p_user_id: userId
      });
      if (error) throw error;
    },

    async listPendingResolutionEvents(paypalSubscriptionId) {
      const { data, error } = await serviceClient
        .from("payment_webhook_events")
        .select("*")
        .eq("paypal_subscription_id", paypalSubscriptionId)
        .eq("processing_status", "pending_resolution");
      if (error) throw error;
      return data || [];
    },

    async deleteWebhookEvent(paypalEventId) {
      const { error } = await serviceClient
        .from("payment_webhook_events")
        .delete()
        .eq("paypal_event_id", paypalEventId)
        .eq("processing_status", "pending_resolution");
      if (error) throw error;
    }
  };
}

module.exports = {
  handlePaypalSubscriptionRequest,
  handleCreateSession,
  handleConfirmSubscription,
  handleGetStatus,
  handleCancelSubscription,
  createSubscriptionRepositoryFromSupabase,
  createPaypalClient,
  requireVerifiedOfficialUser,
  safeSubscriptionSummary,
  reconcileActiveSubscriptionIfNeeded,
  toHttpStatus,
  ERROR_HTTP_STATUS,
  ACCEPTABLE_CONFIRM_STATUSES,
  CANCEL_REASON,
  amountsEqual,
  normalizeMerchantId
};
