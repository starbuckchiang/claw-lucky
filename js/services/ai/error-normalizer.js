"use strict";

const { FAILURE_CODES } = require("./failure-codes");

const RETRYABLE_CODES = new Set([
  FAILURE_CODES.TIMEOUT,
  FAILURE_CODES.RATE_LIMITED,
  FAILURE_CODES.PROVIDER_UNAVAILABLE,
  FAILURE_CODES.NETWORK_ERROR
]);

function toUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function pickErrorCode(error) {
  return toUpperText(
    error?.failureCode ||
      error?.code ||
      error?.errorCode ||
      error?.name
  );
}

function pickErrorStatus(error) {
  const rawStatus = error?.status ?? error?.statusCode ?? error?.response?.status;
  const numericStatus = Number(rawStatus);
  return Number.isFinite(numericStatus) ? numericStatus : null;
}

function pickErrorMessage(error) {
  const message =
    error?.failureMessage ||
    error?.message ||
    error?.error?.message ||
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    "Unknown provider error";

  return String(message).trim() || "Unknown provider error";
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function detectFailureCode(error) {
  const code = pickErrorCode(error);
  const status = pickErrorStatus(error);
  const messageUpper = toUpperText(pickErrorMessage(error));

  if (
    status === 408 ||
    code === "TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    includesAny(messageUpper, ["TIMEOUT", "TIMED OUT"])
  ) {
    return FAILURE_CODES.TIMEOUT;
  }

  if (
    status === 429 ||
    includesAny(code, ["RATE_LIMIT", "TOO_MANY_REQUESTS"]) ||
    includesAny(messageUpper, ["RATE LIMIT", "TOO MANY REQUESTS"])
  ) {
    return FAILURE_CODES.RATE_LIMITED;
  }

  if (
    status === 401 ||
    status === 403 ||
    includesAny(code, ["AUTH", "UNAUTHORIZED", "FORBIDDEN", "INVALID_API_KEY"]) ||
    includesAny(messageUpper, ["UNAUTHORIZED", "FORBIDDEN", "INVALID API KEY", "AUTH"])
  ) {
    return FAILURE_CODES.AUTH_ERROR;
  }

  if (
    status === 400 ||
    status === 422 ||
    includesAny(code, ["INVALID_REQUEST", "BAD_REQUEST", "VALIDATION"]) ||
    includesAny(messageUpper, ["INVALID REQUEST", "BAD REQUEST", "VALIDATION"])
  ) {
    return FAILURE_CODES.INVALID_REQUEST;
  }

  if (
    includesAny(code, ["CONTENT_REJECTED", "SAFETY", "POLICY_VIOLATION", "BLOCKED"]) ||
    includesAny(messageUpper, ["CONTENT POLICY", "SAFETY", "CONTENT REJECTED", "BLOCKED"])
  ) {
    return FAILURE_CODES.CONTENT_REJECTED;
  }

  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    includesAny(code, ["PROVIDER_UNAVAILABLE", "SERVICE_UNAVAILABLE", "BAD_GATEWAY"]) ||
    includesAny(messageUpper, ["UNAVAILABLE", "BAD GATEWAY", "GATEWAY TIMEOUT"])
  ) {
    return FAILURE_CODES.PROVIDER_UNAVAILABLE;
  }

  if (
    includesAny(code, ["ECONNRESET", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "NETWORK"]) ||
    includesAny(messageUpper, ["NETWORK", "FETCH FAILED", "CONNECTION RESET", "DNS"])
  ) {
    return FAILURE_CODES.NETWORK_ERROR;
  }

  return FAILURE_CODES.UNKNOWN_PROVIDER_ERROR;
}

function classifyRetryability(inputError) {
  const failureCode =
    inputError?.failureCode && Object.values(FAILURE_CODES).includes(inputError.failureCode)
      ? inputError.failureCode
      : detectFailureCode(inputError);

  return RETRYABLE_CODES.has(failureCode);
}

function normalizeProviderError(error, options = {}) {
  const failureCode = detectFailureCode(error);
  const failureMessage = pickErrorMessage(error);
  const providerRequestId = String(
    error?.providerRequestId ||
      error?.requestId ||
      error?.response?.headers?.["x-request-id"] ||
      ""
  ).trim() || null;

  const provider = String(options.provider || error?.provider || "unknown").trim() || "unknown";
  const model = String(options.model || error?.model || "").trim() || null;
  const retryable = classifyRetryability({ failureCode });

  return {
    providerRequestId,
    provider,
    model,
    result: null,
    durationMs: Number(options.durationMs || 0),
    retryable,
    failureCode,
    failureMessage
  };
}

module.exports = {
  normalizeProviderError,
  classifyRetryability
};
