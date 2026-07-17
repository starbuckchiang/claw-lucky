"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { handleStatusRequest, toHttpStatus } = require("../wallpaper-status-handler");

function mockQueryService(resultOrFn) {
  return {
    calls: [],
    getGenerationProgress(input) {
      this.calls.push(input);
      return typeof resultOrFn === "function" ? resultOrFn(input) : resultOrFn;
    }
  };
}

test("Status handler: unauthorized when no authenticated userId", async () => {
  const response = await handleStatusRequest({
    generationId: "gen-1",
    userId: null,
    correlationId: "corr-1",
    deps: {}
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error.code, "UNAUTHORIZED");
});

test("Status handler: successful (non-terminal) polling response", async () => {
  const queryService = mockQueryService({
    ok: true,
    data: {
      generationId: "gen-1",
      jobId: "job-1",
      status: "processing",
      progressPercent: 40,
      progressStage: "generating",
      terminal: false,
      recommendedPollIntervalMs: 1500,
      provider: null,
      model: null,
      imageUrl: null,
      failureCode: null,
      failureMessage: null,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:05.000Z"
    }
  });

  const response = await handleStatusRequest({
    generationId: "gen-1",
    userId: "user-1",
    correlationId: "corr-2",
    deps: { queryService }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.terminal, false);
  assert.equal(queryService.calls[0].requesterUserId, "user-1");
});

test("Status handler: terminal failed polling response is still HTTP 200 (ok:true business result)", async () => {
  const queryService = mockQueryService({
    ok: true,
    data: {
      generationId: "gen-1",
      status: "failed",
      terminal: true,
      recommendedPollIntervalMs: 0,
      failureCode: "PROVIDER_TIMEOUT",
      failureMessage: "Provider request timed out.",
      progressPercent: 100,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:30.000Z"
    }
  });

  const response = await handleStatusRequest({
    generationId: "gen-1",
    userId: "user-1",
    correlationId: "corr-3",
    deps: { queryService }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.terminal, true);
  assert.equal(response.body.data.recommendedPollIntervalMs, 0);
});

test("Status handler: owner-only access — mismatched owner maps to 403", async () => {
  const queryService = mockQueryService({
    ok: false,
    error: { code: "UNAUTHORIZED_GENERATION_ACCESS", message: "You do not have access to this generation.", retryable: false }
  });

  const response = await handleStatusRequest({
    generationId: "gen-1",
    userId: "not-the-owner",
    correlationId: "corr-4",
    deps: { queryService }
  });

  assert.equal(response.statusCode, 403);
});

test("Status handler: generation not found maps to 404", async () => {
  const queryService = mockQueryService({
    ok: false,
    error: { code: "GENERATION_NOT_FOUND", message: "Generation not found.", retryable: false }
  });

  const response = await handleStatusRequest({
    generationId: "does-not-exist",
    userId: "user-1",
    correlationId: "corr-5",
    deps: { queryService }
  });

  assert.equal(response.statusCode, 404);
});

test("correlationId is echoed back regardless of outcome", async () => {
  const queryService = mockQueryService({ ok: true, data: { status: "succeeded", terminal: true, recommendedPollIntervalMs: 0 } });

  const response = await handleStatusRequest({
    generationId: "gen-1",
    userId: "user-1",
    correlationId: "corr-6",
    deps: { queryService }
  });

  assert.equal(response.correlationId, "corr-6");
});

test("toHttpStatus default fallback", () => {
  assert.equal(toHttpStatus("SOMETHING_UNMAPPED"), 500);
});
