// ESM port of `js/services/ai/wallpaper-provider-adapter.js`. Logic
// unchanged.

// deno-lint-ignore no-explicit-any
export interface WallpaperProviderAdapterLogger {
  // deno-lint-ignore no-explicit-any
  info(entry: any): void;
  // deno-lint-ignore no-explicit-any
  warn?(entry: any): void;
  // deno-lint-ignore no-explicit-any
  error(entry: any): void;
}

export function createWallpaperProviderAdapter({
  providerAdapter,
  storageUploader,
  logger
}: {
  providerAdapter: {
    // deno-lint-ignore no-explicit-any
    generateImage(input: any): Promise<any>;
  };
  storageUploader: {
    // deno-lint-ignore no-explicit-any
    uploadWallpaperImage(input: any): Promise<any>;
  };
  logger?: WallpaperProviderAdapterLogger;
}) {
  if (!providerAdapter || typeof providerAdapter.generateImage !== "function") {
    throw new Error("createWallpaperProviderAdapter requires providerAdapter.generateImage(input).");
  }

  if (!storageUploader || typeof storageUploader.uploadWallpaperImage !== "function") {
    throw new Error("createWallpaperProviderAdapter requires storageUploader.uploadWallpaperImage(input).");
  }

  const safeLogger: WallpaperProviderAdapterLogger = logger || { info: () => {}, warn: () => {}, error: () => {} };

  // deno-lint-ignore no-explicit-any
  async function generateWallpaper(promptContext: any) {
    const correlationId = String(promptContext?.correlationId || "").trim();
    const userId = String(promptContext?.variables?.userId || "").trim();
    const renderedPrompt = String(promptContext?.promptText || "");

    const started = Date.now();

    const providerResponse = await providerAdapter.generateImage({
      renderedPrompt,
      correlationId,
      metadata: {
        promptType: promptContext?.promptType || null,
        promptVersion: promptContext?.promptVersion || null
      }
    });

    if (!providerResponse || !providerResponse.image || !providerResponse.image.base64) {
      // deno-lint-ignore no-explicit-any
      const error: any = new Error("Provider did not return image data.");
      error.code = "PROVIDER_INVALID_RESPONSE";
      error.retryable = false;
      throw error;
    }

    // deno-lint-ignore no-explicit-any
    let uploaded: any;
    try {
      uploaded = await storageUploader.uploadWallpaperImage({
        userId,
        base64: providerResponse.image.base64,
        mimeType: providerResponse.image.mimeType,
        correlationId
      });
    } catch (uploadError) {
      safeLogger.error({
        event: "wallpaper_provider_adapter_storage_upload_failed",
        correlationId,
        payload: {
          failureCode: (uploadError as { failureCode?: string })?.failureCode || "STORAGE_UPLOAD_FAILED"
        }
      });

      // deno-lint-ignore no-explicit-any
      const err = uploadError as any;
      if (!err.failureCode) {
        err.failureCode = "STORAGE_UPLOAD_FAILED";
        err.retryable = true;
      }
      throw err;
    }

    safeLogger.info({
      event: "wallpaper_provider_adapter_succeeded",
      correlationId,
      payload: {
        provider: providerResponse.provider,
        model: providerResponse.model,
        storageBucket: uploaded.bucket,
        durationMs: Date.now() - started
      }
    });

    return {
      providerRequestId: providerResponse.providerRequestId || null,
      provider: providerResponse.provider,
      model: providerResponse.model,
      imageUrl: uploaded.signedUrl,
      storageBucket: uploaded.bucket,
      storagePath: uploaded.path,
      mimeType: uploaded.mimeType,
      fileSize: uploaded.fileSize,
      durationMs: Number(providerResponse.durationMs || (Date.now() - started)),
      retryable: false,
      failureCode: null,
      failureMessage: null
    };
  }

  // deno-lint-ignore no-explicit-any
  function normalizeProviderError(error: any) {
    const failureCode = String(error?.code || error?.failureCode || "PROVIDER_UNKNOWN");

    return {
      providerRequestId: null,
      provider: "gemini",
      // `error.model` is attached by GeminiProvider (see gemini-provider.ts's
      // catch block) as safe, non-secret metadata. Falls back to null only
      // if the error originated somewhere that never had a model in scope.
      model: error?.model || null,
      imageUrl: null,
      durationMs: 0,
      retryable: Boolean(error?.retryable),
      failureCode,
      failureMessage: String(error?.message || "Provider call failed.")
    };
  }

  return {
    generateWallpaper,
    normalizeProviderError
  };
}
