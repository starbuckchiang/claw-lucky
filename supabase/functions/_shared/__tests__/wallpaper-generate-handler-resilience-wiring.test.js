"use strict";

/**
 * Integration test for the logger-interface fix in `buildOrchestrator()`
 * (see supabase/functions/_shared/wallpaper-generate-handler.js).
 *
 * Unlike the other handler tests in this directory (which inject a mock
 * `deps.orchestrator` and never exercise `buildOrchestrator()` itself), this
 * test calls the REAL `buildOrchestrator()` with a fake Supabase client, a
 * failing Gemini provider, and a Replicate fallback provider — reproducing
 * the exact bug reported in production:
 *
 *   `createProviderResilienceAgent({ registry, logger })` was previously
 *   given the raw `generationLogger` (logInfo/logWarn/logError) instead of
 *   `wrapLoggerForProvider(logger)` (info/error). Since the resilience
 *   agent's `generateImage()` calls `safeLogger.info(...)` as its very
 *   first statement (BEFORE the try/catch that evaluates fallback
 *   eligibility), this crashed with a TypeError before Gemini was ever
 *   called and before `isFallbackEligible()` could run — surfacing as a
 *   misleading `generation_service_provider_failure` with
 *   `failureCode: PROVIDER_UNKNOWN` / `provider: gemini` and NO
 *   `generation_fallback_started` event.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildOrchestrator } = require("../wallpaper-generate-handler");
const { createGenerationLogger } = require("../../../../js/services/logging/generation-logger");
const { ReplicateFluxProvider } = require("../../../../js/services/ai/providers/replicate-flux-provider");

function createFakeSupabaseClient() {
  const jobsTable = {
    insert() {
      return {
        select() {
          return {
            async single() {
              return { data: { id: "job-1", status: "queued", created_at: "2026-07-20T00:00:00.000Z" }, error: null };
            }
          };
        }
      };
    },
    update() {
      return { eq: () => Promise.resolve({ error: null }) };
    }
  };

  const usageTable = {
    select() {
      return { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    }
  };

  const usersTable = {
    select() {
      return { eq: () => ({ maybeSingle: async () => ({ data: { user_id: "user-1", points: 100 }, error: null }) }) };
    },
    update() {
      return { eq: () => Promise.resolve({ error: null }) };
    }
  };

  const costConfigTable = {
    select() {
      return { eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
    }
  };

  const promptTable = {
    select() {
      return {
        eq: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  {
                    prompt_type: "wallpaper_generation",
                    version: "v1",
                    template: "A lucky wallpaper for {{luckyTheme}}: {{blessing}}",
                    metadata_json: {},
                    is_active: true,
                    created_at: "2026-07-20T00:00:00.000Z"
                  }
                ],
                error: null
              })
          })
        })
      };
    }
  };

  const TABLES = {
    wallpaper_generation_jobs: jobsTable,
    daily_generation_usage: usageTable,
    users: usersTable,
    generation_cost_config: costConfigTable,
    prompt_versions: promptTable
  };

  return {
    from(tableName) {
      const table = TABLES[tableName];
      if (!table) {
        throw new Error(`Unexpected table in fake supabase client: ${tableName}`);
      }
      return table;
    },
    // createWallpaperStorageUploader() validates this exists at construction
    // time (buildOrchestrator always builds a storage uploader), even though
    // the failure scenarios in this file never actually reach an upload call.
    storage: {
      from() {
        throw new Error("Storage should not be used in these failure-path tests.");
      }
    }
  };
}

function baseRequest(correlationId) {
  return {
    userId: "user-1",
    mascotId: "mascot-1",
    giftId: "gift-1",
    wallpaperStyle: "Retro",
    luckyTheme: "Golden Day",
    blessing: "Fortune follows you.",
    promptType: "wallpaper_generation",
    correlationId
  };
}

test("buildOrchestrator(): resilience agent logger wiring does not throw, and Gemini failure reaches isFallbackEligible()", async () => {
  const capturedEvents = [];
  const generationLogger = createGenerationLogger({
    sink: (entry) => capturedEvents.push(entry)
  });

  const failingGeminiProvider = {
    async generateWallpaper() {
      const error = new Error("Gemini returned an unexpected error shape.");
      error.code = "PROVIDER_UNAVAILABLE"; // fallback-eligible per fallback-policy.js
      error.retryable = false;
      throw error;
    }
  };

  const replicateLoggedEvents = [];
  const replicateLogger = {
    info: (entry) => replicateLoggedEvents.push(entry.event),
    error: (entry) => replicateLoggedEvents.push(entry.event)
  };
  const fallbackProvider = new ReplicateFluxProvider({
    config: { model: "black-forest-labs/flux-2-dev", pollIntervalMs: 1, maxPollAttempts: 1 },
    client: {
      async createPrediction() {
        throw new Error("Replicate is unreachable in this test.");
      },
      async getPrediction() {
        return {};
      }
    },
    logger: replicateLogger
  });

  const orchestrator = buildOrchestrator({
    supabaseClient: createFakeSupabaseClient(),
    geminiProvider: failingGeminiProvider,
    providerConfig: { maxRetry: 0 },
    generationLogger,
    fallbackProvider,
    fallbackProviderConfig: { maxRetry: 0 }
  });

  // Must NOT throw (previously threw TypeError: safeLogger.info is not a function).
  const result = await orchestrator.createWallpaperGenerationWorkflow(baseRequest("corr-wiring-1"));

  assert.equal(result.ok, false);

  const eventNames = capturedEvents.map((entry) => entry.event);

  // Gemini was actually invoked (resilience agent reached the try block).
  assert.ok(eventNames.includes("generation_primary_started"));
  assert.ok(eventNames.includes("generation_primary_failed"));

  // isFallbackEligible() judged PROVIDER_UNAVAILABLE as fallback-eligible,
  // so the fallback attempt was started and logged.
  assert.ok(eventNames.includes("generation_fallback_started"));

  // The Replicate fallback itself failed at prediction creation — its own
  // structured event must surface too (via the provider's own logger).
  assert.ok(replicateLoggedEvents.includes("replicate_prediction_create_failed"));

  // Resilience agent reports the fallback outcome once it's known.
  assert.ok(eventNames.includes("generation_fallback_failed"));
});

test("buildOrchestrator(): non-fallback-eligible Gemini failure never starts a fallback attempt", async () => {
  const capturedEvents = [];
  const generationLogger = createGenerationLogger({
    sink: (entry) => capturedEvents.push(entry)
  });

  const failingGeminiProvider = {
    async generateWallpaper() {
      const error = new Error("Content rejected by safety filter.");
      error.code = "CONTENT_REJECTED"; // NEVER_FALLBACK_CODES
      error.retryable = false;
      throw error;
    }
  };

  const fallbackProvider = new ReplicateFluxProvider({
    config: { model: "black-forest-labs/flux-2-dev", pollIntervalMs: 1, maxPollAttempts: 1 },
    client: {
      async createPrediction() {
        throw new Error("Should never be called for a non-fallback-eligible failure.");
      },
      async getPrediction() {
        return {};
      }
    },
    logger: { info: () => {}, error: () => {} }
  });

  const orchestrator = buildOrchestrator({
    supabaseClient: createFakeSupabaseClient(),
    geminiProvider: failingGeminiProvider,
    providerConfig: { maxRetry: 0 },
    generationLogger,
    fallbackProvider,
    fallbackProviderConfig: { maxRetry: 0 }
  });

  const result = await orchestrator.createWallpaperGenerationWorkflow(baseRequest("corr-wiring-2"));

  assert.equal(result.ok, false);

  const eventNames = capturedEvents.map((entry) => entry.event);
  assert.ok(eventNames.includes("generation_primary_started"));
  assert.ok(eventNames.includes("generation_primary_failed"));
  assert.equal(eventNames.includes("generation_fallback_started"), false);
});
