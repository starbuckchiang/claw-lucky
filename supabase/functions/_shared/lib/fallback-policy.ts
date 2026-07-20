// ESM port of `js/services/ai/fallback/fallback-policy.js`. Logic unchanged
// (deterministic lookup table, no heuristics/LLM decisions).

export const NEVER_FALLBACK_CODES: ReadonlySet<string> = new Set([
  "INVALID_REQUEST",
  "UNSUPPORTED_WALLPAPER_STYLE",
  "UNSUPPORTED_PROMPT_TYPE",
  "UNAUTHORIZED",
  "UNAUTHORIZED_GENERATION_ACCESS",
  "DAILY_LIMIT_EXCEEDED",
  "PROVIDER_AUTH_FAILED",
  "PROVIDER_BAD_REQUEST",
  "CONTENT_REJECTED"
]);

export const FALLBACK_ELIGIBLE_CODES: ReadonlySet<string> = new Set([
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_UNKNOWN",
  "PROVIDER_FAILURE"
]);

export function isFallbackEligible({
  failureCode,
  diagnostics
  // deno-lint-ignore no-explicit-any
}: { failureCode?: string | null; diagnostics?: any } = {}): boolean {
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
