"use strict";

/**
 * Shop Ops — Shared Request Handler (Node.js / CommonJS) (P-AUTH-05B-2B)
 *
 * Mirrors `wallet-ops-handler.js`'s convention exactly: this file is the
 * Node.js-testable source of truth; the Supabase Edge Runtime (Deno) loads
 * `shop-ops-handler.ts`, a line-for-line ESM twin. Whenever business logic
 * changes here, mirror the change in the `.ts` twin (same function names,
 * same error codes, same HTTP status mapping).
 *
 * FIVE routes, replacing `js/shop/shop-api.js`'s direct
 * `shop_cart`/`orders`/`order_items` writes (see
 * `20260817000400_shop_cart_checkout_secure_rpc.sql`'s header for the full
 * vulnerability rationale this closes):
 *   - cart-add     -> Api-level addToCart() adapter
 *   - cart-update  -> updateCartItem() adapter
 *   - cart-remove  -> removeCartItem() adapter
 *   - cart-clear   -> clearCart() adapter
 *   - checkout     -> atomic Checkout (creates orders + order_items,
 *                     decrements stock, clears cart — all server-side)
 *
 * Identity: every route resolves the owner SOLELY from `params.user`
 * (already verified server-side by the Edge Function entrypoint from the
 * Authorization JWT) — every request body is additionally validated
 * against a STRICT allowlist that explicitly REJECTS
 * `userId`/`user_id`/`ownerId`/`owner_id` if present, so a caller can never
 * even attempt to smuggle an owner id through the body (same convention as
 * wallet-ops-handler.js / account-merge-handler.js).
 *
 * Business authority: NONE of the five routes accept a price/subtotal/
 * total/product-name/product-image/stock parameter — those fields do not
 * exist as inputs anywhere in this file OR in the RPC signatures they call
 * (not merely "validated and rejected if mismatched" — the input channel
 * itself does not exist, mirroring the P-AUTH-05B-2A hotfix's
 * "claim_gacha_draw has no mascotId parameter" precedent).
 *
 * Safe logs: every failure path logs ONLY `correlationId` plus a small
 * FIXED allowlist `reason` code (see the `classify*Reason` helpers below)
 * — NEVER the raw error message, user_id, JWT, Authorization header, or
 * request body.
 */

const ERROR_HTTP_STATUS = Object.freeze({
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  PRODUCT_NOT_FOUND: 404,
  CART_ITEM_NOT_FOUND: 404,
  MASCOT_NOT_UNLOCKED: 403,
  OUT_OF_STOCK: 409,
  CART_EMPTY: 409,
  CART_ADD_FAILED: 502,
  CART_UPDATE_FAILED: 502,
  CART_REMOVE_FAILED: 502,
  CART_CLEAR_FAILED: 502,
  CHECKOUT_FAILED: 502
});

function toHttpStatus(code) {
  return ERROR_HTTP_STATUS[code] || 500;
}

// Shared across all routes: a request body may NEVER carry an owner
// identity field, regardless of which route it's for.
const OWNER_ID_FIELDS = ["userId", "user_id", "ownerId", "owner_id"];

function rejectOwnerIdFields(body, errors) {
  for (const field of OWNER_ID_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body || {}, field)) {
      errors.push(`${field} is not allowed in the request body.`);
    }
  }
}

function validateShape(body, { required = [], allowed = [] }) {
  const errors = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ["Request body must be a JSON object."];
  }

  for (const field of required) {
    if (typeof body[field] !== "string" || !body[field].trim()) {
      errors.push(`${field} is required.`);
    }
  }

  const allowedSet = new Set([...allowed, ...OWNER_ID_FIELDS]);
  for (const key of Object.keys(body)) {
    if (!allowedSet.has(key)) {
      errors.push(`${key} is not allowed in the request body.`);
    }
  }

  rejectOwnerIdFields(body, errors);

  return errors;
}

function isSafeQuantity(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 99;
}

function errorResponse(statusCode, code, message, correlationId, { details = null, retryable = false } = {}) {
  return {
    statusCode,
    correlationId,
    body: { ok: false, error: { code, message, details, retryable: Boolean(retryable) } }
  };
}

function requireAuthenticatedUser(user, correlationId) {
  const userId = String(user?.id || "").trim();
  if (!userId) {
    return errorResponse(401, "UNAUTHORIZED", "無法辨識使用者身份，請重新整理頁面後再試一次。", correlationId);
  }
  return null;
}

function safeLog(event, correlationId, reason) {
  console.error(JSON.stringify({ level: "error", event, correlationId, reason }));
}

// --- cart-add ---

function validateCartAddRequestShape(body) {
  const errors = validateShape(body, { required: ["productId"], allowed: ["productId", "quantity"] });

  if (Object.prototype.hasOwnProperty.call(body || {}, "quantity") && !isSafeQuantity(body.quantity)) {
    errors.push("quantity must be an integer between 1 and 99.");
  }

  return errors;
}

function classifyCartAddFailureReason(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/product .* not found or not enabled/i.test(message)) return "PRODUCT_NOT_FOUND";
  if (/required mascot not unlocked/i.test(message)) return "MASCOT_NOT_UNLOCKED";
  if (/insufficient stock/i.test(message)) return "OUT_OF_STOCK";
  return "UNKNOWN";
}

async function handleCartAddRequest({ body, user, correlationId, deps = {} }) {
  const validationErrors = validateCartAddRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, { details: { errors: validationErrors } });
  }

  const authError = requireAuthenticatedUser(user, correlationId);
  if (authError) return authError;

  try {
    const result = await deps.repository.addCartItem({
      userId: String(user.id),
      productId: body.productId,
      quantity: Object.prototype.hasOwnProperty.call(body, "quantity") ? body.quantity : 1
    });
    return { statusCode: 200, correlationId, body: { ok: true, data: result } };
  } catch (error) {
    const reason = classifyCartAddFailureReason(error);
    safeLog("shop_ops_cart_add_failed", correlationId, reason);

    if (reason === "PRODUCT_NOT_FOUND") {
      return errorResponse(404, "PRODUCT_NOT_FOUND", "找不到這個商品，請重新整理頁面後再試一次。", correlationId);
    }
    if (reason === "MASCOT_NOT_UNLOCKED") {
      return errorResponse(403, "MASCOT_NOT_UNLOCKED", "尚未解鎖此商品購買資格。", correlationId);
    }
    if (reason === "OUT_OF_STOCK") {
      return errorResponse(409, "OUT_OF_STOCK", "已超過庫存數量。", correlationId);
    }
    return errorResponse(502, "CART_ADD_FAILED", "加入好運籃失敗，請稍後再試一次。", correlationId, { retryable: true });
  }
}

// --- cart-update ---

function validateCartUpdateRequestShape(body) {
  const errors = validateShape(body, { required: ["cartId"], allowed: ["cartId", "quantity"] });

  if (!Object.prototype.hasOwnProperty.call(body || {}, "quantity") || !isSafeQuantity(body.quantity)) {
    errors.push("quantity must be an integer between 1 and 99.");
  }

  return errors;
}

function classifyCartUpdateFailureReason(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/cart item .* not found/i.test(message)) return "CART_ITEM_NOT_FOUND";
  if (/product .* not found or not enabled/i.test(message)) return "PRODUCT_NOT_FOUND";
  if (/insufficient stock/i.test(message)) return "OUT_OF_STOCK";
  return "UNKNOWN";
}

async function handleCartUpdateRequest({ body, user, correlationId, deps = {} }) {
  const validationErrors = validateCartUpdateRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, { details: { errors: validationErrors } });
  }

  const authError = requireAuthenticatedUser(user, correlationId);
  if (authError) return authError;

  try {
    const result = await deps.repository.updateCartItemQuantity({
      userId: String(user.id),
      cartId: body.cartId,
      quantity: body.quantity
    });
    return { statusCode: 200, correlationId, body: { ok: true, data: result } };
  } catch (error) {
    const reason = classifyCartUpdateFailureReason(error);
    safeLog("shop_ops_cart_update_failed", correlationId, reason);

    if (reason === "CART_ITEM_NOT_FOUND") {
      return errorResponse(404, "CART_ITEM_NOT_FOUND", "找不到這個好運籃商品，請重新整理頁面後再試一次。", correlationId);
    }
    if (reason === "PRODUCT_NOT_FOUND") {
      return errorResponse(404, "PRODUCT_NOT_FOUND", "找不到這個商品，請重新整理頁面後再試一次。", correlationId);
    }
    if (reason === "OUT_OF_STOCK") {
      return errorResponse(409, "OUT_OF_STOCK", "已超過庫存數量。", correlationId);
    }
    return errorResponse(502, "CART_UPDATE_FAILED", "更新好運籃失敗，請稍後再試一次。", correlationId, { retryable: true });
  }
}

// --- cart-remove ---

function validateCartRemoveRequestShape(body) {
  return validateShape(body, { required: ["cartId"], allowed: ["cartId"] });
}

async function handleCartRemoveRequest({ body, user, correlationId, deps = {} }) {
  const validationErrors = validateCartRemoveRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, { details: { errors: validationErrors } });
  }

  const authError = requireAuthenticatedUser(user, correlationId);
  if (authError) return authError;

  try {
    const removed = await deps.repository.removeCartItem({ userId: String(user.id), cartId: body.cartId });
    return { statusCode: 200, correlationId, body: { ok: true, data: { removed } } };
  } catch (_error) {
    safeLog("shop_ops_cart_remove_failed", correlationId, "RPC_ERROR");
    return errorResponse(502, "CART_REMOVE_FAILED", "刪除好運籃商品失敗，請稍後再試一次。", correlationId, { retryable: true });
  }
}

// --- cart-clear ---

function validateCartClearRequestShape(body) {
  return validateShape(body, { required: [], allowed: [] });
}

async function handleCartClearRequest({ body, user, correlationId, deps = {} }) {
  const validationErrors = validateCartClearRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, { details: { errors: validationErrors } });
  }

  const authError = requireAuthenticatedUser(user, correlationId);
  if (authError) return authError;

  try {
    const removedCount = await deps.repository.clearCart({ userId: String(user.id) });
    return { statusCode: 200, correlationId, body: { ok: true, data: { removedCount } } };
  } catch (_error) {
    safeLog("shop_ops_cart_clear_failed", correlationId, "RPC_ERROR");
    return errorResponse(502, "CART_CLEAR_FAILED", "清空好運籃失敗，請稍後再試一次。", correlationId, { retryable: true });
  }
}

// --- checkout ---

function validateCheckoutRequestShape(body) {
  return validateShape(body, { required: ["idempotencyKey"], allowed: ["idempotencyKey"] });
}

function classifyCheckoutFailureReason(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/cart is empty/i.test(message)) return "CART_EMPTY";
  if (/product .* not found or not enabled/i.test(message)) return "PRODUCT_NOT_FOUND";
  if (/insufficient stock/i.test(message)) return "OUT_OF_STOCK";
  // Deliberately includes "idempotency key does not belong to this user"
  // (a cross-user replay attempt) and "cached order ... missing" (an
  // internal data-inconsistency) — collapsed to the same generic UNKNOWN/
  // failure response as any other unrecognized error, never distinguished.
  return "UNKNOWN";
}

async function handleCheckoutRequest({ body, user, correlationId, deps = {} }) {
  const validationErrors = validateCheckoutRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, { details: { errors: validationErrors } });
  }

  const authError = requireAuthenticatedUser(user, correlationId);
  if (authError) return authError;

  try {
    const result = await deps.repository.checkoutCart({
      userId: String(user.id),
      idempotencyKey: body.idempotencyKey
    });
    return { statusCode: 200, correlationId, body: { ok: true, data: result } };
  } catch (error) {
    const reason = classifyCheckoutFailureReason(error);
    safeLog("shop_ops_checkout_failed", correlationId, reason);

    if (reason === "CART_EMPTY") {
      return errorResponse(409, "CART_EMPTY", "好運籃還是空的，先把商品加入好運籃吧。", correlationId);
    }
    if (reason === "PRODUCT_NOT_FOUND") {
      return errorResponse(404, "PRODUCT_NOT_FOUND", "好運籃內有商品已下架，請重新整理後再試一次。", correlationId);
    }
    if (reason === "OUT_OF_STOCK") {
      return errorResponse(409, "OUT_OF_STOCK", "好運籃內有商品庫存不足，請調整數量後再試一次。", correlationId);
    }
    return errorResponse(502, "CHECKOUT_FAILED", "建立訂單失敗，請稍後再試一次。", correlationId, { retryable: true });
  }
}

module.exports = {
  toHttpStatus,
  validateCartAddRequestShape,
  validateCartUpdateRequestShape,
  validateCartRemoveRequestShape,
  validateCartClearRequestShape,
  validateCheckoutRequestShape,
  classifyCartAddFailureReason,
  classifyCartUpdateFailureReason,
  classifyCheckoutFailureReason,
  handleCartAddRequest,
  handleCartUpdateRequest,
  handleCartRemoveRequest,
  handleCartClearRequest,
  handleCheckoutRequest
};
