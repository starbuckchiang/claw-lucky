/**
 * Auth-07 / Auth-07A.3 paypal-checkout shared handler (ESM/Deno twin).
 * Orders v2 one-time CAPTURE only — not PayPal Subscriptions.
 * Create-order reuse TTL = 15 minutes.
 */

import { getPaypalPlan } from "./lib/paypal-plans.ts";
import {
  createPaypalClient,
  extractCaptureValidationFields,
  captureValidationFieldsMissing,
  normalizeMerchantId,
  amountsEqual,
} from "./lib/paypal-client.ts";

export const OPEN_ORDER_TTL_MS = 15 * 60 * 1000;
const OPEN_STATUSES = new Set(["created", "approved", "capture_pending"]);

export const ERROR_HTTP_STATUS = Object.freeze({
  AUTH_REQUIRED: 401,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  ACCOUNT_UPGRADE_REQUIRED: 403,
  INVALID_REQUEST: 400,
  INVALID_PLAN: 400,
  ORDER_NOT_FOUND: 404,
  ORDER_OWNER_MISMATCH: 403,
  ALREADY_PAID: 409,
  ORDER_INITIALIZING: 409,
  PAYPAL_CONFIG: 503,
  PAYPAL_OAUTH_FAILED: 502,
  PAYPAL_CREATE_ORDER_FAILED: 502,
  PAYPAL_CREATE_ORDER_INVALID_RESPONSE: 502,
  PAYPAL_CAPTURE_FAILED: 502,
  PAYPAL_ORDER_LOOKUP_FAILED: 503,
  MERCHANT_MISMATCH: 502,
  AMOUNT_MISMATCH: 502,
  ORDER_MISMATCH: 502,
  CAPTURE_ID_CONFLICT: 502,
  DB_ERROR: 503,
});

export function toHttpStatus(code: string) {
  return (ERROR_HTTP_STATUS as Record<string, number>)[code] || 500;
}

function errorBody(code: string, message: string, details: unknown = null) {
  return {
    ok: false,
    error: { code, message, details },
  };
}

function resolvePaypalCreateFailure(error: unknown) {
  const err = error as { code?: string; message?: string } | null;
  const code = err?.code || err?.message;
  if (code === "PAYPAL_OAUTH_FAILED") {
    return {
      code: "PAYPAL_OAUTH_FAILED",
      message: "PayPal OAuth failed.",
    };
  }
  if (code === "PAYPAL_CREATE_ORDER_INVALID_RESPONSE") {
    return {
      code: "PAYPAL_CREATE_ORDER_INVALID_RESPONSE",
      message: "PayPal create order returned an invalid response.",
    };
  }
  return {
    code: "PAYPAL_CREATE_ORDER_FAILED",
    message: "PayPal create order failed.",
  };
}

function sanitizePaypalFailureDetails(details: unknown) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  const d = details as Record<string, unknown>;
  return {
    stage: d.stage != null ? String(d.stage) : null,
    status: d.status != null ? d.status : null,
    paypalName: d.paypalName != null ? String(d.paypalName) : null,
    paypalIssue: d.paypalIssue != null ? String(d.paypalIssue) : null,
    debugId: d.debugId != null ? String(d.debugId) : null,
    message: d.message != null ? String(d.message).slice(0, 120) : null,
    bodyOmitted: d.bodyOmitted === true,
    contentType: d.contentType != null ? String(d.contentType).slice(0, 80) : null,
  };
}

function logPaypalCreateFailure(code: string, details: ReturnType<typeof sanitizePaypalFailureDetails>) {
  try {
    console.error(JSON.stringify({
      event: "paypal_checkout_create_failed",
      code,
      stage: details?.stage ?? null,
      status: details?.status ?? null,
      paypalName: details?.paypalName ?? null,
      paypalIssue: details?.paypalIssue ?? null,
      debugId: details?.debugId ?? null,
      bodyOmitted: details?.bodyOmitted === true,
    }));
  } catch (_e) {
    // never throw from logging
  }
}

// deno-lint-ignore no-explicit-any
function requireOfficialUser(user: any) {
  if (!user || !user.id) {
    return { ok: false as const, code: "AUTH_REQUIRED", message: "Authentication required." };
  }
  if (user.is_anonymous === true) {
    return {
      ok: false as const,
      code: "ACCOUNT_UPGRADE_REQUIRED",
      message: "Anonymous users cannot create payment orders.",
    };
  }
  return { ok: true as const };
}

function stableCreateRequestId(userId: string, planCode: string, clientKey: unknown) {
  if (clientKey && String(clientKey).trim()) {
    return `create:${userId}:${planCode}:${String(clientKey).trim()}`;
  }
  return null;
}

function cryptoRandom() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// deno-lint-ignore no-explicit-any
export function isFreshOpenOrder(row: any, nowMs = Date.now(), ttlMs = OPEN_ORDER_TTL_MS) {
  if (!row || !OPEN_STATUSES.has(row.status)) return false;
  const created = Date.parse(row.created_at || row.createdAt || "");
  if (!Number.isFinite(created)) return false;
  return (nowMs - created) <= ttlMs;
}

// deno-lint-ignore no-explicit-any
export function isOneOpenUniqueViolation(error: any) {
  const msg = String(error?.message || error?.code || error?.details || "");
  return /uq_payment_orders_one_open_per_user_plan|one_open_per_user_plan|23505|duplicate key/i.test(msg);
}

function initializingResponse() {
  return {
    statusCode: toHttpStatus("ORDER_INITIALIZING"),
    body: errorBody(
      "ORDER_INITIALIZING",
      "Payment order is being initialized. Retry shortly.",
      { retryable: true },
    ),
  };
}

/** Unified create + one-open unique race handling (Auth-07A.3). */
export async function createPaymentOrderHandlingRace(
  // deno-lint-ignore no-explicit-any
  repo: any,
  // deno-lint-ignore no-explicit-any
  input: any,
  opts: { userId: string; planCode: string; nowMs: number; ttlMs: number },
) {
  try {
    const order = await repo.createPaymentOrder(input);
    return { kind: "created" as const, order };
  } catch (error) {
    if (!isOneOpenUniqueViolation(error)) {
      throw error;
    }

    const raced = await repo.findOpenOrderByUserPlan?.(opts.userId, opts.planCode, {
      maxAgeMs: opts.ttlMs,
      nowMs: opts.nowMs,
    });

    if (raced && isFreshOpenOrder(raced, opts.nowMs, opts.ttlMs) && raced.paypal_order_id) {
      return { kind: "reuse" as const, order: raced };
    }

    if (raced && isFreshOpenOrder(raced, opts.nowMs, opts.ttlMs) && !raced.paypal_order_id) {
      return { kind: "initializing" as const, order: raced };
    }

    return { kind: "initializing" as const, order: raced || null };
  }
}

// deno-lint-ignore no-explicit-any
export async function handleCreateOrder({ body, user, deps }: any) {
  const auth = requireOfficialUser(user);
  if (!auth.ok) {
    return { statusCode: toHttpStatus(auth.code), body: errorBody(auth.code, auth.message) };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      statusCode: 400,
      body: errorBody("INVALID_REQUEST", "Request body must be a JSON object."),
    };
  }

  for (const forbidden of ["userId", "amount", "currency", "accessToken", "clientSecret"]) {
    if (Object.prototype.hasOwnProperty.call(body, forbidden)) {
      return {
        statusCode: 400,
        body: errorBody("INVALID_REQUEST", `${forbidden} is not allowed in the request body.`),
      };
    }
  }

  const planCode = String(body.planCode || "").trim();
  const plan = getPaypalPlan(planCode);
  if (!plan) {
    return {
      statusCode: 400,
      body: errorBody("INVALID_PLAN", "Unknown planCode."),
    };
  }

  const repo = deps.paymentOrdersRepository;
  const paypalClient = deps.paypalClient;
  const nowMs = typeof deps.nowMs === "function" ? deps.nowMs() : Date.now();
  const ttlMs = Number(deps.openOrderTtlMs) > 0 ? Number(deps.openOrderTtlMs) : OPEN_ORDER_TTL_MS;
  const ttlMinutes = Math.max(1, Math.round(ttlMs / 60000));

  if (!repo || !paypalClient) {
    return {
      statusCode: 503,
      body: errorBody("PAYPAL_CONFIG", "PayPal client is not configured."),
    };
  }

  const userId = String(user.id);

  try {
    if (typeof repo.failStaleOpenOrders === "function") {
      await repo.failStaleOpenOrders(userId, planCode, ttlMinutes, nowMs);
    }

    const open = await repo.findOpenOrderByUserPlan?.(userId, planCode, {
      maxAgeMs: ttlMs,
      nowMs,
    });

    if (open?.paypal_order_id && isFreshOpenOrder(open, nowMs, ttlMs)) {
      return {
        statusCode: 200,
        body: { ok: true, orderId: open.paypal_order_id, status: open.status },
      };
    }

    let createRequestId = stableCreateRequestId(userId, planCode, body.idempotencyKey)
      || `create:${userId}:${planCode}:${cryptoRandom()}`;

    let race = await createPaymentOrderHandlingRace(repo, {
      userId,
      planCode: plan.planCode,
      amount: plan.amount,
      currency: plan.currency,
      createRequestId,
    }, { userId, planCode: plan.planCode, nowMs, ttlMs });

    if (race.kind === "reuse") {
      return {
        statusCode: 200,
        body: { ok: true, orderId: race.order.paypal_order_id, status: race.order.status },
      };
    }

    if (race.kind === "initializing") {
      return initializingResponse();
    }

    let internal = race.order;

    if (!isFreshOpenOrder(internal, nowMs, ttlMs)) {
      createRequestId = `${createRequestId}:n:${cryptoRandom()}`;
      race = await createPaymentOrderHandlingRace(repo, {
        userId,
        planCode: plan.planCode,
        amount: plan.amount,
        currency: plan.currency,
        createRequestId,
      }, { userId, planCode: plan.planCode, nowMs, ttlMs });

      if (race.kind === "reuse") {
        return {
          statusCode: 200,
          body: { ok: true, orderId: race.order.paypal_order_id, status: race.order.status },
        };
      }
      if (race.kind === "initializing") {
        return initializingResponse();
      }
      internal = race.order;
    }

    if (internal.paypal_order_id && isFreshOpenOrder(internal, nowMs, ttlMs)) {
      return {
        statusCode: 200,
        body: { ok: true, orderId: internal.paypal_order_id, status: internal.status },
      };
    }

    if (String(internal.create_request_id) !== String(createRequestId)) {
      return initializingResponse();
    }

    // deno-lint-ignore no-explicit-any
    let paypalOrder: any;
    try {
      paypalOrder = await paypalClient.createOrder({
        amount: plan.amount,
        currency: plan.currency,
        planCode: plan.planCode,
        planName: plan.name,
        requestId: internal.create_request_id || createRequestId,
      });
    } catch (paypalError) {
      if (typeof repo.transitionStatus === "function") {
        await repo.transitionStatus(internal.id, "failed", null, null);
      }
      const mapped = resolvePaypalCreateFailure(paypalError);
      const details = sanitizePaypalFailureDetails(
        (paypalError as { details?: unknown } | null)?.details,
      );
      logPaypalCreateFailure(mapped.code, details);
      return {
        statusCode: toHttpStatus(mapped.code),
        body: errorBody(mapped.code, mapped.message, details),
      };
    }

    const paypalOrderId = String(paypalOrder?.id || "").trim();
    if (!paypalOrderId) {
      if (typeof repo.transitionStatus === "function") {
        await repo.transitionStatus(internal.id, "failed", null, null);
      }
      const details = {
        stage: "create_order",
        status: null,
        paypalName: "INVALID_RESPONSE",
        paypalIssue: "MISSING_ORDER_ID",
        debugId: null,
        message: null,
        bodyOmitted: false,
        contentType: null,
      };
      logPaypalCreateFailure("PAYPAL_CREATE_ORDER_INVALID_RESPONSE", details);
      return {
        statusCode: toHttpStatus("PAYPAL_CREATE_ORDER_INVALID_RESPONSE"),
        body: errorBody(
          "PAYPAL_CREATE_ORDER_INVALID_RESPONSE",
          "PayPal create order returned an invalid response.",
          details,
        ),
      };
    }

    await repo.attachPaypalOrderId(internal.id, paypalOrderId);

    return {
      statusCode: 200,
      body: { ok: true, orderId: paypalOrderId, status: "created" },
    };
  } catch (error) {
    if (isOneOpenUniqueViolation(error)) {
      return initializingResponse();
    }
    // deno-lint-ignore no-explicit-any
    const code = (error as any)?.message === "PAYPAL_CREATE_ORDER_FAILED"
      ? "PAYPAL_CREATE_ORDER_FAILED"
      : "DB_ERROR";
    return {
      statusCode: toHttpStatus(code),
      body: errorBody(code, "Failed to create payment order."),
    };
  }
}

// deno-lint-ignore no-explicit-any
export async function handleCaptureOrder({ body, user, deps }: any) {
  const auth = requireOfficialUser(user);
  if (!auth.ok) {
    return { statusCode: toHttpStatus(auth.code), body: errorBody(auth.code, auth.message) };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      statusCode: 400,
      body: errorBody("INVALID_REQUEST", "Request body must be a JSON object."),
    };
  }

  for (const forbidden of ["userId", "amount", "currency", "paid", "entitlement"]) {
    if (Object.prototype.hasOwnProperty.call(body, forbidden)) {
      return {
        statusCode: 400,
        body: errorBody("INVALID_REQUEST", `${forbidden} is not allowed in the request body.`),
      };
    }
  }

  const orderId = String(body.orderId || "").trim();
  if (!orderId) {
    return {
      statusCode: 400,
      body: errorBody("INVALID_REQUEST", "orderId is required."),
    };
  }

  const repo = deps.paymentOrdersRepository;
  const paypalClient = deps.paypalClient;
  const merchantIdExpected = normalizeMerchantId(deps.paypalMerchantId);

  if (!repo || !paypalClient || !merchantIdExpected) {
    return {
      statusCode: 503,
      body: errorBody("PAYPAL_CONFIG", "PayPal capture is not configured.")
    };
  }

  try {
    const internal = await repo.findByPaypalOrderId(orderId);
    if (!internal) {
      return {
        statusCode: 404,
        body: errorBody("ORDER_NOT_FOUND", "Payment order not found.")
      };
    }

    if (String(internal.user_id) !== String(user.id)) {
      return {
        statusCode: 403,
        body: errorBody("ORDER_OWNER_MISMATCH", "Order does not belong to the authenticated user.")
      };
    }

    if (internal.status === "paid") {
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "paid",
          message: "付款正在確認"
        }
      };
    }

    if (["denied", "failed", "refunded", "reversed"].includes(internal.status)) {
      return {
        statusCode: 409,
        body: errorBody("ALREADY_PAID", "Order is not capturable.", { status: internal.status })
      };
    }

    const captureRequestId = internal.capture_request_id
      || `capture:${internal.id}`;

    const alreadyHasCaptureId = Boolean(internal.paypal_capture_id);
    let authoritativeOrder = null;
    let fields = null;
    let captureHttpSucceeded = alreadyHasCaptureId;

    if (alreadyHasCaptureId) {
      // Resume after prior successful Capture: validate via GET only (no second Capture).
      if (typeof paypalClient.getOrder !== "function") {
        await repo.transitionStatus(
          internal.id,
          "capture_pending",
          internal.paypal_capture_id,
          captureRequestId
        );
        return {
          statusCode: 503,
          body: errorBody(
            "PAYPAL_ORDER_LOOKUP_FAILED",
            "Capture already recorded; order lookup temporarily unavailable.",
            { reason: "MERCHANT_ID_MISSING_FROM_CAPTURE_RESPONSE" }
          )
        };
      }
      try {
        authoritativeOrder = await paypalClient.getOrder({ orderId });
        fields = extractCaptureValidationFields(authoritativeOrder);
      } catch (_lookupError) {
        await repo.transitionStatus(
          internal.id,
          "capture_pending",
          internal.paypal_capture_id,
          captureRequestId
        );
        return {
          statusCode: 503,
          body: errorBody(
            "PAYPAL_ORDER_LOOKUP_FAILED",
            "Capture already recorded; order lookup temporarily unavailable.",
            { reason: "ORDER_LOOKUP_TEMPORARY_FAILURE" }
          )
        };
      }
    } else {
      await repo.transitionStatus(internal.id, "capture_pending", null, captureRequestId);

      const captureResult = await paypalClient.captureOrder({
        orderId,
        requestId: captureRequestId
      });
      captureHttpSucceeded = true;
      authoritativeOrder = captureResult;
      fields = extractCaptureValidationFields(captureResult);

      if (captureValidationFieldsMissing(fields)) {
        if (typeof paypalClient.getOrder !== "function") {
          await repo.transitionStatus(
            internal.id,
            "capture_pending",
            fields.paypalCaptureId || null,
            captureRequestId
          );
          return {
            statusCode: 503,
            body: errorBody(
              "PAYPAL_ORDER_LOOKUP_FAILED",
              "Capture succeeded; order lookup temporarily unavailable.",
              { reason: "MERCHANT_ID_MISSING_FROM_CAPTURE_RESPONSE" }
            )
          };
        }

        try {
          authoritativeOrder = await paypalClient.getOrder({ orderId });
          fields = extractCaptureValidationFields(authoritativeOrder);
        } catch (_lookupError) {
          await repo.transitionStatus(
            internal.id,
            "capture_pending",
            fields.paypalCaptureId || null,
            captureRequestId
          );
          return {
            statusCode: 503,
            body: errorBody(
              "PAYPAL_ORDER_LOOKUP_FAILED",
              "Capture succeeded; order lookup temporarily unavailable. Waiting for webhook.",
              { reason: "MERCHANT_ID_MISSING_FROM_CAPTURE_RESPONSE" }
            )
          };
        }
      }
    }

    const responseOrderId = String(fields.orderId || authoritativeOrder?.id || "").trim();
    if (responseOrderId && responseOrderId !== orderId) {
      await repo.transitionStatus(internal.id, "failed", null, captureRequestId);
      return {
        statusCode: 502,
        body: errorBody("ORDER_MISMATCH", "Capture response order id mismatch.")
      };
    }

    const paypalCaptureId = fields.paypalCaptureId
      || (internal.paypal_capture_id ? String(internal.paypal_capture_id) : null);

    async function keepCapturePending(reason) {
      await repo.transitionStatus(
        internal.id,
        "capture_pending",
        paypalCaptureId,
        captureRequestId
      );
      return {
        statusCode: 503,
        body: errorBody(
          "PAYPAL_ORDER_LOOKUP_FAILED",
          "Capture succeeded; awaiting authoritative PayPal order fields or webhook.",
          { reason }
        )
      };
    }

    if (!paypalCaptureId || !fields.captureStatus) {
      if (captureHttpSucceeded) {
        return keepCapturePending("CAPTURE_FIELDS_MISSING_FROM_ORDER");
      }
      await repo.transitionStatus(internal.id, "failed", null, captureRequestId);
      return {
        statusCode: 502,
        body: errorBody("PAYPAL_CAPTURE_FAILED", "Capture id missing.")
      };
    }

    if (!fields.amount || !fields.currency) {
      return keepCapturePending("AMOUNT_FIELDS_MISSING_FROM_ORDER");
    }

    if (!amountsEqual(fields.amount, internal.amount)
      || String(fields.currency).toUpperCase() !== String(internal.currency || "").toUpperCase()) {
      await repo.transitionStatus(internal.id, "failed", paypalCaptureId, captureRequestId);
      return {
        statusCode: 502,
        body: errorBody("AMOUNT_MISMATCH", "Capture amount/currency mismatch.")
      };
    }

    const actualMerchant = normalizeMerchantId(fields.payeeMerchantId);
    if (!actualMerchant) {
      // Missing merchant is NOT a mismatch — wait for GET/webhook.
      return keepCapturePending("MERCHANT_ID_MISSING_FROM_CAPTURE_RESPONSE");
    }

    if (actualMerchant !== merchantIdExpected) {
      await repo.transitionStatus(internal.id, "failed", paypalCaptureId, captureRequestId);
      return {
        statusCode: 502,
        body: errorBody("MERCHANT_MISMATCH", "Capture payee merchant mismatch.")
      };
    }

    if (typeof repo.findByPaypalCaptureId === "function") {
      const other = await repo.findByPaypalCaptureId(paypalCaptureId);
      if (other && String(other.id) !== String(internal.id)) {
        await repo.transitionStatus(internal.id, "failed", null, captureRequestId);
        return {
          statusCode: 502,
          body: errorBody("CAPTURE_ID_CONFLICT", "Capture id already used by another order.")
        };
      }
    }

    const captureStatus = String(fields.captureStatus || "").toUpperCase();

    if (captureStatus === "COMPLETED") {
      await repo.transitionStatus(internal.id, "paid", paypalCaptureId, captureRequestId);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "paid",
          message: "付款正在確認"
        }
      };
    }

    if (captureStatus === "PENDING") {
      await repo.transitionStatus(internal.id, "capture_pending", paypalCaptureId, captureRequestId);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "capture_pending",
          message: "付款正在確認"
        }
      };
    }

    if (captureStatus === "DECLINED" || captureStatus === "DENIED") {
      await repo.transitionStatus(internal.id, "denied", paypalCaptureId, captureRequestId);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "denied",
          message: "付款失敗"
        }
      };
    }

    await repo.transitionStatus(internal.id, "failed", paypalCaptureId, captureRequestId);
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "failed",
        message: "付款失敗"
      }
    };
  } catch (error) {
    // deno-lint-ignore no-explicit-any
    const msg = String((error as any)?.message || "");
    if (msg.includes("CAPTURE_ID")) {
      return {
        statusCode: 502,
        body: errorBody("CAPTURE_ID_CONFLICT", "Capture id conflict.")
      };
    }
    const code = msg === "PAYPAL_CAPTURE_FAILED"
      ? "PAYPAL_CAPTURE_FAILED"
      : "DB_ERROR";
    return {
      statusCode: toHttpStatus(code),
      body: errorBody(code, "Failed to capture payment order.")
    };
  }
}

export async function handlePaypalCheckoutRequest({ body, user, correlationId, deps = {} }: any) {
  const action = String(body?.action || "").trim();

  if (action === "create-order") {
    const result = await handleCreateOrder({ body, user, deps });
    return { ...result, correlationId };
  }

  if (action === "capture-order") {
    const result = await handleCaptureOrder({ body, user, deps });
    return { ...result, correlationId };
  }

  return {
    statusCode: 400,
    body: errorBody("INVALID_REQUEST", "action must be create-order or capture-order."),
    correlationId,
  };
}

// deno-lint-ignore no-explicit-any
export function createPaymentOrdersRepositoryFromSupabase(serviceClient: any) {
  return {
    async failStaleOpenOrders(
      userId: string,
      planCode: string,
      maxAgeMinutes = 15,
      _nowMs = Date.now(),
    ) {
      // Production RPC uses DB NOW(); _nowMs is for test doubles only.
      const { error } = await serviceClient.rpc("fail_stale_open_payment_orders", {
        p_user_id: userId,
        p_plan_code: planCode,
        p_max_age_minutes: maxAgeMinutes,
      });
      if (error) throw error;
    },

    // deno-lint-ignore no-explicit-any
    async findOpenOrderByUserPlan(userId: string, planCode: string, opts: any = {}) {
      const maxAgeMs = Number(opts.maxAgeMs) > 0 ? Number(opts.maxAgeMs) : OPEN_ORDER_TTL_MS;
      const nowMs = Number(opts.nowMs) > 0 ? Number(opts.nowMs) : Date.now();
      const minCreated = new Date(nowMs - maxAgeMs).toISOString();

      const { data, error } = await serviceClient
        .from("payment_orders")
        .select("*")
        .eq("user_id", userId)
        .eq("plan_code", planCode)
        .in("status", ["created", "approved", "capture_pending"])
        .gte("created_at", minCreated)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async createPaymentOrder({
      userId,
      planCode,
      amount,
      currency,
      createRequestId,
    }: {
      userId: string;
      planCode: string;
      amount: string;
      currency: string;
      createRequestId: string;
    }) {
      const { data, error } = await serviceClient.rpc("create_payment_order", {
        p_user_id: userId,
        p_plan_code: planCode,
        p_amount: amount,
        p_currency: currency,
        p_create_request_id: createRequestId,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async attachPaypalOrderId(orderId: string, paypalOrderId: string) {
      const { data, error } = await serviceClient.rpc("attach_paypal_order_id", {
        p_order_id: orderId,
        p_paypal_order_id: paypalOrderId,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async findByPaypalOrderId(paypalOrderId: string) {
      const { data, error } = await serviceClient
        .from("payment_orders")
        .select("*")
        .eq("paypal_order_id", paypalOrderId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async findByPaypalCaptureId(paypalCaptureId: string) {
      const { data, error } = await serviceClient
        .from("payment_orders")
        .select("*")
        .eq("paypal_capture_id", paypalCaptureId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async transitionStatus(
      orderId: string,
      newStatus: string,
      paypalCaptureId: string | null,
      captureRequestId: string | null,
    ) {
      const { data, error } = await serviceClient.rpc("transition_payment_order_status", {
        p_order_id: orderId,
        p_new_status: newStatus,
        p_paypal_capture_id: paypalCaptureId,
        p_capture_request_id: captureRequestId,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
  };
}

export { createPaypalClient };
