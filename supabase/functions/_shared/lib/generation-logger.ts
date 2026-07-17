// ESM port of `js/services/logging/generation-logger.js`. Logic unchanged
// (structured logging + sensitive-data masking).

const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
  "prompt",
  "promptText",
  "promptTemplate",
  "userId",
  "apiKey",
  "apikey",
  "secret",
  "providerSecret",
  "authorization",
  "token",
  "accessToken"
]);

// deno-lint-ignore no-explicit-any
function sanitizeObject(value: any): any {
  if (Array.isArray(value)) {
    return value.map(sanitizeObject);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) {
      output[key] = REDACTED_VALUE;
      continue;
    }
    output[key] = sanitizeObject(item);
  }
  return output;
}

export function createGenerationLogger({
  sink = (entry: unknown) => console.log(JSON.stringify(entry)),
  now = () => new Date().toISOString()
}: {
  // deno-lint-ignore no-explicit-any
  sink?: (entry: any) => void;
  now?: () => string;
} = {}) {
  if (typeof sink !== "function") {
    throw new Error("createGenerationLogger requires sink(entry) function.");
  }

  function write({
    level = "info",
    event,
    correlationId,
    payload = {}
    // deno-lint-ignore no-explicit-any
  }: any) {
    const normalizedCorrelationId = String(correlationId || "").trim();
    if (!normalizedCorrelationId) {
      throw new Error("All log entries must include correlationId.");
    }

    const entry = {
      level: String(level),
      event: String(event || "generation_event"),
      correlationId: normalizedCorrelationId,
      timestamp: now(),
      payload: sanitizeObject(payload)
    };

    sink(entry);
    return entry;
  }

  return {
    // deno-lint-ignore no-explicit-any
    logInfo(input: any) {
      return write({ ...input, level: "info" });
    },
    // deno-lint-ignore no-explicit-any
    logWarn(input: any) {
      return write({ ...input, level: "warn" });
    },
    // deno-lint-ignore no-explicit-any
    logError(input: any) {
      return write({ ...input, level: "error" });
    }
  };
}
