// ESM port of `js/services/ai/contracts/provider-error.js`. Logic unchanged.

// deno-lint-ignore no-explicit-any
export function toProviderErrorInfo(error: any, provider?: string | null, correlationId?: string | null) {
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
