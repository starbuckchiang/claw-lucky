"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createGenerationOrchestrator } = require("../generation-orchestrator");

function createError(code, message, retryable = false, details = null) {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      details
    }
  };
}

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

function createDependencies(overrides = {}) {
  const calls = {
    deductPoints: 0,
    markFailed: 0
  };

  const generationService = overrides.generationService || {
    async createWallpaperGeneration() {
      return {
        ok: true,
        data: {
          generationId: "gen-001",
          status: "succeeded",
          provider: "mock-provider",
          model: "mock-model",
          promptVersion: "v1",
          createdAt: "2026-07-13T10:00:00.000Z"
        }
      };
    }
  };

  const usageService = overrides.usageService || {
    async checkDailyLimit() {
      return {
        ok: true,
        data: {
          usageDate: "2026-07-13",
          successCount: 0,
          dailyLimit: 3
        }
      };
    },
    async recordSuccess() {
      return {
        ok: true,
        data: {
          usageDate: "2026-07-13",
          successCount: 1
        }
      };
    }
  };

  const jobService = overrides.jobService || {
    JOB_STATUS: {
      PENDING: "Pending",
      RUNNING: "Running",
      SUCCESS: "Success",
      FAILED: "Failed"
    },
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
      calls.markFailed += 1;
      return { ok: true };
    }
  };

  const pointsService = overrides.pointsService || {
    async validateUser() {
      return {
        ok: true,
        data: {
          userId: "user-1"
        }
      };
    },
    async getGenerationCost() {
      return {
        ok: true,
        data: {
          costPoints: 10
        }
      };
    },
    async deductOnSuccess() {
      calls.deductPoints += 1;
      return {
        ok: true,
        data: {
          deductedPoints: 10
        }
      };
    }
  };

  const orchestrator = createGenerationOrchestrator({
    generationService,
    usageService,
    jobService,
    pointsService
  });

  return {
    orchestrator,
    calls
  };
}

test("Happy Path", async () => {
  const { orchestrator, calls } = createDependencies();
  const result = await orchestrator.createWallpaperGenerationWorkflow(createBaseRequest());

  assert.equal(result.ok, true);
  assert.equal(result.data.generationId, "gen-001");
  assert.equal(result.data.jobId, "job-001");
  assert.equal(result.data.jobStatus, "Success");
  assert.equal(result.data.deductedPoints, 10);
  assert.equal(calls.deductPoints, 1);
  assert.equal(calls.markFailed, 0);
});

test("Daily Limit", async () => {
  const { orchestrator, calls } = createDependencies({
    usageService: {
      async checkDailyLimit() {
        return createError("DAILY_LIMIT_EXCEEDED", "Daily generation limit exceeded.");
      },
      async recordSuccess() {
        return { ok: true, data: {} };
      }
    }
  });

  const result = await orchestrator.createWallpaperGenerationWorkflow(createBaseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "DAILY_LIMIT_EXCEEDED");
  assert.equal(calls.deductPoints, 0);
});

test("Success Deduct Points", async () => {
  const { orchestrator, calls } = createDependencies();
  const result = await orchestrator.createWallpaperGenerationWorkflow(createBaseRequest());

  assert.equal(result.ok, true);
  assert.equal(calls.deductPoints, 1);
});

test("Failure No Deduct", async () => {
  const { orchestrator, calls } = createDependencies({
    generationService: {
      async createWallpaperGeneration() {
        return createError("PROVIDER_FAILURE", "provider failed", true);
      }
    }
  });

  const result = await orchestrator.createWallpaperGenerationWorkflow(createBaseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "GENERATION_FAILURE");
  assert.equal(calls.deductPoints, 0);
  assert.equal(calls.markFailed, 1);
});

test("Job Failure", async () => {
  const { orchestrator } = createDependencies({
    jobService: {
      JOB_STATUS: {
        PENDING: "Pending",
        RUNNING: "Running",
        SUCCESS: "Success",
        FAILED: "Failed"
      },
      async createJob() {
        return createError("JOB_CREATION_FAILURE", "Failed to create generation job.", true);
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
    }
  });

  const result = await orchestrator.createWallpaperGenerationWorkflow(createBaseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "JOB_CREATION_FAILURE");
});

test("Repository Failure", async () => {
  const { orchestrator, calls } = createDependencies({
    usageService: {
      async checkDailyLimit() {
        return {
          ok: true,
          data: {
            usageDate: "2026-07-13",
            successCount: 0,
            dailyLimit: 3
          }
        };
      },
      async recordSuccess() {
        return createError("PERSISTENCE_FAILURE", "Failed to persist daily usage.", true);
      }
    }
  });

  const result = await orchestrator.createWallpaperGenerationWorkflow(createBaseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PERSISTENCE_FAILURE");
  assert.equal(calls.deductPoints, 1);
  assert.equal(calls.markFailed, 1);
});

test("Points Deduction Failure", async () => {
  const { orchestrator, calls } = createDependencies({
    pointsService: {
      async validateUser() {
        return {
          ok: true,
          data: {
            userId: "user-1"
          }
        };
      },
      async getGenerationCost() {
        return {
          ok: true,
          data: {
            costPoints: 10
          }
        };
      },
      async deductOnSuccess() {
        calls.deductPoints += 1;
        return createError("POINTS_DEDUCTION_FAILURE", "Failed to deduct points.", true);
      }
    }
  });

  const result = await orchestrator.createWallpaperGenerationWorkflow(createBaseRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "POINTS_DEDUCTION_FAILURE");
  assert.equal(calls.deductPoints, 1);
  assert.equal(calls.markFailed, 1);
});
