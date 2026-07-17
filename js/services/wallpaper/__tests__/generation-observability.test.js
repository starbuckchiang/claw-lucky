"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createCorrelationId } = require("../../logging/correlation-id");
const { createGenerationLogger } = require("../../logging/generation-logger");
const { createGenerationTracing } = require("../../logging/generation-tracing");
const { createGenerationOrchestrator } = require("../generation-orchestrator");

function createBaseRequest() {
  return {
    userId: "user-1",
    mascotId: "mascot-1",
    giftId: "gift-1",
    wallpaperStyle: "Retro",
    luckyTheme: "Lucky Gold",
    blessing: "Today is your day",
    promptType: "wallpaper_generation"
  };
}

test("correlationId 建立", () => {
  const id = createCorrelationId("gen");
  assert.equal(typeof id, "string");
  assert.equal(id.startsWith("gen_"), true);
  assert.equal(id.length > 10, true);
});

test("logger 包含 correlationId 且遮罩敏感資料", () => {
  const entries = [];
  const logger = createGenerationLogger({
    sink(entry) {
      entries.push(entry);
    },
    now() {
      return "2026-07-15T12:00:00.000Z";
    }
  });

  const entry = logger.logInfo({
    event: "generation_test",
    correlationId: "gen_corr_001",
    payload: {
      promptText: "do not expose",
      userId: "user-1",
      provider: "mock-provider"
    }
  });

  assert.equal(entry.correlationId, "gen_corr_001");
  assert.equal(entries[0].payload.promptText, "[REDACTED]");
  assert.equal(entries[0].payload.userId, "[REDACTED]");
  assert.equal(entries[0].payload.provider, "mock-provider");
});

test("correlationId 全流程傳遞", async () => {
  const logs = [];
  const logger = createGenerationLogger({
    sink(entry) {
      logs.push(entry);
    }
  });
  const tracing = createGenerationTracing({
    createId() {
      return "gen_corr_full_flow";
    },
    now() {
      return "2026-07-15T12:00:00.000Z";
    }
  });

  let capturedCorrelationId = null;
  const orchestrator = createGenerationOrchestrator({
    generationService: {
      async createWallpaperGeneration(request) {
        capturedCorrelationId = request.correlationId;
        return {
          ok: true,
          data: {
            generationId: "gen-001",
            status: "succeeded",
            provider: "mock-provider",
            model: "mock-model",
            promptVersion: "v1",
            durationMs: 1200,
            createdAt: "2026-07-15T12:00:01.000Z"
          }
        };
      }
    },
    usageService: {
      async checkDailyLimit() {
        return { ok: true, data: { usageDate: "2026-07-15", successCount: 0, dailyLimit: 3 } };
      },
      async recordSuccess() {
        return { ok: true, data: { usageDate: "2026-07-15", successCount: 1 } };
      }
    },
    jobService: {
      JOB_STATUS: { PENDING: "Pending", RUNNING: "Running", SUCCESS: "Success", FAILED: "Failed" },
      async createJob() {
        return { ok: true, data: { id: "job-001" } };
      },
      async markRunning() {
        return { ok: true };
      },
      async markSuccess() {
        return { ok: true };
      },
      async markFailed() {
        return { ok: true };
      }
    },
    pointsService: {
      async validateUser() {
        return { ok: true, data: { userId: "user-1" } };
      },
      async getGenerationCost() {
        return { ok: true, data: { costPoints: 10 } };
      },
      async deductOnSuccess() {
        return { ok: true, data: { deductedPoints: 10 } };
      }
    },
    generationTracing: tracing,
    generationLogger: logger
  });

  const result = await orchestrator.createWallpaperGenerationWorkflow(createBaseRequest());

  assert.equal(result.ok, true);
  assert.equal(capturedCorrelationId, "gen_corr_full_flow");
  assert.equal(logs.every((entry) => entry.correlationId === "gen_corr_full_flow"), true);
});

test("provider failure 可追蹤", async () => {
  const logs = [];
  const logger = createGenerationLogger({
    sink(entry) {
      logs.push(entry);
    }
  });
  const tracing = createGenerationTracing({
    createId() {
      return "gen_corr_failure";
    },
    now() {
      return "2026-07-15T12:00:00.000Z";
    }
  });

  const orchestrator = createGenerationOrchestrator({
    generationService: {
      async createWallpaperGeneration() {
        return {
          ok: false,
          error: {
            code: "PROVIDER_FAILURE",
            message: "provider down",
            retryable: true
          }
        };
      }
    },
    usageService: {
      async checkDailyLimit() {
        return { ok: true, data: { usageDate: "2026-07-15", successCount: 0, dailyLimit: 3 } };
      },
      async recordSuccess() {
        return { ok: true, data: { usageDate: "2026-07-15", successCount: 1 } };
      }
    },
    jobService: {
      JOB_STATUS: { PENDING: "Pending", RUNNING: "Running", SUCCESS: "Success", FAILED: "Failed" },
      async createJob() {
        return { ok: true, data: { id: "job-001" } };
      },
      async markRunning() {
        return { ok: true };
      },
      async markSuccess() {
        return { ok: true };
      },
      async markFailed() {
        return { ok: true };
      }
    },
    pointsService: {
      async validateUser() {
        return { ok: true, data: { userId: "user-1" } };
      },
      async getGenerationCost() {
        return { ok: true, data: { costPoints: 10 } };
      },
      async deductOnSuccess() {
        return { ok: true, data: { deductedPoints: 10 } };
      }
    },
    generationTracing: tracing,
    generationLogger: logger
  });

  const result = await orchestrator.createWallpaperGenerationWorkflow(createBaseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "GENERATION_FAILURE");
  assert.equal(logs.some((entry) => entry.event === "generation_orchestrator_generation_failed"), true);
  assert.equal(
    logs.some((entry) => entry.payload?.error?.errorCode === "PROVIDER_FAILURE"),
    true
  );
});

test("normalized error 保留 correlationId", () => {
  const tracing = createGenerationTracing({
    createId() {
      return "gen_corr_error";
    },
    now() {
      return "2026-07-15T12:00:00.000Z";
    }
  });

  const trace = tracing.startTrace();
  const errorTrace = tracing.buildErrorTrace(trace, "PROVIDER_TIMEOUT");

  assert.deepEqual(errorTrace, {
    correlationId: "gen_corr_error",
    errorCode: "PROVIDER_TIMEOUT",
    timestamp: "2026-07-15T12:00:00.000Z"
  });
});
