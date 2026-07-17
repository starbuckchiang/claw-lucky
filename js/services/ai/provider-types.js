class NormalizedProviderError extends Error {
  constructor(code, message, retryable, statusCode, cause, diagnostics) {
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

module.exports = { NormalizedProviderError };