// ESM twin of `wallet-ops-handler.js`. Logic unchanged — see that file's
// header for the full rationale (including the P-AUTH-05B-2A Hotfix that
// removed adjust-balance/upsert-mascot and made gacha-draw accept ONLY
// idempotencyKey). Whenever business logic changes here, mirror the
// change in the `.js` twin (same function names, same error codes, same
// HTTP status mapping).

const ERROR_HTTP_STATUS: Record<string, number> = Object.freeze({
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  USER_NOT_FOUND: 404,
  MASCOT_NOT_FOUND: 404,
  GIFT_NOT_FOUND: 404,
  INSUFFICIENT_COINS: 409,
  INSUFFICIENT_POINTS: 409,
  INSUFFICIENT_TICKETS: 409,
  OUT_OF_STOCK: 409,
  ENSURE_USER_FAILED: 502,
  GACHA_DRAW_FAILED: 502,
  GIFT_REDEEM_FAILED: 502,
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

// deno-lint-ignore no-explicit-any
export function validateEnsureUserRequestShape(body: any): string[] {
  return validateShape(body, { required: [], allowed: ["nickname"] });
}

export async function handleEnsureUserRequest({
  body,
  user,
  correlationId,
  deps = {},
  // deno-lint-ignore no-explicit-any
}: { body: any; user: any; correlationId: string; deps?: any }) {
  const validationErrors = validateEnsureUserRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, { details: { errors: validationErrors } });
  }

  const authError = requireAuthenticatedUser(user, correlationId);
  if (authError) return authError;

  try {
    const result = await deps.repository.ensureUser({ userId: String(user.id), nickname: body?.nickname || "" });
    return { statusCode: 200, correlationId, body: { ok: true, data: result } };
  } catch (_error) {
    safeLog("wallet_ops_ensure_user_failed", correlationId, "RPC_ERROR");
    return errorResponse(502, "ENSURE_USER_FAILED", "無法建立使用者資料，請稍後再試一次。", correlationId, { retryable: true });
  }
}

// Hotfix requirement 1: the ONLY allowed field is `idempotencyKey` —
// mascotId/reward/points/tickets/rarity are NOT accepted at all.
// deno-lint-ignore no-explicit-any
export function validateGachaDrawRequestShape(body: any): string[] {
  return validateShape(body, {
    required: ["idempotencyKey"],
    allowed: ["idempotencyKey"],
  });
}

export function classifyGachaFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/insufficient coins/i.test(message)) return "INSUFFICIENT_COINS";
  if (/mascot .* not found/i.test(message)) return "MASCOT_NOT_FOUND";
  if (/user .* not found/i.test(message)) return "USER_NOT_FOUND";
  return "UNKNOWN";
}

export async function handleGachaDrawRequest({
  body,
  user,
  correlationId,
  deps = {},
  // deno-lint-ignore no-explicit-any
}: { body: any; user: any; correlationId: string; deps?: any }) {
  const validationErrors = validateGachaDrawRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, { details: { errors: validationErrors } });
  }

  const authError = requireAuthenticatedUser(user, correlationId);
  if (authError) return authError;

  try {
    const result = await deps.repository.claimGachaDraw({
      userId: String(user.id),
      idempotencyKey: body.idempotencyKey,
    });
    return { statusCode: 200, correlationId, body: { ok: true, data: result } };
  } catch (error) {
    const reason = classifyGachaFailureReason(error);
    safeLog("wallet_ops_gacha_draw_failed", correlationId, reason);

    if (reason === "INSUFFICIENT_COINS") {
      return errorResponse(409, "INSUFFICIENT_COINS", "好運幣不足，無法轉蛋。", correlationId);
    }
    if (reason === "MASCOT_NOT_FOUND") {
      return errorResponse(404, "MASCOT_NOT_FOUND", "找不到這隻吉祥物，請重新整理頁面後再試一次。", correlationId);
    }
    if (reason === "USER_NOT_FOUND") {
      return errorResponse(404, "USER_NOT_FOUND", "找不到使用者資料，請重新整理頁面後再試一次。", correlationId);
    }
    return errorResponse(502, "GACHA_DRAW_FAILED", "抽卡失敗，請稍後再試一次。", correlationId, { retryable: true });
  }
}

// deno-lint-ignore no-explicit-any
export function validateGiftRedeemRequestShape(body: any): string[] {
  return validateShape(body, {
    required: ["giftId", "idempotencyKey"],
    allowed: ["giftId", "idempotencyKey"],
  });
}

export function classifyGiftFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/gift .* not found or not enabled/i.test(message)) return "GIFT_NOT_FOUND";
  if (/out of stock/i.test(message)) return "OUT_OF_STOCK";
  if (/insufficient points/i.test(message)) return "INSUFFICIENT_POINTS";
  if (/insufficient tickets/i.test(message)) return "INSUFFICIENT_TICKETS";
  if (/insufficient coins/i.test(message)) return "INSUFFICIENT_COINS";
  if (/user .* not found/i.test(message)) return "USER_NOT_FOUND";
  return "UNKNOWN";
}

export async function handleGiftRedeemRequest({
  body,
  user,
  correlationId,
  deps = {},
  // deno-lint-ignore no-explicit-any
}: { body: any; user: any; correlationId: string; deps?: any }) {
  const validationErrors = validateGiftRedeemRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, { details: { errors: validationErrors } });
  }

  const authError = requireAuthenticatedUser(user, correlationId);
  if (authError) return authError;

  try {
    const result = await deps.repository.redeemGift({
      userId: String(user.id),
      giftId: body.giftId,
      idempotencyKey: body.idempotencyKey,
    });
    return { statusCode: 200, correlationId, body: { ok: true, data: result } };
  } catch (error) {
    const reason = classifyGiftFailureReason(error);
    safeLog("wallet_ops_gift_redeem_failed", correlationId, reason);

    if (reason === "GIFT_NOT_FOUND") {
      return errorResponse(404, "GIFT_NOT_FOUND", "找不到這個商品，請重新整理頁面後再試一次。", correlationId);
    }
    if (reason === "OUT_OF_STOCK") {
      return errorResponse(409, "OUT_OF_STOCK", "已兌換完畢，請選擇其他商品。", correlationId);
    }
    if (reason === "INSUFFICIENT_POINTS") {
      return errorResponse(409, "INSUFFICIENT_POINTS", "點數不足，無法兌換。", correlationId);
    }
    if (reason === "INSUFFICIENT_TICKETS") {
      return errorResponse(409, "INSUFFICIENT_TICKETS", "兌換券不足，無法兌換。", correlationId);
    }
    if (reason === "INSUFFICIENT_COINS") {
      return errorResponse(409, "INSUFFICIENT_COINS", "好運幣不足，無法兌換。", correlationId);
    }
    if (reason === "USER_NOT_FOUND") {
      return errorResponse(404, "USER_NOT_FOUND", "找不到使用者資料，請重新整理頁面後再試一次。", correlationId);
    }
    return errorResponse(502, "GIFT_REDEEM_FAILED", "兌換失敗，請稍後再試一次。", correlationId, { retryable: true });
  }
}

