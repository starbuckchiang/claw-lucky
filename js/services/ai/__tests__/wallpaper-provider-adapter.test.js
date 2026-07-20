"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createWallpaperProviderAdapter } = require("../wallpaper-provider-adapter");
const { wrapLoggerForProvider } = require("../../../../supabase/functions/_shared/wallpaper-generate-handler");

function promptContext(overrides = {}) {
  return {
    promptType: "wallpaper_generation",
    promptVersion: "v1",
    promptText: "draw something",
    correlationId: "corr-1",
    variables: { userId: "user-1" },
    ...overrides
  };
}

test("Provider Success -> uploads image and returns imageUrl (no base64 leaked)", async () => {
  const uploadCalls = [];
  const providerAdapter = {
    async generateImage(input) {
      assert.equal(input.correlationId, "corr-1");
      assert.equal(input.renderedPrompt, "draw something");
      return {
        provider: "gemini",
        model: "gemini-2.5-flash-image",
        durationMs: 1234,
        providerRequestId: "req-1",
        image: { base64: "ZmFrZS1iYXNlNjQ=", mimeType: "image/png" }
      };
    }
  };

  const storageUploader = {
    async uploadWallpaperImage(input) {
      uploadCalls.push(input);
      assert.equal(input.userId, "user-1");
      assert.equal(input.base64, "ZmFrZS1iYXNlNjQ=");
      return {
        bucket: "wallpapers",
        path: "user-1/asset-1/wallpaper.png",
        mimeType: "image/png",
        fileSize: 9,
        signedUrl: "https://signed.example/wallpapers/user-1/asset-1/wallpaper.png"
      };
    }
  };

  const adapter = createWallpaperProviderAdapter({ providerAdapter, storageUploader });
  const result = await adapter.generateWallpaper(promptContext());

  assert.equal(uploadCalls.length, 1);
  assert.equal(result.imageUrl, "https://signed.example/wallpapers/user-1/asset-1/wallpaper.png");
  assert.equal(result.storageBucket, "wallpapers");
  assert.equal(result.storagePath, "user-1/asset-1/wallpaper.png");
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "gemini-2.5-flash-image");
  assert.equal(result.failureCode, null);

  // MUST NOT leak base64 anywhere in the returned contract.
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("ZmFrZS1iYXNlNjQ="), false);
});

test("Storage Upload Failure -> throws normalized STORAGE_UPLOAD_FAILED", async () => {
  const providerAdapter = {
    async generateImage() {
      return {
        provider: "gemini",
        model: "gemini-2.5-flash-image",
        durationMs: 500,
        image: { base64: "abc", mimeType: "image/png" }
      };
    }
  };

  const storageUploader = {
    async uploadWallpaperImage() {
      const error = new Error("bucket unreachable");
      error.failureCode = "STORAGE_UPLOAD_FAILED";
      error.retryable = true;
      throw error;
    }
  };

  const adapter = createWallpaperProviderAdapter({ providerAdapter, storageUploader });

  await assert.rejects(
    () => adapter.generateWallpaper(promptContext()),
    (error) => {
      assert.equal(error.failureCode, "STORAGE_UPLOAD_FAILED");
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("Provider Failure propagates (retry already handled by raw provider adapter)", async () => {
  const providerAdapter = {
    async generateImage() {
      const error = new Error("Provider request timeout");
      error.code = "PROVIDER_TIMEOUT";
      error.retryable = true;
      throw error;
    }
  };

  const storageUploader = {
    async uploadWallpaperImage() {
      throw new Error("should not be called");
    }
  };

  const adapter = createWallpaperProviderAdapter({ providerAdapter, storageUploader });

  await assert.rejects(() => adapter.generateWallpaper(promptContext()));
});

test("normalizeProviderError maps errors without leaking secrets or raw exceptions", () => {
  const adapter = createWallpaperProviderAdapter({
    providerAdapter: { generateImage: async () => ({}) },
    storageUploader: { uploadWallpaperImage: async () => ({}) }
  });

  const error = new Error("Provider rate limited");
  error.code = "PROVIDER_RATE_LIMIT";
  error.retryable = true;

  const normalized = adapter.normalizeProviderError(error);

  assert.equal(normalized.failureCode, "PROVIDER_RATE_LIMIT");
  assert.equal(normalized.retryable, true);
  assert.equal(normalized.imageUrl, null);
  assert.equal(JSON.stringify(normalized).includes("GEMINI_API_KEY"), false);
});

function successfulProviderAdapter() {
  return {
    async generateImage() {
      return {
        provider: "gemini",
        model: "gemini-2.5-flash-image",
        durationMs: 100,
        providerRequestId: "req-1",
        image: { base64: "ZmFrZS1iYXNlNjQ=", mimeType: "image/png" }
      };
    }
  };
}

function successfulStorageUploader() {
  return {
    async uploadWallpaperImage() {
      return {
        bucket: "wallpapers",
        path: "user-1/asset-1/wallpaper.png",
        mimeType: "image/png",
        fileSize: 9,
        signedUrl: "https://signed.example/wallpapers/user-1/asset-1/wallpaper.png"
      };
    }
  };
}

// Case A: a correctly wrapped generationLogger (logInfo/logWarn/logError only)
// passed through wrapLoggerForProvider(), the SAME wrapper used by
// buildOrchestrator() for the Resilience Agent / Gemini / Replicate.
test("Case A: wrapLoggerForProvider(generationLogger) -> success path never throws, logInfo receives wallpaper_provider_adapter_succeeded", async () => {
  const logInfoCalls = [];
  const generationLogger = {
    logInfo(entry) {
      logInfoCalls.push(entry);
    },
    logWarn() {},
    logError() {}
  };

  const adapter = createWallpaperProviderAdapter({
    providerAdapter: successfulProviderAdapter(),
    storageUploader: successfulStorageUploader(),
    logger: wrapLoggerForProvider(generationLogger)
  });

  const result = await adapter.generateWallpaper(promptContext());

  assert.equal(result.imageUrl, "https://signed.example/wallpapers/user-1/asset-1/wallpaper.png");
  assert.ok(logInfoCalls.some((entry) => entry.event === "wallpaper_provider_adapter_succeeded"));
});

// Case B: an incomplete logger (only `error`, no `info`) passed DIRECTLY
// (not wrapped) — the defensive per-method safeLogger must not throw.
test("Case B: incomplete logger (error only, no info) -> success path still completes", async () => {
  const errorCalls = [];
  const partialLogger = {
    error(entry) {
      errorCalls.push(entry);
    }
    // no `info` — must not throw "safeLogger.info is not a function"
  };

  const adapter = createWallpaperProviderAdapter({
    providerAdapter: successfulProviderAdapter(),
    storageUploader: successfulStorageUploader(),
    logger: partialLogger
  });

  const result = await adapter.generateWallpaper(promptContext());

  assert.equal(result.imageUrl, "https://signed.example/wallpapers/user-1/asset-1/wallpaper.png");
  assert.equal(errorCalls.length, 0);
});

// Case C: a logger missing `error` — storage upload failure must still
// surface the ORIGINAL error (failureCode normalized, message/retryable
// preserved), never masked/replaced by a logger TypeError.
test("Case C: logger missing error() -> storage failure still throws the original error unchanged", async () => {
  const infoCalls = [];
  const partialLogger = {
    info(entry) {
      infoCalls.push(entry);
    }
    // no `error` — must not throw "safeLogger.error is not a function"
  };

  const storageUploader = {
    async uploadWallpaperImage() {
      const error = new Error("bucket unreachable");
      throw error;
    }
  };

  const adapter = createWallpaperProviderAdapter({
    providerAdapter: successfulProviderAdapter(),
    storageUploader,
    logger: partialLogger
  });

  await assert.rejects(
    () => adapter.generateWallpaper(promptContext()),
    (error) => {
      assert.equal(error.message, "bucket unreachable");
      assert.equal(error.failureCode, "STORAGE_UPLOAD_FAILED");
      assert.equal(error.retryable, true);
      return true;
    }
  );
  assert.equal(infoCalls.length, 0);
});

