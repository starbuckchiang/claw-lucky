"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createGenerationQueryService } = require("../generation-query-service");

function createRepositoryMock({ row = null, error = null } = {}) {
  return {
    async getByGenerationId() {
      if (error) {
        throw error;
      }
      return row;
    }
  };
}

function buildBaseRow(overrides = {}) {
  return {
    generationId: "gen-1",
    userId: "user-1",
    generationStatus: "pending",
    provider: null,
    model: null,
    imageUrl: null,
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-07-14T09:00:00.000Z",
    updatedAt: "2026-07-14T09:00:01.000Z",
    jobId: "job-1",
    jobStatus: "queued",
    progressPercent: 0,
    progressStage: "queued",
    estimatedRemainingSeconds: 20,
    jobUpdatedAt: "2026-07-14T09:00:02.000Z",
    ...overrides
  };
}

test("owner 查詢 pending generation", async () => {
  const service = createGenerationQueryService({
    generationQueryRepository: createRepositoryMock({
      row: buildBaseRow()
    })
  });

  const result = await service.getGenerationStatus({
    generationId: "gen-1",
    requesterUserId: "user-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.status, "pending");
  assert.equal(result.data.recommendedPollIntervalMs > 0, true);
});

test("owner 查詢 processing generation", async () => {
  const service = createGenerationQueryService({
    generationQueryRepository: createRepositoryMock({
      row: buildBaseRow({
        generationStatus: "processing",
        jobStatus: "processing",
        progressPercent: 45,
        progressStage: "generating"
      })
    })
  });

  const result = await service.getGenerationProgress({
    generationId: "gen-1",
    requesterUserId: "user-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.status, "processing");
  assert.equal(result.data.progressPercent, 45);
  assert.equal(result.data.recommendedPollIntervalMs, 1500);
});

test("owner 查詢 succeeded generation", async () => {
  const service = createGenerationQueryService({
    generationQueryRepository: createRepositoryMock({
      row: buildBaseRow({
        generationStatus: "succeeded",
        jobStatus: "succeeded",
        progressPercent: 100,
        provider: "gemini",
        model: "gemini-2.5-flash",
        imageUrl: "https://cdn.example.com/wallpaper.png"
      })
    })
  });

  const result = await service.getGenerationStatus({
    generationId: "gen-1",
    requesterUserId: "user-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.status, "succeeded");
  assert.equal(result.data.terminal, true);
  assert.equal(result.data.recommendedPollIntervalMs, 0);
});

test("owner 查詢 failed generation", async () => {
  const service = createGenerationQueryService({
    generationQueryRepository: createRepositoryMock({
      row: buildBaseRow({
        generationStatus: "failed",
        jobStatus: "failed",
        progressPercent: 100,
        failureCode: "PROVIDER_FAILURE",
        failureMessage: "provider unavailable"
      })
    })
  });

  const result = await service.getGenerationStatus({
    generationId: "gen-1",
    requesterUserId: "user-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.status, "failed");
  assert.equal(result.data.failureCode, "PROVIDER_FAILURE");
  assert.equal(result.data.recommendedPollIntervalMs, 0);
});

test("非 owner 查詢被拒絕", async () => {
  const service = createGenerationQueryService({
    generationQueryRepository: createRepositoryMock({
      row: buildBaseRow()
    })
  });

  const result = await service.getGenerationStatus({
    generationId: "gen-1",
    requesterUserId: "user-x"
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNAUTHORIZED_GENERATION_ACCESS");
});

test("generation 不存在", async () => {
  const service = createGenerationQueryService({
    generationQueryRepository: createRepositoryMock({
      row: null
    })
  });

  const result = await service.getGenerationStatus({
    generationId: "gen-missing",
    requesterUserId: "user-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "GENERATION_NOT_FOUND");
});

test("repository query failure", async () => {
  const service = createGenerationQueryService({
    generationQueryRepository: createRepositoryMock({
      error: new Error("supabase unavailable")
    })
  });

  const result = await service.getGenerationStatus({
    generationId: "gen-1",
    requesterUserId: "user-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "QUERY_FAILURE");
});

test("terminal state 不建議繼續 polling", async () => {
  const service = createGenerationQueryService({
    generationQueryRepository: createRepositoryMock({
      row: buildBaseRow({
        generationStatus: "processing",
        jobStatus: "cancelled",
        progressPercent: 66
      })
    })
  });

  const result = await service.getGenerationStatus({
    generationId: "gen-1",
    requesterUserId: "user-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.terminal, true);
  assert.equal(result.data.recommendedPollIntervalMs, 0);
});

test("progress payload 欄位完整", async () => {
  const service = createGenerationQueryService({
    generationQueryRepository: createRepositoryMock({
      row: buildBaseRow()
    })
  });

  const result = await service.getGenerationProgress({
    generationId: "gen-1",
    requesterUserId: "user-1"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data), [
    "generationId",
    "jobId",
    "status",
    "progressPercent",
    "progressStage",
    "estimatedRemainingSeconds",
    "provider",
    "model",
    "imageUrl",
    "failureCode",
    "failureMessage",
    "createdAt",
    "updatedAt",
    "recommendedPollIntervalMs",
    "terminal"
  ]);
});
