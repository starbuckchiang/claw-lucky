// ESM twin of `shop-ops-handler.js`. Logic unchanged — see that file's
// header for the full rationale. Whenever business logic changes here,
// mirror the change in the `.js` twin (same function names, same error
// codes, same HTTP status mapping).

const ERROR_HTTP_STATUS: Record<string, number> = Object.freeze({
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
  CHECKOUT_FAILED: 502,
});

export function toHttpStatus(code: string): number {
  return ERROR_HTTP_STATUS[code] || 500;
}

const OWNER_ID_FIELDS = ["userId", "user_id", "ownerId", "owner_id"];

// deno-lint-ignore no-explicit-any
function rejectOwnerIdFields(body: any, errors: string[]) {
  for (const field of OWNER_ID_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body || {}, field)) {
      errors.push(`${field} is not allowed in the request body.`);
    }
  }
}

function validateShape(
  // deno-lint-ignore no-explicit-any
  body: any,
  { required = [], allowed = [] }: { required?: string[]; allowed?: string[] },
): string[] {
  const errors: string[] = [];

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

function isSafeQuantity(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 99;
}

function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  correlationId: string,
  { details = null, retryable = false }: { details?: unknown; retryable?: boolean } = {},
) {
  return {
    statusCode,
    correlationId,
    body: { ok: false, error: { code, message, details, retryable: Boolean(retryable) } },
  };
}

// deno-lint-ignore no-explicit-any
function requireAuthenticatedUser(user: any, correlationId: string) {
  const userId = String(user?.id || "").trim();
  if (!userId) {
    return errorResponse(401, "UNAUTHORIZED", "無法辨識使用者身份，請重新整理頁面後再試一次。", correlationId);
  }
  return null;
}

function safeLog(event: string, correlationId: string, reason: string) {
  console.error(JSON.stringify({ level: "error", event, correlationId, reason }));
}

// --- cart-add ---

// deno-lint-ignore no-explicit-any
export function validateCartAddRequestShape(body: any): string[] {
  const errors = validateShape(body, { required: ["productId"], allowed: ["productId", "quantity"] });

  if (Object.prototype.hasOwnProperty.call(body || {}, "quantity") && !isSafeQuantity(body.quantity)) {
    errors.push("quantity must be an integer between 1 and 99.");
  }

  return errors;
}

export function classifyCartAddFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/product .* not found or not enabled/i.test(message)) return "PRODUCT_NOT_FOUND";
  if (/required mascot not unlocked/i.test(message)) return "MASCOT_NOT_UNLOCKED";
  if (/insufficient stock/i.test(message)) return "OUT_OF_STOCK";
  return "UNKNOWN";
}

export async function handleCartAddRequest({
  body,
  user,
  correlationId,
  deps = {},
  // deno-lint-ignore no-explicit-any
}: { body: any; user: any; correlationId: string; deps?: any }) {
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
      quantity: Object.prototype.hasOwnProperty.call(body, "quantity") ? body.quantity : 1,
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

// deno-lint-ignore no-explicit-any
export function validateCartUpdateRequestShape(body: any): string[] {
  const errors = validateShape(body, { required: ["cartId"], allowed: ["cartId", "quantity"] });

  if (!Object.prototype.hasOwnProperty.call(body || {}, "quantity") || !isSafeQuantity(body.quantity)) {
    errors.push("quantity must be an integer between 1 and 99.");
  }

  return errors;
}

export function classifyCartUpdateFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/cart item .* not found/i.test(message)) return "CART_ITEM_NOT_FOUND";
  if (/product .* not found or not enabled/i.test(message)) return "PRODUCT_NOT_FOUND";
  if (/insufficient stock/i.test(message)) return "OUT_OF_STOCK";
  return "UNKNOWN";
}

export async function handleCartUpdateRequest({
  body,
  user,
  correlationId,
  deps = {},
  // deno-lint-ignore no-explicit-any
}: { body: any; user: any; correlationId: string; deps?: any }) {
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
      quantity: body.quantity,
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

// deno-lint-ignore no-explicit-any
export function validateCartRemoveRequestShape(body: any): string[] {
  return validateShape(body, { required: ["cartId"], allowed: ["cartId"] });
}

export async function handleCartRemoveRequest({
  body,
  user,
  correlationId,
  deps = {},
  // deno-lint-ignore no-explicit-any
}: { body: any; user: any; correlationId: string; deps?: any }) {
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

// deno-lint-ignore no-explicit-any
export function validateCartClearRequestShape(body: any): string[] {
  return validateShape(body, { required: [], allowed: [] });
}

export async function handleCartClearRequest({
  body,
  user,
  correlationId,
  deps = {},
  // deno-lint-ignore no-explicit-any
}: { body: any; user: any; correlationId: string; deps?: any }) {
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

// deno-lint-ignore no-explicit-any
export function validateCheckoutRequestShape(body: any): string[] {
  return validateShape(body, { required: ["idempotencyKey"], allowed: ["idempotencyKey"] });
}

export function classifyCheckoutFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/cart is empty/i.test(message)) return "CART_EMPTY";
  if (/product .* not found or not enabled/i.test(message)) return "PRODUCT_NOT_FOUND";
  if (/insufficient stock/i.test(message)) return "OUT_OF_STOCK";
  return "UNKNOWN";
}

export async function handleCheckoutRequest({
  body,
  user,
  correlationId,
  deps = {},
  // deno-lint-ignore no-explicit-any
}: { body: any; user: any; correlationId: string; deps?: any }) {
  const validationErrors = validateCheckoutRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, { details: { errors: validationErrors } });
  }

  const authError = requireAuthenticatedUser(user, correlationId);
  if (authError) return authError;

  try {
    const result = await deps.repository.checkoutCart({
      userId: String(user.id),
      idempotencyKey: body.idempotencyKey,
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
