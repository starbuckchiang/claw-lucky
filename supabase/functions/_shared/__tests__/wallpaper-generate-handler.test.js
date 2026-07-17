"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { handleGenerateRequest, validateRequestShape, toHttpStatus } = require("../wallpaper-generate-handler");

function validBody(overrides = {}) {
  return {
    mascotId: "mascot-1",
    giftId: "gift-1",
    wallpaperStyle: "Retro",
    luckyTheme: "Golden Day",
    blessing: "Fortune follows you.",
    promptType: "wallpaper_generation",
    ...overrides
  };
}

function mockOrchestrator(resultOrFn) {
  return {
    calls: [],
    createWallpaperGenerationWorkflow(request) {
      this.calls.push(request);
      return typeof resultOrFn === "function" ? resultOrFn(request) : resultOrFn;
    }
  };
}

test("Edge handler: unauthorized when no authenticated userId", async () => {
  const response = await handleGenerateRequest({
    body: validBody(),
    userId: null,
    correlationId: "corr-1",
    deps: {}
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error.code, "UNAUTHORIZED");
});

test("Edge handler: invalid request when required fields missing", async () => {
  const response = await handleGenerateRequest({
    body: { mascotId: "mascot-1" },
    userId: "user-1",
    correlationId: "corr-2",
    deps: {}
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, "INVALID_REQUEST");
});

test("Edge handler: rejects client-supplied userId / secrets in body", async () => {
  const response = await handleGenerateRequest({
    body: validBody({ userId: "attacker-controlled", apiKey: "leak-me" }),
    userId: "user-1",
    correlationId: "corr-3",
    deps: {}
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, "INVALID_REQUEST");
  assert.ok(response.body.error.details.errors.some((e) => e.includes("userId")));
  assert.ok(response.body.error.details.errors.some((e) => e.includes("apiKey")));
});

test("Edge handler: never trusts client-supplied userId — uses authenticated userId only", async () => {
  const orchestrator = mockOrchestrator((request) => {
    assert.equal(request.userId, "user-1");
    return { ok: true, data: { generationId: "gen-1", status: "succeeded", provider: "gemini", model: "m", imageUrl: "https://x/y.png", promptVersion: "v1", durationMs: 10, createdAt: "now" } };
  });

  const response = await handleGenerateRequest({
    body: validBody(),
    userId: "user-1",
    correlationId: "corr-4",
    deps: { orchestrator }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(orchestrator.calls[0].userId, "user-1");
  assert.equal(orchestrator.calls[0].correlationId, "corr-4");
});

test("Edge handler: provider success returns 200 with normalized DTO (no secrets)", async () => {
  const orchestrator = mockOrchestrator({
    ok: true,
    data: {
      generationId: "gen-1",
      status: "succeeded",
      provider: "gemini",
      model: "gemini-2.5-flash-image",
      imageUrl: "https://signed.example/file.png",
      promptVersion: "v1",
      durationMs: 1200,
      createdAt: "2026-07-16T00:00:00.000Z"
    }
  });

  const response = await handleGenerateRequest({
    body: validBody(),
    userId: "user-1",
    correlationId: "corr-5",
    deps: { orchestrator }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.generationId, "gen-1");
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.toLowerCase().includes("apikey"), false);
  assert.equal(serialized.toLowerCase().includes("base64"), false);
});

test("Edge handler: provider timeout maps to 504", async () => {
  const orchestrator = mockOrchestrator({
    ok: false,
    error: { code: "PROVIDER_TIMEOUT", message: "Provider request timed out.", retryable: true, details: null }
  });

  const response = await handleGenerateRequest({
    body: validBody(),
    userId: "user-1",
    correlationId: "corr-6",
    deps: { orchestrator }
  });

  assert.equal(response.statusCode, 504);
  assert.equal(response.body.error.code, "PROVIDER_TIMEOUT");
});

test("Edge handler: provider rate limit (PROVIDER_FAILURE + details.failureCode) maps to 429", async () => {
  const orchestrator = mockOrchestrator({
    ok: false,
    error: {
      code: "PROVIDER_FAILURE",
      message: "Provider failed to generate image.",
      retryable: true,
      details: { failureCode: "PROVIDER_RATE_LIMIT" }
    }
  });

  const response = await handleGenerateRequest({
    body: validBody(),
    userId: "user-1",
    correlationId: "corr-7",
    deps: { orchestrator }
  });

  assert.equal(response.statusCode, 429);
  // Approved P1-BIZ-03 contract: top-level DTO code stays PROVIDER_FAILURE.
  assert.equal(response.body.error.code, "PROVIDER_FAILURE");
});

test("Edge handler: storage upload failure (PROVIDER_FAILURE + details.failureCode) maps to 502", async () => {
  const orchestrator = mockOrchestrator({
    ok: false,
    error: {
      code: "PROVIDER_FAILURE",
      message: "Provider failed to generate image.",
      retryable: true,
      details: { failureCode: "STORAGE_UPLOAD_FAILED" }
    }
  });

  const response = await handleGenerateRequest({
    body: validBody(),
    userId: "user-1",
    correlationId: "corr-8",
    deps: { orchestrator }
  });

  assert.equal(response.statusCode, 502);
});

test("Edge handler: persistence failure maps to 503", async () => {
  const orchestrator = mockOrchestrator({
    ok: false,
    error: { code: "PERSISTENCE_FAILURE", message: "Failed to persist.", retryable: true, details: null }
  });

  const response = await handleGenerateRequest({
    body: validBody(),
    userId: "user-1",
    correlationId: "corr-9",
    deps: { orchestrator }
  });

  assert.equal(response.statusCode, 503);
});

test("Edge handler: daily limit exceeded maps to 429", async () => {
  const orchestrator = mockOrchestrator({
    ok: false,
    error: { code: "DAILY_LIMIT_EXCEEDED", message: "Daily generation limit exceeded.", retryable: false, details: null }
  });

  const response = await handleGenerateRequest({
    body: validBody(),
    userId: "user-1",
    correlationId: "corr-10",
    deps: { orchestrator }
  });

  assert.equal(response.statusCode, 429);
});

test("Edge handler: correlationId is echoed back on both success and failure", async () => {
  const orchestrator = mockOrchestrator({ ok: true, data: { generationId: "gen-1" } });

  const success = await handleGenerateRequest({
    body: validBody(),
    userId: "user-1",
    correlationId: "corr-11",
    deps: { orchestrator }
  });
  assert.equal(success.correlationId, "corr-11");

  const failingOrchestrator = mockOrchestrator({ ok: false, error: { code: "PROVIDER_TIMEOUT", message: "x", retryable: true } });
  const failure = await handleGenerateRequest({
    body: validBody(),
    userId: "user-1",
    correlationId: "corr-12",
    deps: { orchestrator: failingOrchestrator }
  });
  assert.equal(failure.correlationId, "corr-12");
});

test("validateRequestShape / toHttpStatus helpers", () => {
  assert.equal(validateRequestShape(null).length > 0, true);
  assert.equal(validateRequestShape(validBody()).length, 0);
  assert.equal(toHttpStatus("PROVIDER_TIMEOUT"), 504);
  assert.equal(toHttpStatus("PROVIDER_FAILURE", { failureCode: "PROVIDER_UNAVAILABLE" }), 503);
  assert.equal(toHttpStatus("UNKNOWN_CODE_NOT_MAPPED"), 500);
});
