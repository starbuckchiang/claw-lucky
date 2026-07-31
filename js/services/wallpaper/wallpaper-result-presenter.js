(function () {
  "use strict";

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

function createWallpaperResultPresenter() {
  function presentSuccess({ submitData, statusData }) {
    const imageUrl = String(statusData?.imageUrl || "").trim();
    if (!imageUrl) {
      return createNormalizedError(
        {
          code: "INVALID_STATUS_RESPONSE",
          message: "Terminal success response does not include imageUrl."
        },
        "INVALID_STATUS_RESPONSE",
        "Terminal success response does not include imageUrl."
      );
    }

    return {
      ok: true,
      data: {
        generationId: String(statusData?.generationId || submitData?.generationId || ""),
        imageUrl,
        provider: statusData?.provider ? String(statusData.provider) : null,
        promptVersion: submitData?.promptVersion ? String(submitData.promptVersion) : null,
        model: statusData?.model ? String(statusData.model) : null,
        status: String(statusData?.status || "succeeded"),
        createdAt: statusData?.createdAt ? String(statusData.createdAt) : null,
        updatedAt: statusData?.updatedAt ? String(statusData.updatedAt) : null,
        // Safe Shopkeeper display fields (P2-AI-04 Lite): prefer the latest
        // polling response, fall back to the submit response, so the values
        // survive regardless of which layer last carried them.
        luckyTheme: (statusData?.luckyTheme || submitData?.luckyTheme) ? String(statusData?.luckyTheme || submitData?.luckyTheme) : null,
        blessing: (statusData?.blessing || submitData?.blessing) ? String(statusData?.blessing || submitData?.blessing) : null,
        story: (statusData?.story || submitData?.story) ? String(statusData?.story || submitData?.story) : null,
        oneLiner: (statusData?.oneLiner || submitData?.oneLiner) ? String(statusData?.oneLiner || submitData?.oneLiner) : null,
        shopkeeperMessage: (statusData?.shopkeeperMessage || submitData?.shopkeeperMessage) ? String(statusData?.shopkeeperMessage || submitData?.shopkeeperMessage) : null
      }
    };
  }

  function presentError(error) {
    return createNormalizedError(error);
  }

  return {
    presentSuccess,
    presentError
  };
}

const wallpaperResultPresenterApi = {
  createWallpaperResultPresenter
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = wallpaperResultPresenterApi;
}

if (typeof window !== "undefined") {
  window.WallpaperResultPresenter = wallpaperResultPresenterApi;
}
})();
