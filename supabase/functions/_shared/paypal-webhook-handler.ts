// ESM twin of paypal-webhook-handler.js — Auth-07A.1 / Auth-07C.4

import {
  extractCaptureMoney,
  normalizeMerchantId,
  amountsEqual,
} from "./lib/paypal-client.ts";
import {
  isAllowlistedPaypalPlanId,
  planCodeForPaypalPlanId,
  getPaypalPlan,
} from "./lib/paypal-plans.ts";

export const KNOWN_EVENT_TYPES = new Set([
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "CHECKOUT.ORDER.APPROVED",
]);

export const SUBSCRIPTION_EVENT_TYPES = new Set([
  "BILLING.SUBSCRIPTION.CREATED",
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
  "PAYMENT.SALE.COMPLETED",
  "PAYMENT.SALE.REFUNDED",
  "PAYMENT.SALE.REVERSED",
]);

// deno-lint-ignore no-explicit-any
function readPaypalHeader(headers: any, name: string) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    return headers.get(name) || headers.get(name.toLowerCase()) || "";
  }
  return headers[name] || headers[name.toLowerCase()] || "";
}

// deno-lint-ignore no-explicit-any
export function extractResourceFields(event: any) {
  const resource = event?.resource || {};
  const eventType = String(event?.event_type || "");

  if (eventType.startsWith("PAYMENT.CAPTURE.")) {
    const money = extractCaptureMoney(resource);
    const relatedOrderId = resource?.supplementary_data?.related_ids?.order_id
      || money.orderId
      || null;
    return {
      paypalOrderId: relatedOrderId ? String(relatedOrderId) : null,
      paypalCaptureId: money.captureId || resource.id || null,
      amount: money.amount,
      currency: money.currency,
      merchantId: money.merchantId || resource?.payee?.merchant_id || null,
    };
  }

  if (eventType === "CHECKOUT.ORDER.APPROVED") {
    const unit = resource?.purchase_units?.[0];
    return {
      paypalOrderId: resource.id || null,
      paypalCaptureId: null,
      amount: unit?.amount?.value || null,
      currency: unit?.amount?.currency_code || null,
      merchantId: unit?.payee?.merchant_id || null,
    };
  }

  return {
    paypalOrderId: null,
    paypalCaptureId: null,
    amount: null,
    currency: null,
    merchantId: null,
  };
}

export function isSubscriptionEventType(eventType: string) {
  return SUBSCRIPTION_EVENT_TYPES.has(String(eventType || "").trim());
}

// deno-lint-ignore no-explicit-any
function targetStatusForSubscriptionEvent(eventType: string, resource: any) {
  const type = String(eventType || "");
  if (type === "BILLING.SUBSCRIPTION.CREATED") return "APPROVAL_PENDING";
  if (type === "BILLING.SUBSCRIPTION.ACTIVATED") return "ACTIVE";
  if (type === "BILLING.SUBSCRIPTION.SUSPENDED") return "SUSPENDED";
  if (type === "BILLING.SUBSCRIPTION.CANCELLED") return "CANCELLED";
  if (type === "BILLING.SUBSCRIPTION.EXPIRED") return "EXPIRED";
  if (type === "BILLING.SUBSCRIPTION.UPDATED") {
    const status = String(resource?.status || "").toUpperCase();
    if (
      ["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED"].includes(
        status,
      )
    ) {
      return status;
    }
    return null;
  }
  return null;
}

// deno-lint-ignore no-explicit-any
function extractSaleFields(resource: any) {
  const amountTotal = resource?.amount?.total ?? resource?.amount?.value ?? null;
  const currency = resource?.amount?.currency || resource?.amount?.currency_code || null;
  return {
    paypalSubscriptionId: resource?.billing_agreement_id
      ? String(resource.billing_agreement_id).trim()
      : null,
    paypalSaleId: resource?.id ? String(resource.id).trim() : null,
    amount: amountTotal != null ? String(amountTotal) : null,
    currency: currency ? String(currency).toUpperCase() : null,
    paymentTime: resource?.create_time || resource?.update_time || null,
    merchantId: resource?.payee?.merchant_id || null,
    isFullRefund: resource?.state
      ? String(resource.state).toUpperCase() !== "PARTIAL"
      : true,
  };
}

// deno-lint-ignore no-explicit-any
export function extractSubscriptionResourceFields(event: any) {
  const resource = event?.resource || {};
  const eventType = String(event?.event_type || "");

  if (eventType.startsWith("PAYMENT.SALE.")) {
    return extractSaleFields(resource);
  }

  return {
    paypalSubscriptionId: resource?.id ? String(resource.id).trim() : null,
    paypalSaleId: null,
    amount: null,
    currency: null,
    paymentTime: null,
    merchantId: resource?.payee?.merchant_id || null,
    isFullRefund: false,
    nextBillingTime: resource?.billing_info?.next_billing_time || null,
    planId: resource?.plan_id || null,
    customId: resource?.custom_id || null,
    status: resource?.status || null,
  };
}

// deno-lint-ignore no-explicit-any
function sanitizeSubscriptionPayload(input: any) {
  return {
    event_type: input.eventType,
    paypal_subscription_id: input.paypalSubscriptionId || null,
    paypal_sale_id: input.paypalSaleId || null,
    amount: input.amount != null ? Number(input.amount) : null,
    currency: input.currency || null,
    payment_time: input.paymentTime || null,
    next_billing_time: input.nextBillingTime || null,
    target_status: input.targetStatus || null,
    is_full_refund: input.isFullRefund === true,
    plan_id: input.planId || null,
  };
}

// deno-lint-ignore no-explicit-any
// deno-lint-ignore no-explicit-any
function logSubscriptionWebhookResult({
  eventType,
  stage,
  verificationStatus,
  processingStatus,
  errorCode,
  merchantValidationSource
}: any) {
  try {
    console.log(JSON.stringify({
      event: "paypal_subscription_webhook_result",
      eventType: eventType || null,
      stage: stage || null,
      verificationStatus: verificationStatus || null,
      processingStatus: processingStatus || null,
      errorCode: errorCode || null,
      merchantValidationSource: merchantValidationSource || null
    }));
  } catch (_e) {
    // never throw from logging
  }
}

async function persistVerifiedReceived(repo: any, {
  paypalEventId,
  eventType,
  paypalSubscriptionId,
  paypalSaleId,
  sanitizedPayload
}) {
  if (typeof repo.ensureWebhookEventReceived === "function") {
    return repo.ensureWebhookEventReceived({
      paypalEventId,
      eventType,
      paypalSubscriptionId,
      paypalSaleId,
      sanitizedPayload
    });
  }
  // Fallback for older mocks: process with no-op received via process path.
  return { outcome: "received", event_processing_status: "received" };
}

async function markWebhookFailure(repo: any, {
  paypalEventId,
  errorCode,
  processingStatus = "failed",
  paypalSubscriptionId,
  paypalSaleId,
  sanitizedPayload,
  merchantValidationSource
}) {
  if (typeof repo.finalizeWebhookEventFailure === "function") {
    return repo.finalizeWebhookEventFailure({
      paypalEventId,
      errorCode,
      processingStatus,
      paypalSubscriptionId,
      paypalSaleId,
      sanitizedPayload,
      merchantValidationSource
    });
  }
  if (typeof repo.processSubscriptionWebhookEvent === "function") {
    return repo.processSubscriptionWebhookEvent({
      paypalEventId,
      eventType: "PAYMENT.SALE.COMPLETED",
      paypalSubscriptionId,
      paypalSaleId,
      amount: null,
      currency: null,
      paymentTime: null,
      nextBillingTime: null,
      targetStatus: null,
      isFullRefund: false,
      sanitizedPayload: {
        ...(sanitizedPayload || {}),
        error_code: errorCode,
        merchant_validation_source: merchantValidationSource || null
      },
      processingHint: "failed"
    });
  }
  return { outcome: "rejected", error_code: errorCode };
}

async function processSubscriptionWebhook({
  event,
  rawBody,
  deps
}) {
  const paypalClient = deps.paypalClient;
  const merchantIdExpected = String(deps.paypalMerchantId || "").trim();
  const repo = deps.webhookRepository;
  const planEnv = deps.planEnv || {};

  const paypalEventId = String(event.id || "").trim();
  const eventType = String(event.event_type || "").trim();
  const fields = extractSubscriptionResourceFields(event);

  let paypalSubscriptionId = fields.paypalSubscriptionId;
  let paypalSaleId = fields.paypalSaleId;
  let amount = fields.amount;
  let currency = fields.currency;
  let paymentTime = fields.paymentTime;
  let nextBillingTime = fields.nextBillingTime || null;
  let planId = fields.planId || null;
  let targetStatus = targetStatusForSubscriptionEvent(eventType, event.resource);
  const isFullRefund = fields.isFullRefund === true;
  let merchantValidationSource = null;

  if (!repo?.processSubscriptionWebhookEvent) {
    logSubscriptionWebhookResult({
      eventType,
      stage: "config",
      verificationStatus: "SUCCESS",
      processingStatus: null,
      errorCode: "PAYPAL_CONFIG"
    });
    return {
      statusCode: 503,
      body: { ok: false, error: { code: "PAYPAL_CONFIG", message: "Subscription webhook repo missing." } }
    };
  }

  const baseSanitized = sanitizeSubscriptionPayload({
    eventType,
    paypalSubscriptionId,
    paypalSaleId,
    amount,
    currency,
    paymentTime,
    nextBillingTime,
    targetStatus,
    isFullRefund,
    planId
  });

  // Auth-07C.7E: persist verified event BEFORE routing (never 200 with zero rows).
  try {
    await persistVerifiedReceived(repo, {
      paypalEventId,
      eventType,
      paypalSubscriptionId,
      paypalSaleId,
      sanitizedPayload: baseSanitized
    });
  } catch (_e) {
    logSubscriptionWebhookResult({
      eventType,
      stage: "ensure_received",
      verificationStatus: "SUCCESS",
      processingStatus: null,
      errorCode: "DB_ERROR"
    });
    return {
      statusCode: 503,
      body: { ok: false, error: { code: "DB_ERROR", message: "Failed to persist verified webhook event." } }
    };
  }

  async function rejectPersisted(errorCode, extra = {}) {
    const sanitizedPayload = {
      ...baseSanitized,
      ...extra.sanitizedPayload,
      merchant_validation_source: extra.merchantValidationSource || merchantValidationSource || null
    };
    try {
      await markWebhookFailure(repo, {
        paypalEventId,
        errorCode,
        processingStatus: extra.processingStatus || "failed",
        paypalSubscriptionId,
        paypalSaleId,
        sanitizedPayload,
        merchantValidationSource: extra.merchantValidationSource || merchantValidationSource
      });
    } catch (_e) {
      // still return 200 to avoid infinite PayPal retries once verified
    }
    logSubscriptionWebhookResult({
      eventType,
      stage: extra.stage || "validation",
      verificationStatus: "SUCCESS",
      processingStatus: extra.processingStatus || "failed",
      errorCode,
      merchantValidationSource: extra.merchantValidationSource || merchantValidationSource
    });
    return {
      statusCode: 200,
      body: { ok: true, outcome: "rejected", error: errorCode }
    };
  }

  // SALE merchant: distinguish missing vs mismatch.
  if (eventType.startsWith("PAYMENT.SALE.")) {
    const actual = normalizeMerchantId(fields.merchantId);
    const expected = normalizeMerchantId(merchantIdExpected);

    if (actual && expected && actual !== expected) {
      return rejectPersisted("MERCHANT_MISMATCH", { stage: "merchant" });
    }

    if (!actual) {
      // Missing payee merchant — do NOT treat as mismatch; use server authority.
      if (!paypalSubscriptionId) {
        return rejectPersisted("MISSING_BILLING_AGREEMENT_ID", { stage: "merchant_fallback" });
      }
      if (!paypalSaleId && eventType === "PAYMENT.SALE.COMPLETED") {
        return rejectPersisted("MISSING_SALE_ID", { stage: "merchant_fallback" });
      }
      if (!paypalClient?.getSubscription) {
        return rejectPersisted("MERCHANT_ID_MISSING_FROM_SALE_PAYLOAD", {
          stage: "merchant_fallback"
        });
      }

      let sub;
      try {
        sub = await paypalClient.getSubscription({ subscriptionId: paypalSubscriptionId });
      } catch (_e) {
        return rejectPersisted("MERCHANT_ID_MISSING_FROM_SALE_PAYLOAD", {
          stage: "merchant_fallback_get_failed"
        });
      }

      planId = sub?.plan_id || planId;
      nextBillingTime = sub?.billing_info?.next_billing_time || nextBillingTime;
      const customId = sub?.custom_id != null ? String(sub.custom_id).trim() : "";

      if (!planId || !isAllowlistedPaypalPlanId(planId, planEnv)) {
        return rejectPersisted("PLAN_ID_MISMATCH", { stage: "merchant_fallback" });
      }

      if (eventType === "PAYMENT.SALE.COMPLETED") {
        const code = planCodeForPaypalPlanId(planId, planEnv);
        const plan = code ? getPaypalPlan(code) : null;
        if (!plan) {
          return rejectPersisted("PLAN_ID_MISMATCH", { stage: "merchant_fallback" });
        }
        if (!currency || String(currency).toUpperCase() !== plan.currency) {
          return rejectPersisted("AMOUNT_CURRENCY_MISMATCH", { stage: "merchant_fallback" });
        }
        if (amount == null || !amountsEqual(amount, plan.amount)) {
          return rejectPersisted("AMOUNT_CURRENCY_MISMATCH", { stage: "merchant_fallback" });
        }
      }

      // custom_id / local bind: require GET custom_id present (server-bound session).
      if (!customId) {
        return rejectPersisted("CUSTOM_ID_MISSING", { stage: "merchant_fallback" });
      }

      merchantValidationSource = "verified_webhook_plus_authenticated_paypal_get";
    } else {
      merchantValidationSource = "sale_payee_merchant_id";

      if (paypalSubscriptionId && paypalClient?.getSubscription) {
        try {
          const sub = await paypalClient.getSubscription({
            subscriptionId: paypalSubscriptionId
          });
          planId = sub?.plan_id || planId;
          nextBillingTime = sub?.billing_info?.next_billing_time || nextBillingTime;
          if (planId && !isAllowlistedPaypalPlanId(planId, planEnv)) {
            return rejectPersisted("PLAN_ID_MISMATCH", { stage: "plan" });
          }
          if (eventType === "PAYMENT.SALE.COMPLETED" && planId) {
            const code = planCodeForPaypalPlanId(planId, planEnv);
            const plan = code ? getPaypalPlan(code) : null;
            if (plan) {
              if (currency && String(currency).toUpperCase() !== plan.currency) {
                return rejectPersisted("AMOUNT_CURRENCY_MISMATCH", { stage: "amount" });
              }
              if (amount != null && !amountsEqual(amount, plan.amount)) {
                return rejectPersisted("AMOUNT_CURRENCY_MISMATCH", { stage: "amount" });
              }
            }
          }
        } catch (_e) {
          // continue; RPC may pending_resolution
        }
      }
    }
  }

  // Lifecycle: optional GET for next_billing / plan.
  if (eventType.startsWith("BILLING.SUBSCRIPTION.")
    && paypalSubscriptionId
    && paypalClient?.getSubscription
    && eventType !== "BILLING.SUBSCRIPTION.PAYMENT.FAILED") {
    try {
      const sub = await paypalClient.getSubscription({
        subscriptionId: paypalSubscriptionId
      });
      planId = sub?.plan_id || planId;
      nextBillingTime = sub?.billing_info?.next_billing_time || nextBillingTime;
      if (planId && !isAllowlistedPaypalPlanId(planId, planEnv)) {
        return rejectPersisted("PLAN_ID_MISMATCH", { stage: "lifecycle_plan" });
      }
      if (!targetStatus && sub?.status) {
        targetStatus = targetStatusForSubscriptionEvent(
          "BILLING.SUBSCRIPTION.UPDATED",
          sub
        );
      }
    } catch (_e) {
      // continue with resource fields
    }
  }

  if (eventType === "PAYMENT.SALE.COMPLETED" && !paypalSaleId) {
    return rejectPersisted("MISSING_SALE_ID", { stage: "sale_id" });
  }
  if (eventType.startsWith("PAYMENT.SALE.") && !paypalSubscriptionId) {
    return rejectPersisted("MISSING_BILLING_AGREEMENT_ID", { stage: "billing_agreement" });
  }

  const sanitizedPayload = {
    ...sanitizeSubscriptionPayload({
      eventType,
      paypalSubscriptionId,
      paypalSaleId,
      amount,
      currency,
      paymentTime,
      nextBillingTime,
      targetStatus,
      isFullRefund,
      planId
    }),
    merchant_validation_source: merchantValidationSource
  };

  try {
    const result = await repo.processSubscriptionWebhookEvent({
      paypalEventId,
      eventType,
      paypalSubscriptionId,
      paypalSaleId,
      amount: amount != null && amount !== "" ? Number(amount) : null,
      currency,
      paymentTime,
      nextBillingTime,
      targetStatus,
      isFullRefund,
      sanitizedPayload,
      processingHint: "processed"
    });

    const outcome = result?.outcome || result?.[0]?.outcome || "processed";
    const errCode = result?.error_code || result?.[0]?.error_code || null;
    const processingStatus = result?.event_processing_status
      || result?.[0]?.event_processing_status
      || outcome;

    logSubscriptionWebhookResult({
      eventType,
      stage: "rpc",
      verificationStatus: "SUCCESS",
      processingStatus,
      errorCode: errCode,
      merchantValidationSource
    });

    if (outcome === "duplicate") {
      return { statusCode: 200, body: { ok: true, outcome: "duplicate" } };
    }
    if (outcome === "ignored") {
      return { statusCode: 200, body: { ok: true, outcome: "ignored" } };
    }
    if (outcome === "pending_resolution") {
      return {
        statusCode: 200,
        body: { ok: true, outcome: "pending_resolution", error: errCode || null }
      };
    }
    if (outcome === "rejected") {
      return {
        statusCode: 200,
        body: { ok: true, outcome: "rejected", error: errCode || "VALIDATION_FAILED" }
      };
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        outcome: "processed",
        subscriptionStatus: result?.subscription_status
          || result?.[0]?.subscription_status
          || null
      }
    };
  } catch (_error) {
    try {
      await markWebhookFailure(repo, {
        paypalEventId,
        errorCode: "DB_ERROR",
        paypalSubscriptionId,
        paypalSaleId,
        sanitizedPayload,
        merchantValidationSource
      });
    } catch (_e2) {
      // ignore
    }
    logSubscriptionWebhookResult({
      eventType,
      stage: "rpc",
      verificationStatus: "SUCCESS",
      processingStatus: "failed",
      errorCode: "DB_ERROR",
      merchantValidationSource
    });
    // Verified event already received — return 200 with rejected so PayPal stops retrying.
    return {
      statusCode: 200,
      body: { ok: true, outcome: "rejected", error: "DB_ERROR" }
    };
  }
}


export async function handlePaypalWebhookRequest({ rawBody, headers, deps = {} }: any) {
  if (typeof rawBody !== "string") {
    return {
      statusCode: 400,
      body: { ok: false, error: { code: "INVALID_REQUEST", message: "Raw body required." } },
    };
  }

  const paypalClient = deps.paypalClient;
  const webhookId = String(deps.paypalWebhookId || "").trim();
  const merchantIdExpected = String(deps.paypalMerchantId || "").trim();
  const repo = deps.webhookRepository;

  if (!paypalClient || !webhookId || !merchantIdExpected || !repo) {
    return {
      statusCode: 503,
      body: { ok: false, error: { code: "PAYPAL_CONFIG", message: "Webhook is not configured." } },
    };
  }

  const authAlgo = readPaypalHeader(headers, "PAYPAL-AUTH-ALGO");
  const certUrl = readPaypalHeader(headers, "PAYPAL-CERT-URL");
  const transmissionId = readPaypalHeader(headers, "PAYPAL-TRANSMISSION-ID");
  const transmissionSig = readPaypalHeader(headers, "PAYPAL-TRANSMISSION-SIG");
  const transmissionTime = readPaypalHeader(headers, "PAYPAL-TRANSMISSION-TIME");

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return {
      statusCode: 401,
      body: {
        ok: false,
        error: { code: "WEBHOOK_SIGNATURE_MISSING", message: "Missing PayPal signature headers." },
      },
    };
  }

  // deno-lint-ignore no-explicit-any
  let verification: any;
  try {
    verification = await paypalClient.verifyWebhookSignature({
      webhookId,
      rawBody,
      authAlgo,
      certUrl,
      transmissionId,
      transmissionSig,
      transmissionTime,
    });
  } catch (_error) {
    return {
      statusCode: 401,
      body: {
        ok: false,
        error: { code: "WEBHOOK_VERIFY_FAILED", message: "Webhook verification failed." },
      },
    };
  }

  if (String(verification.verification_status) !== "SUCCESS") {
    return {
      statusCode: 401,
      body: {
        ok: false,
        error: { code: "WEBHOOK_VERIFY_FAILED", message: "Invalid webhook signature." },
      },
    };
  }

  // deno-lint-ignore no-explicit-any
  let event: any = verification.webhookEvent;
  if (!event || typeof event !== "object") {
    try {
      event = JSON.parse(rawBody);
    } catch (_e) {
      return {
        statusCode: 400,
        body: { ok: false, error: { code: "INVALID_REQUEST", message: "Invalid webhook JSON." } },
      };
    }
  }

  const paypalEventId = String(event.id || "").trim();
  const eventType = String(event.event_type || "").trim();
  if (!paypalEventId || !eventType) {
    return {
      statusCode: 400,
      body: { ok: false, error: { code: "INVALID_REQUEST", message: "Missing event id or type." } },
    };
  }

  if (isSubscriptionEventType(eventType)) {
    return processSubscriptionWebhook({ event, rawBody, deps });
  }

  const fields = extractResourceFields(event);

  let payloadForStore;
  try {
    payloadForStore = JSON.parse(rawBody);
  } catch (_e) {
    payloadForStore = event;
  }

  try {
    const result = await repo.processWebhookEvent({
      paypalEventId,
      eventType,
      verificationStatus: "SUCCESS",
      processingStatus: KNOWN_EVENT_TYPES.has(eventType) ? "processed" : "ignored",
      paypalOrderId: fields.paypalOrderId,
      paypalCaptureId: fields.paypalCaptureId,
      expectedAmount: fields.amount,
      expectedCurrency: fields.currency,
      actualMerchantId: fields.merchantId,
      expectedMerchantId: merchantIdExpected,
      payload: payloadForStore,
    });

    const outcome = result?.outcome || result?.[0]?.outcome || "processed";
    const errMsg = result?.error_message || result?.[0]?.error_message || null;

    if (outcome === "duplicate") {
      return { statusCode: 200, body: { ok: true, outcome: "duplicate" } };
    }

    if (outcome === "ignored") {
      return { statusCode: 200, body: { ok: true, outcome: "ignored" } };
    }

    if (outcome === "rejected") {
      return {
        statusCode: 200,
        body: {
          ok: true,
          outcome: "rejected",
          error: errMsg || "VALIDATION_FAILED",
        },
      };
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        outcome: "processed",
        orderStatus: result?.order_status || result?.[0]?.order_status || null,
      },
    };
  } catch (_error) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        error: { code: "DB_ERROR", message: "Failed to persist webhook event." },
      },
    };
  }
}

// deno-lint-ignore no-explicit-any
export function createWebhookRepositoryFromSupabase(serviceClient: any) {
  return {
    // deno-lint-ignore no-explicit-any
    async processWebhookEvent(input: any) {
      const { data, error } = await serviceClient.rpc("process_paypal_webhook_event", {
        p_paypal_event_id: input.paypalEventId,
        p_event_type: input.eventType,
        p_verification_status: input.verificationStatus,
        p_processing_status: input.processingStatus,
        p_paypal_order_id: input.paypalOrderId,
        p_paypal_capture_id: input.paypalCaptureId,
        p_expected_amount: input.expectedAmount,
        p_expected_currency: input.expectedCurrency,
        p_actual_merchant_id: input.actualMerchantId,
        p_expected_merchant_id: input.expectedMerchantId,
        p_payload: input.payload,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    // deno-lint-ignore no-explicit-any
    async ensureWebhookEventReceived(input: any) {
      const { data, error } = await serviceClient.rpc(
        "ensure_paypal_webhook_event_received",
        {
          p_paypal_event_id: input.paypalEventId,
          p_event_type: input.eventType,
          p_paypal_subscription_id: input.paypalSubscriptionId || null,
          p_paypal_sale_id: input.paypalSaleId || null,
          p_sanitized_payload: input.sanitizedPayload || {},
        },
      );
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    // deno-lint-ignore no-explicit-any
    async finalizeWebhookEventFailure(input: any) {
      const { data, error } = await serviceClient.rpc(
        "finalize_paypal_webhook_event_failure",
        {
          p_paypal_event_id: input.paypalEventId,
          p_error_code: input.errorCode,
          p_processing_status: input.processingStatus || "failed",
          p_paypal_subscription_id: input.paypalSubscriptionId || null,
          p_paypal_sale_id: input.paypalSaleId || null,
          p_sanitized_payload: input.sanitizedPayload || null,
          p_merchant_validation_source: input.merchantValidationSource || null,
        },
      );
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    // deno-lint-ignore no-explicit-any
    async processSubscriptionWebhookEvent(input: any) {
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
          p_processing_hint: input.processingHint || null,
        },
      );
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
  };
}
