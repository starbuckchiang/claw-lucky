"use strict";

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

function sanitizeObject(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeObject);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) {
      output[key] = REDACTED_VALUE;
      continue;
    }
    output[key] = sanitizeObject(item);
  }
  return output;
}

function createGenerationLogger({
  sink = (entry) => console.log(JSON.stringify(entry)),
  now = () => new Date().toISOString()
} = {}) {
  if (typeof sink !== "function") {
    throw new Error("createGenerationLogger requires sink(entry) function.");
  }

  function write({
    level = "info",
    event,
    correlationId,
    payload = {}
  }) {
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
    logInfo(input) {
      return write({ ...input, level: "info" });
    },
    logWarn(input) {
      return write({ ...input, level: "warn" });
    },
    logError(input) {
      return write({ ...input, level: "error" });
    }
  };
}

module.exports = {
  createGenerationLogger
};
