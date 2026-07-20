"use strict";

/**
 * Deterministic, configuration-driven fallback eligibility policy.
 *
 * This is a plain lookup table + one deliberate special case (SAFETY-blocked
 * responses) — NOT a heuristic/LLM decision. Given the SAME failureCode and
 * diagnostics, the answer is always the same.
 *
 * NEVER fall back for business/user-caused failures (per requirement):
 * invalid input, auth/authorization failures, daily limit, invalid
 * reference images / bad request shape, content policy rejection.
 */
const NEVER_FALLBACK_CODES = Object.freeze(new Set([
  "INVALID_REQUEST",
  "UNSUPPORTED_WALLPAPER_STYLE",
  "UNSUPPORTED_PROMPT_TYPE",
  "UNAUTHORIZED",
  "UNAUTHORIZED_GENERATION_ACCESS",
  "DAILY_LIMIT_EXCEEDED",
  "PROVIDER_AUTH_FAILED",
  "PROVIDER_BAD_REQUEST",
  "CONTENT_REJECTED"
]));

/**
 * Fall back ONLY for infrastructure/provider-level failures.
 */
const FALLBACK_ELIGIBLE_CODES = Object.freeze(new Set([
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_UNKNOWN",
  "PROVIDER_FAILURE"
]));

/**
 * `PROVIDER_INVALID_RESPONSE` needs finer-grained handling: Gemini raises it
 * both for genuinely malformed/empty responses (infra-ish, eligible) AND for
 * safety/content-policy-blocked responses (`diagnostics.finishReason ===
 * "SAFETY"`, a business decision by the provider — never eligible).
 */
function isFallbackEligible({ failureCode, diagnostics } = {}) {
  const code = String(failureCode || "").trim();
  if (!code) return false;

  if (NEVER_FALLBACK_CODES.has(code)) return false;

  if (code === "PROVIDER_INVALID_RESPONSE") {
    const finishReason = String(diagnostics?.finishReason || "").toUpperCase();
    if (finishReason === "SAFETY") return false;
    return true;
  }

  return FALLBACK_ELIGIBLE_CODES.has(code);
}

module.exports = {
  NEVER_FALLBACK_CODES,
  FALLBACK_ELIGIBLE_CODES,
  isFallbackEligible
};
