"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createGenerationService } = require("../generation-service");

function baseRequest() {
  return {
    userId: "user-1",
    mascotId: "mascot-1",
    giftId: "gift-1",
    wallpaperStyle: "Retro",
    luckyTheme: "Golden Day",
    blessing: "Fortune follows you.",
    promptType: "wallpaper_generation"
  };
}

function createPromptLoaderMock({ error = null, prompt = null } = {}) {
  return {
    async loadActivePrompt() {
      if (error) {
        throw error;
      }
      return (
        prompt || {
          promptType: "wallpaper_generation",
          version: "v1",
          template: "Draw {{mascotId}} with {{giftId}} in {{wallpaperStyle}} style",
          metadata: { locale: "zh-TW" },
          source: "database"
        }
      );
    }
  };
}

function createProviderAdapterMock({ error = null, result = null } = {}) {
  return {
    async generateWallpaper() {
      if (error) {
        throw error;
      }
      return (
        result || {
          providerRequestId: "req-001",
          provider: "mock-provider",
          model: "mock-model",
          imageUrl: "https://mock.example/image.png",
          durationMs: 1200,
          retryable: false,
          failureCode: null,
          failureMessage: null
        }
      );
    },
    normalizeProviderError(err) {
      return {
        providerRequestId: "req-error",
        provider: "mock-provider",
        model: "mock-model",
        imageUrl: null,
        durationMs: 900,
        retryable: false,
        failureCode: err?.failureCode || "PROVIDER_FAILURE",
        failureMessage: err?.message || "provider failed"
      };
    }
  };
}

function createRepositoryMock({ error = null } = {}) {
  return {
    async createGenerationRecord(payload) {
      if (error) {
        throw error;
      }

      return {
        generationId: "gen-001",
        provider: payload.provider,
        model: payload.model,
        imageUrl: payload.imageUrl,
        promptVersion: payload.promptVersion,
        durationMs: payload.durationMs,
        status: payload.status,
        createdAt: "2026-07-13T12:00:00.000Z"
      };
    }
  };
}

test("Happy Path", async () => {
  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    providerAdapter: createProviderAdapterMock(),
    generationRepository: createRepositoryMock()
  });

  const result = await service.createWallpaperGeneration(baseRequest());

  assert.equal(result.ok, true);
  assert.equal(result.data.generationId, "gen-001");
  assert.equal(result.data.provider, "mock-provider");
  assert.equal(result.data.model, "mock-model");
  assert.equal(result.data.imageUrl, "https://mock.example/image.png");
  assert.equal(result.data.promptVersion, "v1");
  assert.equal(result.data.durationMs, 1200);
  assert.equal(result.data.status, "succeeded");
});

test("Provider Timeout", async () => {
  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    providerAdapter: createProviderAdapterMock({
      result: {
        providerRequestId: "req-timeout",
        provider: "mock-provider",
        model: "mock-model",
        imageUrl: null,
        durationMs: 30_000,
        retryable: true,
        failureCode: "TIMEOUT",
        failureMessage: "timeout"
      }
    }),
    generationRepository: createRepositoryMock()
  });

  const result = await service.createWallpaperGeneration(baseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PROVIDER_TIMEOUT");
});

test("Provider Failure", async () => {
  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    providerAdapter: createProviderAdapterMock({
      result: {
        providerRequestId: "req-fail",
        provider: "mock-provider",
        model: "mock-model",
        imageUrl: null,
        durationMs: 800,
        retryable: true,
        failureCode: "PROVIDER_UNAVAILABLE",
        failureMessage: "service unavailable"
      }
    }),
    generationRepository: createRepositoryMock()
  });

  const result = await service.createWallpaperGeneration(baseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PROVIDER_FAILURE");
});

test("Prompt Missing", async () => {
  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock({
      error: {
        code: "PROMPT_NOT_FOUND",
        message: "not found"
      }
    }),
    providerAdapter: createProviderAdapterMock(),
    generationRepository: createRepositoryMock()
  });

  const result = await service.createWallpaperGeneration(baseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PROMPT_NOT_FOUND");
});

test("Invalid Response", async () => {
  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    providerAdapter: createProviderAdapterMock({
      result: {
        providerRequestId: "req-invalid",
        provider: "mock-provider",
        model: "mock-model",
        imageUrl: null,
        durationMs: 100,
        retryable: false,
        failureCode: "INVALID_RESPONSE",
        failureMessage: "missing imageUrl"
      }
    }),
    generationRepository: createRepositoryMock()
  });

  const result = await service.createWallpaperGeneration(baseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_RESPONSE");
});

test("Image Generation Failure on persistence", async () => {
  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    providerAdapter: createProviderAdapterMock(),
    generationRepository: createRepositoryMock({
      error: new Error("db write failed")
    })
  });

  const result = await service.createWallpaperGeneration(baseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "IMAGE_GENERATION_FAILURE");
  // Safe diagnostics (reason/code/details/hint/table/operation) must be
  // preserved so the real persistence failure is visible, not swallowed.
  assert.equal(result.error.details.reason, "db write failed");
});

test("Image Generation Failure on persistence preserves table/operation diagnostics from the repository", async () => {
  const dbError = new Error("duplicate key value violates unique constraint");
  dbError.code = "23505";
  dbError.details = "Key (id)=(gen-1) already exists.";
  dbError.hint = null;
  dbError.table = "wallpaper_generations";
  dbError.operation = "insertGeneration";

  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    providerAdapter: createProviderAdapterMock(),
    generationRepository: createRepositoryMock({ error: dbError })
  });

  const result = await service.createWallpaperGeneration(baseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "IMAGE_GENERATION_FAILURE");
  assert.equal(result.error.details.code, "23505");
  assert.equal(result.error.details.table, "wallpaper_generations");
  assert.equal(result.error.details.operation, "insertGeneration");
  assert.equal(result.error.details.hint, null);
});

