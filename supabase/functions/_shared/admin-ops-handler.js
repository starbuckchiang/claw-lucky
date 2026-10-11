"use strict";

/**
 * PROD-RELEASE-DAY3C (line 151-198): minimal admin backend shared handler
 * (Node twin). Every action re-checks admin status SERVER-SIDE via
 * `is_admin_user()` BEFORE doing anything else — a client can never assert
 * its own admin role. All mutating actions write to `admin_audit_log`
 * (enforced inside the SQL RPCs themselves, not here).
 */

const ERROR_HTTP_STATUS = Object.freeze({
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  INVALID_REQUEST: 400,
  INVALID_DECISION: 400,
  REFUND_REQUEST_NOT_FOUND: 404,
  REFUND_REQUEST_NOT_PENDING: 409,
  REFUND_REQUEST_NOT_APPROVED: 409,
  REFUND_ALREADY_CONFIRMED: 409,
  REFUND_RECORD_REQUIRED: 400,
  GIFT_NOT_ELIGIBLE: 404,
  SHIPMENT_NOT_READY: 409,
  SHIPMENT_HELD_BY_REFUND_REQUEST: 409,
  TRACKING_NUMBER_REQUIRED: 400,
  DB_ERROR: 503
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

function requireAuthenticatedUser(user) {
  if (!user || !user.id) {
    return { ok: false, code: "AUTH_REQUIRED", message: "Authentication required." };
  }
  return { ok: true, userId: String(user.id) };
}

function mapRpcException(error) {
  const msg = String(error?.message || error?.code || error || "");
  const known = [
    "FORBIDDEN",
    "INVALID_DECISION",
    "REFUND_REQUEST_NOT_FOUND",
    "REFUND_REQUEST_NOT_PENDING",
    "REFUND_REQUEST_NOT_APPROVED",
    "REFUND_ALREADY_CONFIRMED",
    "REFUND_RECORD_REQUIRED",
    "GIFT_NOT_ELIGIBLE",
    "SHIPMENT_NOT_READY",
    "SHIPMENT_HELD_BY_REFUND_REQUEST",
    "TRACKING_NUMBER_REQUIRED"
  ];
  for (const code of known) {
    if (msg.includes(code)) {
      return { code, message: code.replace(/_/g, " ").toLowerCase() + "." };
    }
  }
  return { code: "DB_ERROR", message: "Database operation failed." };
}

/**
 * Every action below performs the SAME two-step gate: resolve the real
 * authenticated userId first, then ask the DB (never the client) whether
 * that userId is an admin, via a dedicated repo.isAdminUser() call. A
 * non-admin gets a generic 403 FORBIDDEN — never a different message that
 * would let someone probe which accounts are/aren't admins.
 */
async function requireAdmin(user, repo) {
  const auth = requireAuthenticatedUser(user);
  if (!auth.ok) return auth;
  if (!repo?.isAdminUser) {
    return { ok: false, code: "DB_ERROR", message: "Admin repository is not configured." };
  }
  let isAdmin = false;
  try {
    isAdmin = await repo.isAdminUser(auth.userId);
  } catch (_error) {
    return { ok: false, code: "DB_ERROR", message: "Failed to verify admin status." };
  }
  if (!isAdmin) {
    return { ok: false, code: "FORBIDDEN", message: "Admin access required." };
  }
  return { ok: true, userId: auth.userId };
}

async function handleListPendingRefunds({ user, deps }) {
  const auth = await requireAdmin(user, deps.repository);
  if (!auth.ok) {
    return { statusCode: toHttpStatus(auth.code), body: errorBody(auth.code, auth.message) };
  }

  let rows;
  try {
    rows = await deps.repository.listPendingRefunds(auth.userId);
  } catch (_error) {
    return { statusCode: toHttpStatus("DB_ERROR"), body: errorBody("DB_ERROR", "Failed to load refund requests.") };
  }

  return { statusCode: 200, body: { ok: true, refund_requests: rows || [] } };
}

async function handleReviewRefund({ body, user, deps }) {
  const auth = await requireAdmin(user, deps.repository);
  if (!auth.ok) {
    return { statusCode: toHttpStatus(auth.code), body: errorBody(auth.code, auth.message) };
  }

  const requestId = String(body?.requestId || "").trim();
  const decision = String(body?.decision || "").trim();
  if (!requestId || !decision) {
    return { statusCode: 400, body: errorBody("INVALID_REQUEST", "requestId and decision are required.") };
  }

  let result;
  try {
    result = await deps.repository.reviewRefund({
      adminUserId: auth.userId,
      requestId,
      decision,
      note: body?.note != null ? String(body.note).trim().slice(0, 500) : null
    });
  } catch (error) {
    const mapped = mapRpcException(error);
    return { statusCode: toHttpStatus(mapped.code), body: errorBody(mapped.code, mapped.message) };
  }

  return { statusCode: 200, body: { ok: true, request_id: result?.request_id || requestId, status: result?.status || null } };
}

async function handleConfirmRefundSuccess({ body, user, deps }) {
  const auth = await requireAdmin(user, deps.repository);
  if (!auth.ok) {
    return { statusCode: toHttpStatus(auth.code), body: errorBody(auth.code, auth.message) };
  }

  const requestId = String(body?.requestId || "").trim();
  const paypalRefundId = String(body?.paypalRefundId || "").trim();
  if (!requestId || !paypalRefundId) {
    return { statusCode: 400, body: errorBody("INVALID_REQUEST", "requestId and paypalRefundId are required.") };
  }

  let result;
  try {
    result = await deps.repository.confirmRefundSuccess({
      adminUserId: auth.userId,
      requestId,
      paypalRefundId
    });
  } catch (error) {
    const mapped = mapRpcException(error);
    return { statusCode: toHttpStatus(mapped.code), body: errorBody(mapped.code, mapped.message) };
  }

  return {
    statusCode: 200,
    body: { ok: true, request_id: result?.request_id || requestId, refund_success: Boolean(result?.refund_success) }
  };
}

async function handleListShippableGifts({ user, deps }) {
  const auth = await requireAdmin(user, deps.repository);
  if (!auth.ok) {
    return { statusCode: toHttpStatus(auth.code), body: errorBody(auth.code, auth.message) };
  }

  let rows;
  try {
    rows = await deps.repository.listShippableGifts(auth.userId);
  } catch (_error) {
    return { statusCode: toHttpStatus("DB_ERROR"), body: errorBody("DB_ERROR", "Failed to load shippable gifts.") };
  }

  return { statusCode: 200, body: { ok: true, gifts: rows || [] } };
}

async function handleMarkShipped({ body, user, deps }) {
  const auth = await requireAdmin(user, deps.repository);
  if (!auth.ok) {
    return { statusCode: toHttpStatus(auth.code), body: errorBody(auth.code, auth.message) };
  }

  const entitlementId = String(body?.entitlementId || "").trim();
  const trackingNumber = String(body?.trackingNumber || "").trim();
  if (!entitlementId || !trackingNumber) {
    return { statusCode: 400, body: errorBody("INVALID_REQUEST", "entitlementId and trackingNumber are required.") };
  }

  let result;
  try {
    result = await deps.repository.markShipped({
      adminUserId: auth.userId,
      entitlementId,
      trackingNumber
    });
  } catch (error) {
    const mapped = mapRpcException(error);
    return { statusCode: toHttpStatus(mapped.code), body: errorBody(mapped.code, mapped.message) };
  }

  return {
    statusCode: 200,
    body: { ok: true, entitlement_id: result?.entitlement_id || entitlementId, status: result?.status || null }
  };
}

async function handleAdminOpsRequest({ body, user, correlationId, deps = {} }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      statusCode: 400,
      body: errorBody("INVALID_REQUEST", "Request body must be a JSON object."),
      correlationId
    };
  }

  const action = String(body.action || "").trim();

  if (action === "list_pending_refunds") {
    const result = await handleListPendingRefunds({ user, deps });
    return { ...result, correlationId };
  }
  if (action === "review_refund") {
    const result = await handleReviewRefund({ body, user, deps });
    return { ...result, correlationId };
  }
  if (action === "confirm_refund_success") {
    const result = await handleConfirmRefundSuccess({ body, user, deps });
    return { ...result, correlationId };
  }
  if (action === "list_shippable_gifts") {
    const result = await handleListShippableGifts({ user, deps });
    return { ...result, correlationId };
  }
  if (action === "mark_shipped") {
    const result = await handleMarkShipped({ body, user, deps });
    return { ...result, correlationId };
  }

  return {
    statusCode: 400,
    body: errorBody(
      "INVALID_REQUEST",
      "action must be list_pending_refunds, review_refund, confirm_refund_success, list_shippable_gifts, or mark_shipped."
    ),
    correlationId
  };
}

function createAdminOpsRepositoryFromSupabase(serviceClient) {
  return {
    async isAdminUser(userId) {
      const { data, error } = await serviceClient.rpc("is_admin_user", { p_user_id: userId });
      if (error) throw error;
      return Boolean(Array.isArray(data) ? data[0] : data);
    },

    async listPendingRefunds(adminUserId) {
      const { data, error } = await serviceClient.rpc("admin_list_pending_refund_requests", {
        p_admin_user_id: adminUserId
      });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },

    async reviewRefund({ adminUserId, requestId, decision, note }) {
      const { data, error } = await serviceClient.rpc("admin_review_refund_request", {
        p_admin_user_id: adminUserId,
        p_request_id: requestId,
        p_decision: decision,
        p_note: note
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async confirmRefundSuccess({ adminUserId, requestId, paypalRefundId }) {
      const { data, error } = await serviceClient.rpc("admin_confirm_refund_success", {
        p_admin_user_id: adminUserId,
        p_request_id: requestId,
        p_paypal_refund_id: paypalRefundId
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async listShippableGifts(adminUserId) {
      const { data, error } = await serviceClient.rpc("admin_list_shippable_gifts", {
        p_admin_user_id: adminUserId
      });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },

    async markShipped({ adminUserId, entitlementId, trackingNumber }) {
      const { data, error } = await serviceClient.rpc("admin_mark_gift_shipped", {
        p_admin_user_id: adminUserId,
        p_entitlement_id: entitlementId,
        p_tracking_number: trackingNumber
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    }
  };
}

module.exports = {
  handleAdminOpsRequest,
  handleListPendingRefunds,
  handleReviewRefund,
  handleConfirmRefundSuccess,
  handleListShippableGifts,
  handleMarkShipped,
  createAdminOpsRepositoryFromSupabase,
  requireAdmin,
  toHttpStatus,
  ERROR_HTTP_STATUS
};
