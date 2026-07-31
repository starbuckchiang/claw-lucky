"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createGenerationService } = require("../generation-service");
const { createPromptContextResolver } = require("../../prompt/prompt-context-resolver");

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

// Default resolved context is already-complete (mascot/gift found), so
// these Generation Service tests exercise everything AFTER the Prompt
// Context Resolver/Validator/Builder stage without needing real
// mascot/gift repositories. See prompt-context-resolver.test.js /
// prompt-validator.test.js / wallpaper-prompt-builder.test.js for
// dedicated coverage of that stage itself.
function createPromptContextResolverMock() {
  return {
    async resolve() {
      return {
        mascot: { id: "mascot-1", species: "Penguin", title: "Lucky Penguin", appearance: "A small round penguin with a red scarf.", colors: null },
        gift: { id: "gift-1", name: "Lucky Charm", description: "A small guardian charm." },
        wallpaperStyle: "Retro",
        luckyTheme: "Golden Day",
        blessing: "Fortune follows you.",
        date: "2026.07.21",
        contextVersion: "wallpaper-prompt-context-v1"
      };
    }
  };
}

// P2-AI-03: Generation Service now queries mascot/gift ONCE itself (shared
// with the Shopkeeper Context Agent and the Prompt Context Resolver), so
// these tests need their own mascot/gift repository + Shopkeeper Context
// Agent mocks. Defaults return an already-found mascot/gift and an
// AI-sourced Shopkeeper context, so tests that don't care about this stage
// can just use the defaults.
function createMascotRepositoryMock(mascot = { id: "mascot-1", species: "Penguin", title: "Lucky Penguin", appearance: "A small round penguin with a red scarf.", colors: null }) {
  return {
    async findMascotById() {
      return mascot;
    }
  };
}

function createGiftRepositoryMock(gift = { id: "gift-1", name: "Lucky Charm", description: "A small guardian charm." }) {
  return {
    async findGiftById() {
      return gift;
    }
  };
}

function createShopkeeperContextAgentMock(context = {
  luckyTheme: "Golden Day",
  blessing: "Fortune follows you.",
  story: "A tiny lucky story.",
  oneLiner: "Shine on.",
  shopkeeperMessage: "Hi there!",
  version: "shopkeeper-mock-v1",
  source: "ai"
}) {
  return {
    async generate() {
      return context;
    }
  };
}

test("Happy Path", async () => {
  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    promptContextResolver: createPromptContextResolverMock(),
    mascotRepository: createMascotRepositoryMock(),
    giftRepository: createGiftRepositoryMock(),
    shopkeeperContextAgent: createShopkeeperContextAgentMock(),
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
  // P2-AI-04 Lite: success DTO carries the 5 safe Shopkeeper display fields,
  // sourced from the SAME shopkeeperContext used to build the prompt.
  assert.equal(result.data.luckyTheme, "Golden Day");
  assert.equal(result.data.blessing, "Fortune follows you.");
  assert.equal(result.data.story, "A tiny lucky story.");
  assert.equal(result.data.oneLiner, "Shine on.");
  assert.equal(result.data.shopkeeperMessage, "Hi there!");
});

test("P2-AI-04 Lite: request without luckyTheme/blessing still generates successfully, using the Shopkeeper Agent's own values", async () => {
  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    promptContextResolver: createPromptContextResolverMock(),
    mascotRepository: createMascotRepositoryMock(),
    giftRepository: createGiftRepositoryMock(),
    shopkeeperContextAgent: createShopkeeperContextAgentMock(),
    providerAdapter: createProviderAdapterMock(),
    generationRepository: createRepositoryMock()
  });

  const request = baseRequest();
  delete request.luckyTheme;
  delete request.blessing;

  const result = await service.createWallpaperGeneration(request);

  assert.equal(result.ok, true);
  assert.equal(result.data.luckyTheme, "Golden Day");
  assert.equal(result.data.blessing, "Fortune follows you.");
});

test("Provider Timeout", async () => {
  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    promptContextResolver: createPromptContextResolverMock(),
    mascotRepository: createMascotRepositoryMock(),
    giftRepository: createGiftRepositoryMock(),
    shopkeeperContextAgent: createShopkeeperContextAgentMock(),
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
    promptContextResolver: createPromptContextResolverMock(),
    mascotRepository: createMascotRepositoryMock(),
    giftRepository: createGiftRepositoryMock(),
    shopkeeperContextAgent: createShopkeeperContextAgentMock(),
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
    promptContextResolver: createPromptContextResolverMock(),
    mascotRepository: createMascotRepositoryMock(),
    giftRepository: createGiftRepositoryMock(),
    shopkeeperContextAgent: createShopkeeperContextAgentMock(),
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
    promptContextResolver: createPromptContextResolverMock(),
    mascotRepository: createMascotRepositoryMock(),
    giftRepository: createGiftRepositoryMock(),
    shopkeeperContextAgent: createShopkeeperContextAgentMock(),
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
    promptContextResolver: createPromptContextResolverMock(),
    mascotRepository: createMascotRepositoryMock(),
    giftRepository: createGiftRepositoryMock(),
    shopkeeperContextAgent: createShopkeeperContextAgentMock(),
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
    promptContextResolver: createPromptContextResolverMock(),
    mascotRepository: createMascotRepositoryMock(),
    giftRepository: createGiftRepositoryMock(),
    shopkeeperContextAgent: createShopkeeperContextAgentMock(),
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

test("P2-AI-02: mascot not found -> PROMPT_VALIDATION_FAILED (never generates an incomplete prompt)", async () => {
  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    // P2-AI-03: use the REAL (pass-through) resolver here, since the mock
    // resolver ignores its input and would mask the "not found" case.
    promptContextResolver: createPromptContextResolver(),
    // P2-AI-03: the mascot is now queried by Generation Service itself (not
    // the Resolver), so "not found" is simulated at the repository mock.
    mascotRepository: createMascotRepositoryMock(null),
    giftRepository: createGiftRepositoryMock(),
    shopkeeperContextAgent: createShopkeeperContextAgentMock(),
    providerAdapter: createProviderAdapterMock(),
    generationRepository: createRepositoryMock()
  });

  const result = await service.createWallpaperGeneration(baseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PROMPT_VALIDATION_FAILED");
  assert.ok(result.error.details.errors.some((message) => message.includes("mascot")));
});

test("P2-AI-02: provider receives the mascot's actual species in the rendered prompt, never just an opaque mascotId", async () => {
  let capturedPromptText = null;
  const providerAdapter = {
    async generateWallpaper(input) {
      capturedPromptText = input.promptText;
      return {
        providerRequestId: "req-001",
        provider: "mock-provider",
        model: "mock-model",
        imageUrl: "https://mock.example/image.png",
        durationMs: 1200,
        retryable: false,
        failureCode: null,
        failureMessage: null
      };
    }
  };

  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    promptContextResolver: createPromptContextResolverMock(),
    mascotRepository: createMascotRepositoryMock(),
    giftRepository: createGiftRepositoryMock(),
    shopkeeperContextAgent: createShopkeeperContextAgentMock(),
    providerAdapter,
    generationRepository: createRepositoryMock()
  });

  const result = await service.createWallpaperGeneration(baseRequest());

  assert.equal(result.ok, true);
  assert.ok(capturedPromptText.includes("Penguin"));
  assert.equal(capturedPromptText.includes("mascot-1"), false);
});

// Required Test #7 (P2-AI-03 working prompt "Tests" list / Gate Review
// gap): "Snapshot Persist" — the payload passed into
// `generationRepository.createGenerationRecord()` must include
// `shopkeeperSnapshot`/`shopkeeperVersion`/`source`, sourced directly from
// the Shopkeeper Context Agent's output (not the raw request).
test("P2-AI-03: Snapshot Persist -> createGenerationRecord payload includes shopkeeperSnapshot/shopkeeperVersion/source", async () => {
  let capturedPayload = null;
  const generationRepository = {
    async createGenerationRecord(payload) {
      capturedPayload = payload;
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

  const shopkeeperContext = {
    luckyTheme: "Golden Day",
    blessing: "Fortune follows you.",
    story: "A tiny lucky story.",
    oneLiner: "Shine on.",
    shopkeeperMessage: "Hi there!",
    version: "shopkeeper-context-v1",
    source: "ai"
  };

  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    promptContextResolver: createPromptContextResolverMock(),
    mascotRepository: createMascotRepositoryMock(),
    giftRepository: createGiftRepositoryMock(),
    shopkeeperContextAgent: createShopkeeperContextAgentMock(shopkeeperContext),
    providerAdapter: createProviderAdapterMock(),
    generationRepository
  });

  const result = await service.createWallpaperGeneration(baseRequest());

  assert.equal(result.ok, true);
  assert.ok(capturedPayload, "createGenerationRecord must have been called");
  assert.equal(capturedPayload.shopkeeperVersion, "shopkeeper-context-v1");
  assert.deepEqual(capturedPayload.shopkeeperSnapshot, shopkeeperContext);
  assert.equal(capturedPayload.source, "ai");
  // The persisted lucky_theme/blessing must be the Shopkeeper's
  // authoritative values, not the raw request's.
  assert.equal(capturedPayload.luckyTheme, "Golden Day");
  assert.equal(capturedPayload.blessing, "Fortune follows you.");
});

test("P2-AI-03: Snapshot Persist -> Fallback source is persisted too (source distinguishes ai vs fallback)", async () => {
  let capturedPayload = null;
  const generationRepository = {
    async createGenerationRecord(payload) {
      capturedPayload = payload;
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

  const fallbackContext = {
    luckyTheme: "穩穩接住今天的好運",
    blessing: "今天每一次努力都會更靠近成功。",
    story: "今天的你，會被幸運悄悄眷顧，一路平穩前行。",
    oneLiner: "穩穩接住，今天的好運。",
    shopkeeperMessage: "嗨，今天我也為你準備了一份小小的幸運～",
    version: "shopkeeper-fallback-v1",
    source: "fallback"
  };

  const service = createGenerationService({
    promptRegistryLoader: createPromptLoaderMock(),
    promptContextResolver: createPromptContextResolverMock(),
    mascotRepository: createMascotRepositoryMock(),
    giftRepository: createGiftRepositoryMock(),
    shopkeeperContextAgent: createShopkeeperContextAgentMock(fallbackContext),
    providerAdapter: createProviderAdapterMock(),
    generationRepository
  });

  const result = await service.createWallpaperGeneration(baseRequest());

  assert.equal(result.ok, true);
  assert.equal(capturedPayload.source, "fallback");
  assert.equal(capturedPayload.shopkeeperVersion, "shopkeeper-fallback-v1");
  assert.deepEqual(capturedPayload.shopkeeperSnapshot, fallbackContext);
});


