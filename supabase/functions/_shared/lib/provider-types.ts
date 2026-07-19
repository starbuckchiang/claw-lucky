// ESM port of `js/services/ai/provider-types.js`. Logic unchanged.

export class NormalizedProviderError extends Error {
  code: string;
  retryable: boolean;
  statusCode?: number;
  // deno-lint-ignore no-explicit-any
  cause?: any;
  // deno-lint-ignore no-explicit-any
  diagnostics?: any;
  // Attached by GeminiProvider after construction (safe, non-secret
  // metadata) so downstream normalization doesn't have to hardcode a null
  // model when all it has is the error. See gemini-provider.ts.
  model?: string | null;

  constructor(
    code: string,
    message: string,
    retryable: boolean,
    statusCode?: number,
    // deno-lint-ignore no-explicit-any
    cause?: any,
    // deno-lint-ignore no-explicit-any
    diagnostics?: any
  ) {
    super(message);
    this.name = "NormalizedProviderError";
    this.code = code;
    this.message = message;
    this.retryable = retryable;
    this.statusCode = statusCode;
    // The original, unsafe error cause for internal use if needed, but not for logging.
    this.cause = cause;
    // The sanitized, safe-to-log diagnostic object.
    this.diagnostics = diagnostics;
  }
}
