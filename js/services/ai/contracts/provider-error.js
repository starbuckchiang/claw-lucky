"use strict";

/**
 * Provider Resilience Agent — shared error contract.
 *
 * Normalizes ANY provider error (Gemini, Replicate, future providers) into a
 * flat, safe-to-log info object WITHOUT discarding the original error. This
 * is a pure read-only accessor over fields already attached by each
 * provider's own adapter (see gemini-provider.js / replicate-flux-provider.js):
 * `.model`, `.httpStatus`, `.providerStatus`, `.providerCode`,
 * `.providerMessage`, `.retryable`. Never includes API keys, Authorization
 * headers, request bodies, or image data.
 */
function toProviderErrorInfo(error, provider, correlationId) {
  return {
    provider: String(provider || error?.provider || "unknown"),
    model: error?.model || null,
    httpStatus: error?.httpStatus ?? error?.statusCode ?? null,
    providerStatus: error?.providerStatus ?? null,
    providerCode: error?.providerCode ?? error?.code ?? null,
    providerMessage: String(error?.providerMessage || error?.message || "Provider call failed."),
    retryable: Boolean(error?.retryable),
    correlationId: String(correlationId || error?.correlationId || "")
  };
}

module.exports = { toProviderErrorInfo };
