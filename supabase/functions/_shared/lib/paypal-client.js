"use strict";

/**
 * Auth-07 PayPal HTTP client (Orders v2 + OAuth + webhook verify).
 * Default API base is Sandbox ONLY. Inject `fetchImpl` in tests — never
 * hit real PayPal from unit tests.
 */

const SANDBOX_API_BASE = "https://api-m.sandbox.paypal.com";
const SAFE_MESSAGE_MAX = 120;
const SAFE_NAME_MAX = 80;
const SAFE_ISSUE_MAX = 80;
const SAFE_DEBUG_ID_MAX = 64;
const SAFE_CONTENT_TYPE_MAX = 80;

function resolveApiBase(envName) {
  const env = String(envName || "sandbox").trim().toLowerCase();
  if (env !== "sandbox") {
    throw new Error("PAYPAL_ENV_NOT_SANDBOX");
  }
  return SANDBOX_API_BASE;
}

function clipSafeText(value, maxLen) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

/**
 * Auth-07B.2.4C: keep only sanitized PayPal error fields.
 * Never retain Authorization, tokens, credentials, payer/PII, or raw bodies.
 */
function buildSanitizedPaypalErrorDetails({
  stage,
  status = null,
  contentType = null,
  bodyOmitted = false,
  paypalJson = null,
  message = null
} = {}) {
  const details = {
    stage: String(stage || ""),
    status: status == null || status === "" ? null : Number(status)
  };
  if (!Number.isFinite(details.status)) {
    details.status = status == null || status === "" ? null : status;
  }

  if (bodyOmitted) {
    details.bodyOmitted = true;
    details.contentType = clipSafeText(contentType, SAFE_CONTENT_TYPE_MAX);
    details.paypalName = null;
    details.paypalIssue = null;
    details.debugId = null;
    details.message = clipSafeText(message, SAFE_MESSAGE_MAX);
    return details;
  }

  const json = paypalJson && typeof paypalJson === "object" && !Array.isArray(paypalJson)
    ? paypalJson
    : null;
  details.bodyOmitted = false;
  details.paypalName = clipSafeText(json?.name, SAFE_NAME_MAX);
  details.paypalIssue = clipSafeText(json?.details?.[0]?.issue, SAFE_ISSUE_MAX);
  details.debugId = clipSafeText(json?.debug_id ?? json?.debugId, SAFE_DEBUG_ID_MAX);
  details.message = clipSafeText(message ?? json?.message, SAFE_MESSAGE_MAX);
  return details;
}

function makePaypalError(code, details) {
  const err = new Error(code);
  err.code = code;
  err.details = details && typeof details === "object" ? details : null;
  return err;
}

async function readSanitizedPaypalErrorFromResponse(res, stage) {
  const contentType = typeof res?.headers?.get === "function"
    ? res.headers.get("content-type")
    : (res?.headers?.["content-type"] || null);
  const status = res?.status ?? null;

  let rawText = "";
  try {
    rawText = typeof res?.text === "function" ? await res.text() : "";
  } catch (_e) {
    rawText = "";
  }

  if (!rawText) {
    return buildSanitizedPaypalErrorDetails({
      stage,
      status,
      contentType,
      bodyOmitted: false,
      paypalJson: null
    });
  }

  try {
    const paypalJson = JSON.parse(rawText);
    return buildSanitizedPaypalErrorDetails({
      stage,
      status,
      contentType,
      bodyOmitted: false,
      paypalJson
    });
  } catch (_e) {
    return buildSanitizedPaypalErrorDetails({
      stage,
      status,
      contentType,
      bodyOmitted: true,
      paypalJson: null
    });
  }
}

function createPaypalClient({
  clientId,
  clientSecret,
  env = "sandbox",
  fetchImpl = globalThis.fetch,
  nowMs = () => Date.now()
} = {}) {
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CREDENTIALS_MISSING");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("FETCH_IMPL_REQUIRED");
  }

  const apiBase = resolveApiBase(env);
  let cachedToken = null;
  let cachedExpiryMs = 0;

  async function getAccessToken() {
    if (cachedToken && nowMs() < cachedExpiryMs - 5000) {
      return cachedToken;
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetchImpl(`${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });

    if (!res.ok) {
      const details = await readSanitizedPaypalErrorFromResponse(res, "oauth");
      throw makePaypalError("PAYPAL_OAUTH_FAILED", details);
    }

    let data = {};
    try {
      data = await res.json();
    } catch (_e) {
      throw makePaypalError(
        "PAYPAL_OAUTH_FAILED",
        buildSanitizedPaypalErrorDetails({
          stage: "oauth",
          status: res.status,
          contentType: typeof res.headers?.get === "function"
            ? res.headers.get("content-type")
            : null,
          bodyOmitted: true
        })
      );
    }
    if (!data?.access_token) {
      // Do not attach response body (may contain token-shaped fields).
      throw makePaypalError(
        "PAYPAL_OAUTH_FAILED",
        buildSanitizedPaypalErrorDetails({
          stage: "oauth",
          status: res.status,
          bodyOmitted: false,
          paypalJson: { name: "OAUTH_RESPONSE_INVALID", details: [{ issue: "MISSING_ACCESS_TOKEN" }] }
        })
      );
    }

    cachedToken = String(data.access_token);
    const expiresIn = Number(data.expires_in) || 300;
    cachedExpiryMs = nowMs() + expiresIn * 1000;
    return cachedToken;
  }

  async function authHeaders(extra = {}) {
    const token = await getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...extra
    };
  }

  async function createOrder({
    amount,
    currency,
    planCode,
    planName,
    requestId
  }) {
    const headers = await authHeaders({
      "PayPal-Request-Id": String(requestId),
      Prefer: "return=representation"
    });

    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: String(planCode),
          description: String(planName),
          amount: {
            currency_code: String(currency),
            value: String(amount)
          }
        }
      ]
    };

    const res = await fetchImpl(`${apiBase}/v2/checkout/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const details = await readSanitizedPaypalErrorFromResponse(res, "create_order");
      throw makePaypalError("PAYPAL_CREATE_ORDER_FAILED", details);
    }

    const data = await res.json().catch(() => ({}));
    const orderId = String(data?.id || "").trim();
    if (!orderId) {
      // 2xx without order id — do not attach response body (may contain PII).
      throw makePaypalError(
        "PAYPAL_CREATE_ORDER_INVALID_RESPONSE",
        buildSanitizedPaypalErrorDetails({
          stage: "create_order",
          status: res.status,
          bodyOmitted: false,
          paypalJson: {
            name: "INVALID_RESPONSE",
            details: [{ issue: "MISSING_ORDER_ID" }]
          },
          message: "PayPal create order response missing order id."
        })
      );
    }
    return data;
  }

  async function captureOrder({ orderId, requestId }) {
    const headers = await authHeaders({
      "PayPal-Request-Id": String(requestId),
      Prefer: "return=representation"
    });

    const res = await fetchImpl(
      `${apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      {
        method: "POST",
        headers,
        body: "{}"
      }
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error("PAYPAL_CAPTURE_FAILED");
      err.details = { status: res.status };
      throw err;
    }
    return data;
  }

  async function getOrder({ orderId }) {
    const headers = await authHeaders({
      Prefer: "return=representation"
    });

    const res = await fetchImpl(
      `${apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      {
        method: "GET",
        headers
      }
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error("PAYPAL_GET_ORDER_FAILED");
      err.details = { status: res.status };
      throw err;
    }
    return data;
  }

  /** GET /v1/billing/subscriptions/{id} — Subscriptions API (NOT Orders). */
  async function getSubscription({ subscriptionId }) {
    const headers = await authHeaders();
    const res = await fetchImpl(
      `${apiBase}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: "GET", headers }
    );

    if (!res.ok) {
      const details = await readSanitizedPaypalErrorFromResponse(res, "get_subscription");
      throw makePaypalError("PAYPAL_GET_SUBSCRIPTION_FAILED", details);
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object" || !data.id) {
      throw makePaypalError(
        "PAYPAL_GET_SUBSCRIPTION_FAILED",
        buildSanitizedPaypalErrorDetails({
          stage: "get_subscription",
          status: res.status,
          bodyOmitted: false,
          paypalJson: { name: "INVALID_RESPONSE", details: [{ issue: "MISSING_SUBSCRIPTION_ID" }] },
          message: "PayPal get subscription response missing id."
        })
      );
    }
    return data;
  }

  /**
   * GET /v1/billing/subscriptions/{id}/transactions
   * Requires start_time + end_time (ISO-8601). Used for SALE reconciliation fallback.
   */
  async function getSubscriptionTransactions({
    subscriptionId,
    startTime,
    endTime
  }) {
    const headers = await authHeaders();
    const start = startTime || new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString();
    const end = endTime || new Date().toISOString();
    const qs = new URLSearchParams({
      start_time: start,
      end_time: end
    });
    const res = await fetchImpl(
      `${apiBase}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/transactions?${qs}`,
      { method: "GET", headers }
    );

    if (!res.ok) {
      const details = await readSanitizedPaypalErrorFromResponse(
        res,
        "get_subscription_transactions"
      );
      throw makePaypalError("PAYPAL_GET_SUBSCRIPTION_TRANSACTIONS_FAILED", details);
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") {
      throw makePaypalError(
        "PAYPAL_GET_SUBSCRIPTION_TRANSACTIONS_FAILED",
        buildSanitizedPaypalErrorDetails({
          stage: "get_subscription_transactions",
          status: res.status,
          bodyOmitted: false,
          paypalJson: { name: "INVALID_RESPONSE", details: [{ issue: "MISSING_BODY" }] },
          message: "PayPal get subscription transactions response invalid."
        })
      );
    }
    return data;
  }

  /** GET /v1/billing/plans/{id} — validate allowlisted plan metadata. */
  async function getPlan({ planId }) {
    const headers = await authHeaders();
    const res = await fetchImpl(
      `${apiBase}/v1/billing/plans/${encodeURIComponent(planId)}`,
      { method: "GET", headers }
    );

    if (!res.ok) {
      const details = await readSanitizedPaypalErrorFromResponse(res, "get_plan");
      throw makePaypalError("PAYPAL_GET_PLAN_FAILED", details);
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object" || !data.id) {
      throw makePaypalError(
        "PAYPAL_GET_PLAN_FAILED",
        buildSanitizedPaypalErrorDetails({
          stage: "get_plan",
          status: res.status,
          bodyOmitted: false,
          paypalJson: { name: "INVALID_RESPONSE", details: [{ issue: "MISSING_PLAN_ID" }] },
          message: "PayPal get plan response missing id."
        })
      );
    }
    return data;
  }

  /**
   * POST /v1/billing/subscriptions/{id}/cancel
   * Fixed safe reason only — never include payer PII.
   */
  async function cancelSubscription({
    subscriptionId,
    reason = "Customer requested cancellation"
  }) {
    const headers = await authHeaders();
    const res = await fetchImpl(
      `${apiBase}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          reason: String(reason || "Customer requested cancellation").slice(0, 120)
        })
      }
    );

    // PayPal returns 204 No Content on success.
    if (res.status === 204 || res.ok) {
      return { ok: true, status: res.status };
    }

    const details = await readSanitizedPaypalErrorFromResponse(res, "cancel_subscription");
    throw makePaypalError("PAYPAL_CANCEL_SUBSCRIPTION_FAILED", details);
  }

  /**
   * Verify webhook signature. `rawBody` MUST be the original request text
   * (never JSON.parse + JSON.stringify).
   */
  async function verifyWebhookSignature({
    webhookId,
    rawBody,
    authAlgo,
    certUrl,
    transmissionId,
    transmissionSig,
    transmissionTime
  }) {
    if (typeof rawBody !== "string") {
      throw new Error("RAW_BODY_REQUIRED");
    }

    let webhookEvent;
    try {
      webhookEvent = JSON.parse(rawBody);
    } catch (_e) {
      throw new Error("INVALID_WEBHOOK_JSON");
    }

    const headers = await authHeaders();
    const res = await fetchImpl(`${apiBase}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: webhookEvent
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { verification_status: "FAILURE", raw: data };
    }
    return {
      verification_status: String(data.verification_status || "FAILURE"),
      raw: data,
      webhookEvent
    };
  }

  return {
    apiBase,
    getAccessToken,
    createOrder,
    captureOrder,
    getOrder,
    getSubscription,
    getSubscriptionTransactions,
    getPlan,
    cancelSubscription,
    verifyWebhookSignature
  };
}

function normalizeMerchantId(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized ? normalized : null;
}

function extractCaptureMoney(captureResource) {
  const amount = captureResource?.amount?.value
    || captureResource?.seller_receivable_breakdown?.gross_amount?.value
    || null;
  const currency = captureResource?.amount?.currency_code
    || captureResource?.seller_receivable_breakdown?.gross_amount?.currency_code
    || null;
  const merchantId = captureResource?.payee?.merchant_id
    || null;
  const captureId = captureResource?.id || null;
  const orderId = captureResource?.supplementary_data?.related_ids?.order_id
    || null;
  return { amount, currency, merchantId, captureId, orderId };
}

function extractOrderPayeeMerchantId(orderPayload) {
  const units = orderPayload?.purchase_units || [];
  for (const unit of units) {
    const mid = unit?.payee?.merchant_id;
    if (mid) return String(mid);
  }
  return null;
}

function extractCaptureValidationFields(orderPayload) {
  const purchaseUnit = orderPayload?.purchase_units?.[0];
  const capture = purchaseUnit?.payments?.captures?.[0];
  const payeeMerchantId = extractOrderPayeeMerchantId(orderPayload)
    || (capture?.payee?.merchant_id ? String(capture.payee.merchant_id) : null)
    || null;

  return {
    orderId: orderPayload?.id ? String(orderPayload.id) : null,
    payeeMerchantId,
    paypalCaptureId: capture?.id ? String(capture.id) : null,
    captureStatus: capture?.status ? String(capture.status) : null,
    amount: capture?.amount?.value != null ? String(capture.amount.value) : null,
    currency: capture?.amount?.currency_code != null
      ? String(capture.amount.currency_code)
      : null
  };
}

function captureValidationFieldsMissing(fields) {
  if (!fields || typeof fields !== "object") return true;
  return !fields.payeeMerchantId
    || !fields.paypalCaptureId
    || !fields.captureStatus
    || !fields.amount
    || !fields.currency;
}

function amountsEqual(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) < 0.005;
}

module.exports = {
  SANDBOX_API_BASE,
  createPaypalClient,
  extractCaptureMoney,
  extractOrderPayeeMerchantId,
  extractCaptureValidationFields,
  captureValidationFieldsMissing,
  normalizeMerchantId,
  amountsEqual,
  resolveApiBase,
  clipSafeText,
  buildSanitizedPaypalErrorDetails,
  makePaypalError
};
