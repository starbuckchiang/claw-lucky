"use strict";

/**
 * Wallet Ops — Shared Request Handler (Node.js / CommonJS) (P-AUTH-05B-2A,
 * revised by the P-AUTH-05B-2A Hotfix)
 *
 * Mirrors account-merge-handler.js's convention: this file is the
 * Node.js-testable source of truth; the Supabase Edge Runtime (Deno) loads
 * `wallet-ops-handler.ts`, a line-for-line ESM twin. Whenever business
 * logic changes here, mirror the change in the `.ts` twin (same function
 * names, same error codes, same HTTP status mapping).
 *
 * THREE routes (hotfix requirements 2/3 removed the other two — see
 * below):
 *   - ensure-user  -> Api.createUserIfNotExists() adapter
 *   - gacha-draw   -> Api.claimGachaDraw() (atomic; server rolls its OWN
 *                     random draw — requirement 1)
 *   - gift-redeem  -> Api.redeemGift() adapter (atomic; requirement 4)
 *
 * REMOVED by the P-AUTH-05B-2A Hotfix (requirements 2/3):
 *   - `adjust-balance` (generic pointsDelta/ticketsDelta/coinsDelta from
 *     the browser) — there is no longer ANY public route accepting
 *     arbitrary balance deltas. Each reward is now its own explicit,
 *     server-defined operation. `Api.adjustBalance()` is now a deprecated,
 *     always-rejecting stub (see js/api.js) — it is NOT wired to any route
 *     here anymore, and never falls back to an insecure direct write.
 *   - `upsert-mascot` (standalone mascot upsert) — `user_mascots` may ONLY
 *     be written from inside `claim_gacha_draw`'s own internal call to
 *     `upsert_user_mascot_obtain`. `Api.upsertUserMascot()` is likewise a
 *     deprecated, always-rejecting stub.
 *
 * Requirement 2 (owner ID): every route resolves its identity SOLELY from
 * `params.user` (already verified server-side by the Edge Function
 * entrypoint from the Authorization JWT) — every request body is
 * additionally validated against a STRICT allowlist that explicitly
 * REJECTS `userId`/`user_id`/`ownerId`/`owner_id` if present, so a caller
 * can never even attempt to smuggle an owner id through the body.
 *
 * Requirement 1 (gacha-draw business authority): the gacha-draw route's
 * allowlist is ONLY `idempotencyKey` — `mascotId`/reward/points/tickets/
 * any rarity hint are NOT allowed fields at all. The RPC
 * (`claim_gacha_draw`) decides the outcome entirely server-side; this
 * handler has nothing to validate/forward for "which mascot" because there
 * is no such input anymore.
 *
 * Requirement 5 (idempotency): `idempotencyKey` is REQUIRED on gacha-draw/
 * gift-redeem and is passed straight through to the RPC unchanged — this
 * handler layer does not generate, cache, or re-derive it; the CALLER
 * (js/api.js, which in turn is driven by the page-level click handler) is
 * responsible for creating it once per operation and reusing it on retry.
 *
 * Requirement 8 (safe logs): every failure path logs ONLY `correlationId`
 * plus a small ALLOWLISTED `reason` code (see the `classify*Reason`
 * helpers below) — NEVER the raw error message, `user_id`, JWT,
 * Authorization header, email, or the request body. Balance/stock reasons
 * (insufficient coins/points/tickets, out of stock, not found) ARE surfaced
 * distinctly to the CALLER (they are the user's own ordinary, non-sensitive
 * state, unlike account-merge's claim validation) — but ANY reason this
 * module doesn't recognize (including "idempotency key does not belong to
 * this user", i.e. a cross-user replay attempt) collapses to the SAME
 * generic failure code as a random unexpected DB error, so a replay attempt
 * never gets a distinguishing response from an ordinary failure. Every
 * error response also carries a `retryable` boolean (hotfix requirement 5):
 * `false` for a definitive business rejection (retrying the identical
 * operation would just fail again the same way), `true` ONLY for the
 * generic/unrecognized RPC failure (a plausible transient hiccup, safe to
 * retry with the SAME idempotency key).
 */

const ERROR_HTTP_STATUS = Object.freeze({
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
  GIFT_REDEEM_FAILED: 502
});

function toHttpStatus(code) {
  return ERROR_HTTP_STATUS[code] || 500;
}

// Shared across all routes: a request body may NEVER carry an owner
// identity field, regardless of which route it's for (requirement 2).
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
  // Requirement 8: ONLY correlationId + an allowlisted reason code — NEVER
  // user_id/JWT/Authorization/email/raw message/request body.
  console.error(JSON.stringify({ level: "error", event, correlationId, reason }));
}

// --- ensure-user ---

function validateEnsureUserRequestShape(body) {
  return validateShape(body, { required: [], allowed: ["nickname"] });
}

async function handleEnsureUserRequest({ body, user, correlationId, deps = {} }) {
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

// --- gacha-draw ---
//
// Hotfix requirement 1: the ONLY allowed field is `idempotencyKey` —
// `mascotId`/reward/points/tickets/rarity are NOT accepted at all (an
// allowlist violation, same as an owner-id-forgery attempt, 400
// INVALID_REQUEST). The server decides which mascot/rarity was drawn.

function validateGachaDrawRequestShape(body) {
  return validateShape(body, {
    required: ["idempotencyKey"],
    allowed: ["idempotencyKey"]
  });
}

function classifyGachaFailureReason(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/insufficient coins/i.test(message)) return "INSUFFICIENT_COINS";
  if (/mascot .* not found/i.test(message)) return "MASCOT_NOT_FOUND";
  if (/user .* not found/i.test(message)) return "USER_NOT_FOUND";
  // Deliberately includes "idempotency key does not belong to this user"
  // (a cross-user replay attempt) and "no rarity weights configured"/"no
  // enabled mascots available" (server-side config problems, not the
  // caller's fault to distinguish) — collapsed to the same generic
  // UNKNOWN/failure response as any other unrecognized error, never
  // surfaced distinctly.
  return "UNKNOWN";
}

async function handleGachaDrawRequest({ body, user, correlationId, deps = {} }) {
  const validationErrors = validateGachaDrawRequestShape(body);
  if (validationErrors.length > 0) {
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed.", correlationId, { details: { errors: validationErrors } });
  }

  const authError = requireAuthenticatedUser(user, correlationId);
  if (authError) return authError;

  try {
    const result = await deps.repository.claimGachaDraw({
      userId: String(user.id),
      idempotencyKey: body.idempotencyKey
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

// --- gift-redeem ---

function validateGiftRedeemRequestShape(body) {
  return validateShape(body, {
    required: ["giftId", "idempotencyKey"],
    allowed: ["giftId", "idempotencyKey"]
  });
}

function classifyGiftFailureReason(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/gift .* not found or not enabled/i.test(message)) return "GIFT_NOT_FOUND";
  if (/out of stock/i.test(message)) return "OUT_OF_STOCK";
  if (/insufficient points/i.test(message)) return "INSUFFICIENT_POINTS";
  if (/insufficient tickets/i.test(message)) return "INSUFFICIENT_TICKETS";
  if (/insufficient coins/i.test(message)) return "INSUFFICIENT_COINS";
  if (/user .* not found/i.test(message)) return "USER_NOT_FOUND";
  // Deliberately includes "idempotency key does not belong to this user".
  return "UNKNOWN";
}

async function handleGiftRedeemRequest({ body, user, correlationId, deps = {} }) {
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
      idempotencyKey: body.idempotencyKey
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

module.exports = {
  handleEnsureUserRequest,
  handleGachaDrawRequest,
  handleGiftRedeemRequest,
  validateEnsureUserRequestShape,
  validateGachaDrawRequestShape,
  validateGiftRedeemRequestShape,
  classifyGachaFailureReason,
  classifyGiftFailureReason,
  toHttpStatus
};
