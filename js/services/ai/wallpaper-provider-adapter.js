"use strict";

/**
 * Wallpaper Provider Adapter
 *
 * Bridges the P2-AI-01 raw Provider Adapter (base64 image, `generateImage`)
 * with the contract that `generation-service.js` / ADR-005 requires from a
 * "Provider Adapter": `generateWallpaper(input) -> { imageUrl, provider, model, ... }`.
 *
 * Responsibilities:
 * - Call the injected raw provider adapter (Gemini today, others later) to get
 *   a normalized image result (base64 + mimeType).
 * - Upload the resulting image to Supabase Storage via the injected uploader
 *   (server-controlled path, no client-specified path, no base64 persisted).
 * - Return the `generateWallpaper` contract shape expected by Generation Service.
 * - Provide `normalizeProviderError` so Generation Service can normalize both
 *   provider failures (PROVIDER_TIMEOUT, PROVIDER_RATE_LIMIT, ...) and storage
 *   failures (STORAGE_UPLOAD_FAILED) without ever seeing the raw SDK/Supabase
 *   exception.
 *
 * MUST NOT:
 * - Know about GoogleGenAI / Gemini SDK directly (only via injected providerAdapter)
 * - Persist or log base64 image data
 * - Persist or log the API key
 */

function createWallpaperProviderAdapter({ providerAdapter, storageUploader, logger }) {
  if (!providerAdapter || typeof providerAdapter.generateImage !== "function") {
    throw new Error("createWallpaperProviderAdapter requires providerAdapter.generateImage(input).");
  }

  if (!storageUploader || typeof storageUploader.uploadWallpaperImage !== "function") {
    throw new Error("createWallpaperProviderAdapter requires storageUploader.uploadWallpaperImage(input).");
  }

  const safeLogger = logger || { info: () => {}, warn: () => {}, error: () => {} };

  async function generateWallpaper(promptContext) {
    const correlationId = String(promptContext?.correlationId || "").trim();
    const userId = String(promptContext?.variables?.userId || "").trim();
    const renderedPrompt = String(promptContext?.promptText || "");

    const started = Date.now();

    let providerResponse;
    try {
      providerResponse = await providerAdapter.generateImage({
        renderedPrompt,
        correlationId,
        metadata: {
          promptType: promptContext?.promptType || null,
          promptVersion: promptContext?.promptVersion || null
        }
      });
    } catch (rawError) {
      // TEMPORARY diagnostic (P2-AI-03 PROVIDER_UNKNOWN investigation):
      // logged via console.error directly (NOT the injected logger, which
      // may itself be unwrapped/misconfigured) so this always emits even if
      // the logger interface is the root cause. Never logs API keys,
      // tokens, prompt text, or image data. The original error is rethrown
      // completely unchanged — normalizeProviderError()'s existing behavior
      // is untouched.
      console.error(JSON.stringify({
        level: "error",
        event: "wallpaper_provider_adapter_raw_exception",
        correlationId,
        errorName: rawError?.name || null,
        errorMessage: rawError?.message || null,
        errorStack: rawError?.stack || null
      }));
      throw rawError;
    }

    if (!providerResponse || !providerResponse.image || !providerResponse.image.base64) {
      const error = new Error("Provider did not return image data.");
      error.code = "PROVIDER_INVALID_RESPONSE";
      error.retryable = false;
      throw error;
    }

    let uploaded;
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
          failureCode: uploadError?.failureCode || "STORAGE_UPLOAD_FAILED"
        }
      });

      if (!uploadError.failureCode) {
        uploadError.failureCode = "STORAGE_UPLOAD_FAILED";
        uploadError.retryable = true;
      }
      throw uploadError;
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

  function normalizeProviderError(error) {
    const failureCode = String(error?.code || error?.failureCode || "PROVIDER_UNKNOWN");

    return {
      providerRequestId: null,
      provider: "gemini",
      // `error.model` / `error.httpStatus` / `error.providerStatus` /
      // `error.providerMessage` / `error.providerCode` are attached by
      // GeminiProvider (see gemini-provider.js's catch block) as safe,
      // non-secret metadata on the error object itself. Preserving them here
      // (rather than re-deriving them) is what lets
      // `generation_service_provider_failure` log the real underlying
      // Gemini/HTTP error instead of just the normalized failureCode.
      model: error?.model || null,
      httpStatus: error?.httpStatus ?? null,
      providerStatus: error?.providerStatus ?? null,
      providerMessage: error?.providerMessage ?? null,
      providerCode: error?.providerCode ?? null,
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

module.exports = {
  createWallpaperProviderAdapter
};
