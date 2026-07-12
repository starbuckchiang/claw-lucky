"use strict";

const { normalizeProviderError, classifyRetryability } = require("./error-normalizer");

function nowMs() {
  return Date.now();
}

function normalizeSuccess(rawResponse, options) {
  const providerRequestId = String(
    rawResponse?.providerRequestId || rawResponse?.requestId || rawResponse?.id || ""
  ).trim() || null;

  return {
    providerRequestId,
    provider: options.provider,
    model: String(rawResponse?.model || options.model || "").trim() || null,
    result:
      rawResponse?.result !== undefined
        ? rawResponse.result
        : rawResponse?.data !== undefined
          ? rawResponse.data
          : rawResponse,
    durationMs: options.durationMs,
    retryable: false,
    failureCode: null,
    failureMessage: null
  };
}

function validateProviderContract(provider) {
  if (!provider || typeof provider !== "object") {
    throw new Error("Provider adapter requires a provider object.");
  }

  if (typeof provider.generateLuckyContext !== "function") {
    throw new Error("Provider contract violation: generateLuckyContext(input) is required.");
  }

  if (typeof provider.generateWallpaper !== "function") {
    throw new Error("Provider contract violation: generateWallpaper(input) is required.");
  }
}

function createProviderAdapter({ providerName, model, provider }) {
  const normalizedProviderName = String(providerName || "").trim();

  if (!normalizedProviderName) {
    throw new Error("providerName is required.");
  }

  validateProviderContract(provider);

  async function execute(methodName, input) {
    const startedAt = nowMs();

    try {
      const rawResponse = await provider[methodName](input);
      const durationMs = Math.max(0, nowMs() - startedAt);

      return normalizeSuccess(rawResponse, {
        provider: normalizedProviderName,
        model,
        durationMs
      });
    } catch (error) {
      const durationMs = Math.max(0, nowMs() - startedAt);
      const normalizedError = normalizeProviderError(error, {
        provider: normalizedProviderName,
        model,
        durationMs
      });

      return {
        ...normalizedError,
        retryable: classifyRetryability(normalizedError)
      };
    }
  }

  return {
    generateLuckyContext(input) {
      return execute("generateLuckyContext", input);
    },
    generateWallpaper(input) {
      return execute("generateWallpaper", input);
    },
    classifyRetryability,
    normalizeProviderError
  };
}

module.exports = {
  createProviderAdapter
};
