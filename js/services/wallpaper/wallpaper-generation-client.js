(function () {
  "use strict";

const { createWallpaperPollingService } =
  typeof module !== "undefined" && module.exports
    ? require("./wallpaper-polling-service")
    : window.WallpaperPollingService;
const { createWallpaperResultPresenter } =
  typeof module !== "undefined" && module.exports
    ? require("./wallpaper-result-presenter")
    : window.WallpaperResultPresenter;

function createNormalizedError(error, fallbackCode = "GENERATION_FAILED", fallbackMessage = "Generation failed.") {
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

function createWallpaperHttpApiClient({
  postGenerationUrl = "/api/wallpapers/generations",
  getProgressUrl = (generationId) => `/api/wallpapers/generations/${encodeURIComponent(generationId)}/progress`,
  fetchImpl = fetch
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("createWallpaperHttpApiClient requires fetch implementation.");
  }

  async function requestJson(url, options) {
    let response;
    try {
      response = await fetchImpl(url, options);
    } catch (error) {
      return createNormalizedError({
        code: "POLLING_FAILURE",
        message: "API request failed.",
        retryable: true,
        details: { reason: error?.message || "unknown" }
      }, "POLLING_FAILURE", "API request failed.");
    }

    let body = null;
    try {
      body = await response.json();
    } catch (_error) {
      return createNormalizedError({
        code: "INVALID_STATUS_RESPONSE",
        message: "API response is not valid JSON.",
        retryable: false
      }, "INVALID_STATUS_RESPONSE", "API response is not valid JSON.");
    }

    if (!body || typeof body !== "object") {
      return createNormalizedError({
        code: "INVALID_STATUS_RESPONSE",
        message: "API response body is invalid."
      }, "INVALID_STATUS_RESPONSE", "API response body is invalid.");
    }

    if (body.ok === false) {
      return createNormalizedError(body.error || {}, "GENERATION_FAILED", "Generation failed.");
    }

    if (!response.ok && body.ok !== true) {
      return createNormalizedError({
        code: "POLLING_FAILURE",
        message: "API request failed.",
        retryable: response.status >= 500
      }, "POLLING_FAILURE", "API request failed.");
    }

    return body;
  }

  return {
    createGeneration(requestPayload) {
      return requestJson(postGenerationUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify(requestPayload || {})
      });
    },

    getGenerationProgress(generationId) {
      return requestJson(getProgressUrl(generationId), {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include"
      });
    }
  };
}

function createWallpaperGenerationClient({
  generationApi,
  pollingService,
  resultPresenter
}) {
  if (!generationApi || typeof generationApi.createGeneration !== "function" || typeof generationApi.getGenerationProgress !== "function") {
    throw new Error("createWallpaperGenerationClient requires generationApi.createGeneration/getGenerationProgress.");
  }

  const internalPollingService = pollingService || createWallpaperPollingService({
    getGenerationProgress: generationApi.getGenerationProgress
  });
  const internalResultPresenter = resultPresenter || createWallpaperResultPresenter();

  async function submitAndPoll(request, { onProgress } = {}) {
    let submitResult;
    try {
      submitResult = await generationApi.createGeneration(request);
    } catch (error) {
      return internalResultPresenter.presentError({
        code: "GENERATION_FAILED",
        message: "Submit generation request failed.",
        retryable: true,
        details: { reason: error?.message || "unknown" }
      });
    }

    if (!submitResult?.ok) {
      return internalResultPresenter.presentError(submitResult?.error || {
        code: "GENERATION_FAILED",
        message: "Submit generation request failed."
      });
    }

    const generationId = String(submitResult?.data?.generationId || "").trim();
    if (!generationId) {
      return internalResultPresenter.presentError({
        code: "INVALID_STATUS_RESPONSE",
        message: "Generation response does not include generationId."
      });
    }

    const pollingResult = await internalPollingService.pollUntilTerminal({
      generationId,
      onProgress
    });

    if (!pollingResult?.ok) {
      return internalResultPresenter.presentError(pollingResult?.error || {
        code: "POLLING_FAILURE",
        message: "Polling failed."
      });
    }

    return internalResultPresenter.presentSuccess({
      submitData: submitResult.data,
      statusData: pollingResult.data
    });
  }

  return {
    submitAndPoll
  };
}

const wallpaperGenerationClientApi = {
  createWallpaperGenerationClient,
  createWallpaperHttpApiClient
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = wallpaperGenerationClientApi;
}

if (typeof window !== "undefined") {
  window.WallpaperGenerationClient = wallpaperGenerationClientApi;
}
})();
