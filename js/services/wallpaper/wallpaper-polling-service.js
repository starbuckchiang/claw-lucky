(function () {
  "use strict";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toNormalizedError(error, fallbackCode = "POLLING_FAILURE", fallbackMessage = "Polling failed.") {
  return {
    ok: false,
    error: {
      code: String(error?.code || fallbackCode),
      message: String(error?.message || fallbackMessage),
      retryable: Boolean(error?.retryable),
      details: error?.details || null
    }
  };
}

function mapTerminalFailure(data) {
  if (!data || data.status !== "failed") {
    return null;
  }

  return toNormalizedError(
    {
      code: String(data.failureCode || "GENERATION_FAILED"),
      message: String(data.failureMessage || "Generation failed."),
      retryable: false,
      details: {
        generationId: data.generationId || null
      }
    },
    "GENERATION_FAILED",
    "Generation failed."
  );
}

function createWallpaperPollingService({
  getGenerationProgress,
  wait = sleep,
  maxPollAttempts = 120
}) {
  if (typeof getGenerationProgress !== "function") {
    throw new Error("createWallpaperPollingService requires getGenerationProgress(generationId).");
  }

  if (typeof wait !== "function") {
    throw new Error("createWallpaperPollingService requires wait(ms).");
  }

  async function pollUntilTerminal({
    generationId,
    onProgress
  }) {
    const normalizedGenerationId = String(generationId || "").trim();
    if (!normalizedGenerationId) {
      return toNormalizedError({
        code: "INVALID_GENERATION_ID",
        message: "Generation id is invalid."
      });
    }

    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      let response;
      try {
        response = await getGenerationProgress(normalizedGenerationId);
      } catch (error) {
        return toNormalizedError({
          code: "POLLING_FAILURE",
          message: "Polling request failed.",
          retryable: true,
          details: { reason: error?.message || "unknown" }
        });
      }

      if (!response?.ok) {
        return toNormalizedError(response?.error || {
          code: "POLLING_FAILURE",
          message: "Polling request failed."
        });
      }

      const data = response.data || {};
      if (typeof onProgress === "function") {
        await onProgress(data);
      }

      if (data.terminal === true) {
        const failed = mapTerminalFailure(data);
        if (failed) {
          return failed;
        }

        return {
          ok: true,
          data
        };
      }

      const interval = Number(data.recommendedPollIntervalMs);
      if (!Number.isFinite(interval) || interval <= 0) {
        return toNormalizedError({
          code: "INVALID_STATUS_RESPONSE",
          message: "Non-terminal response must include positive recommendedPollIntervalMs."
        });
      }

      await wait(interval);
    }

    return toNormalizedError({
      code: "POLLING_FAILURE",
      message: "Polling exceeded maximum attempts.",
      retryable: true
    });
  }

  return {
    pollUntilTerminal
  };
}

const wallpaperPollingServiceApi = {
  createWallpaperPollingService
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = wallpaperPollingServiceApi;
}

if (typeof window !== "undefined") {
  window.WallpaperPollingService = wallpaperPollingServiceApi;
}
})();
