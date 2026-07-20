"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createGenerationOrchestrator } = require("../generation-orchestrator");
const { createGenerationService } = require("../generation-service");
const { createGenerationLogger } = require("../../logging/generation-logger");
const { createWallpaperProviderAdapter } = require("../../ai/wallpaper-provider-adapter");
const { createProviderResilienceAgent } = require("../../ai/agents/provider-resilience-agent");
const { NormalizedProviderError } = require("../../ai/provider-types");

function baseRequest() {
  return {
    userId: "user-1",
    mascotId: "mascot-1",
    giftId: "gift-1",
    wallpaperStyle: "Retro",
    luckyTheme: "Golden Day",
    blessing: "Fortune follows you.",
    promptType: "wallpaper_generation",
    correlationId: "corr-int-1"
  };
}

// Plain info/error logger used by the resilience agent / ProviderAdapter
// (matches the shape used elsewhere in this codebase, e.g. gemini-provider.js).
function silentProviderLogger() {
  return { info: () => {}, error: () => {}, warn: () => {} };
}

// Real generationLogger (logInfo/logWarn/logError) required by
// generation-service.js / generation-orchestrator.js, silenced via a no-op sink.
function silentGenerationLogger() {
  return createGenerationLogger({ sink: () => {} });
}

function createMockJobService() {
  const calls = { createJob: 0, markRunning: 0, markSuccess: 0, markFailed: 0 };
  return {
    calls,
    JOB_STATUS: { PENDING: "Pending", RUNNING: "Running", SUCCESS: "Success", FAILED: "Failed" },
    async createJob() {
      calls.createJob += 1;
      return { ok: true, data: { jobId: "job-1", id: "job-1" } };
    },
    async markRunning() {
      calls.markRunning += 1;
      return { ok: true };
    },
    async markSuccess() {
      calls.markSuccess += 1;
      return { ok: true };
    },
    async markFailed() {
      calls.markFailed += 1;
      return { ok: true };
    }
  };
}

function createMockUsageService() {
  return {
    async checkDailyLimit() {
      return { ok: true, data: { usageDate: "2026-07-19", successCount: 0, dailyLimit: 3 } };
    },
    async recordSuccess() {
      return { ok: true, data: { usageDate: "2026-07-19", successCount: 1 } };
    }
  };
}

function createMockPointsService() {
  return {
    async validateUser() {
      return { ok: true, data: { userId: "user-1" } };
    },
    async getGenerationCost() {
      return { ok: true, data: { costPoints: 10 } };
    },
    async deductOnSuccess() {
      return { ok: true, data: { deductedPoints: 10 } };
    }
  };
}

function createMockPromptLoader() {
  return {
    async loadActivePrompt() {
      return {
        promptType: "wallpaper_generation",
        version: "v1",
        template: "Draw {{mascotId}} with {{giftId}}",
        metadata: {},
        source: "database"
      };
    }
  };
}

function createMockGenerationRepository() {
  return {
    async createGenerationRecord(payload) {
      return {
        generationId: "gen-1",
        provider: payload.provider,
        model: payload.model,
        imageUrl: payload.imageUrl,
        promptVersion: payload.promptVersion,
        durationMs: payload.durationMs,
        status: payload.status,
        createdAt: "2026-07-19T00:00:00.000Z"
      };
    }
  };
}

function createMockStorageUploader() {
  return {
    async uploadWallpaperImage() {
      return {
        bucket: "wallpapers",
        path: "user-1/asset-1/wallpaper.png",
        mimeType: "image/png",
        fileSize: 10,
        signedUrl: "https://signed.example/wallpapers/user-1/asset-1/wallpaper.png"
      };
    }
  };
}

function buildOrchestratorWithResilienceAgent(registry) {
  const providerLogger = silentProviderLogger();
  const generationLogger = silentGenerationLogger();
  const resilienceAgent = createProviderResilienceAgent({ registry, logger: providerLogger });
  const providerAdapter = createWallpaperProviderAdapter({
    providerAdapter: resilienceAgent,
    storageUploader: createMockStorageUploader(),
    logger: providerLogger
  });

  const jobService = createMockJobService();
  const generationService = createGenerationService({
    promptRegistryLoader: createMockPromptLoader(),
    providerAdapter,
    generationRepository: createMockGenerationRepository(),
    generationLogger
  });

  const orchestrator = createGenerationOrchestrator({
    generationService,
    usageService: createMockUsageService(),
    jobService,
    pointsService: createMockPointsService(),
    generationLogger
  });

  return { orchestrator, jobService };
}

test("fallback success -> Job marked complete exactly once (no duplicate completion)", async () => {
  const registry = {
    primary: {
      name: "gemini",
      adapter: { generateImage: async () => { throw new NormalizedProviderError("PROVIDER_TIMEOUT", "timed out", true, 408); } }
    },
    fallback: {
      name: "replicate-flux",
      adapter: { generateImage: async () => ({ provider: "replicate", model: "flux", image: { base64: "abc", mimeType: "image/png" }, durationMs: 500 }) }
    }
  };

  const { orchestrator, jobService } = buildOrchestratorWithResilienceAgent(registry);

  const result = await orchestrator.createWallpaperGenerationWorkflow(baseRequest());

  assert.equal(result.ok, true);
  assert.equal(jobService.calls.createJob, 1);
  assert.equal(jobService.calls.markRunning, 1);
  assert.equal(jobService.calls.markSuccess, 1);
  assert.equal(jobService.calls.markFailed, 0);
});

test("both providers failing -> Job marked failed exactly once (no duplicate completion)", async () => {
  const registry = {
    primary: {
      name: "gemini",
      adapter: { generateImage: async () => { throw new NormalizedProviderError("PROVIDER_UNAVAILABLE", "primary down", true, 503); } }
    },
    fallback: {
      name: "replicate-flux",
      adapter: { generateImage: async () => { throw new NormalizedProviderError("PROVIDER_TIMEOUT", "fallback timed out", true, 408); } }
    }
  };

  const { orchestrator, jobService } = buildOrchestratorWithResilienceAgent(registry);

  const result = await orchestrator.createWallpaperGenerationWorkflow(baseRequest());

  assert.equal(result.ok, false);
  assert.equal(jobService.calls.createJob, 1);
  assert.equal(jobService.calls.markRunning, 1);
  assert.equal(jobService.calls.markSuccess, 0);
  assert.equal(jobService.calls.markFailed, 1);
});
