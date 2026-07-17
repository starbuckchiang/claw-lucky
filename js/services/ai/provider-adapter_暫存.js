"use strict";

const { normalizeProviderError, classifyRetryability } = require("./error-normalizer");

function nowMs() {
  return Date.now();
}

function resolveImageUrl(rawResponse) {
  const direct = String(rawResponse?.imageUrl || "").trim();
  if (direct) {
    return direct;
  }

  const resultImage = String(rawResponse?.result?.imageUrl || "").trim();
  if (resultImage) {
    return resultImage;
  }

  const dataImage = String(rawResponse?.data?.imageUrl || "").trim();
  if (dataImage) {
    return dataImage;
  }

  return null;
}

function normalizeSuccess(rawResponse, options) {
  const providerRequestId = String(
    rawResponse?.providerRequestId || rawResponse?.requestId || rawResponse?.id || ""
  ).trim() || null;
  const imageUrl = resolveImageUrl(rawResponse);

  if (!imageUrl) {
    return {
      providerRequestId,
      provider: options.provider,
      model: String(rawResponse?.model || options.model || "").trim() || null,
      imageUrl: null,
      result: null,
      durationMs: options.durationMs,
      retryable: false,
      failureCode: "INVALID_RESPONSE",
      failureMessage: "Provider response does not include a valid imageUrl."
    };
  }

  return {
    providerRequestId,
    provider: options.provider,
    model: String(rawResponse?.model || options.model || "").trim() || null,
    imageUrl,
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
