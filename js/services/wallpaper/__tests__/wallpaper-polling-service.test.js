"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createWallpaperPollingService } = require("../wallpaper-polling-service");

test("Polling Until Success", async () => {
  const waitCalls = [];
  const responses = [
    {
      ok: true,
      data: {
        generationId: "gen-1",
        status: "processing",
        terminal: false,
        recommendedPollIntervalMs: 777
      }
    },
    {
      ok: true,
      data: {
        generationId: "gen-1",
        status: "succeeded",
        terminal: true,
        recommendedPollIntervalMs: 0,
        imageUrl: "https://cdn.example.com/1.png",
        provider: "mock-provider"
      }
    }
  ];

  const pollingService = createWallpaperPollingService({
    async getGenerationProgress() {
      return responses.shift();
    },
    async wait(ms) {
      waitCalls.push(ms);
    }
  });

  const result = await pollingService.pollUntilTerminal({ generationId: "gen-1" });

  assert.equal(result.ok, true);
  assert.equal(result.data.status, "succeeded");
  assert.deepEqual(waitCalls, [777]);
});

test("Polling Until Failure", async () => {
  const responses = [
    {
      ok: true,
      data: {
        generationId: "gen-2",
        status: "processing",
        terminal: false,
        recommendedPollIntervalMs: 600
      }
    },
    {
      ok: true,
      data: {
        generationId: "gen-2",
        status: "failed",
        terminal: true,
        recommendedPollIntervalMs: 0,
        failureCode: "PROVIDER_FAILURE",
        failureMessage: "Provider unavailable"
      }
    }
  ];

  const pollingService = createWallpaperPollingService({
    async getGenerationProgress() {
      return responses.shift();
    },
    async wait() {}
  });

  const result = await pollingService.pollUntilTerminal({ generationId: "gen-2" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PROVIDER_FAILURE");
});

test("Provider Timeout", async () => {
  const pollingService = createWallpaperPollingService({
    async getGenerationProgress() {
      return {
        ok: true,
        data: {
          generationId: "gen-timeout",
          status: "failed",
          terminal: true,
          recommendedPollIntervalMs: 0,
          failureCode: "PROVIDER_TIMEOUT",
          failureMessage: "timeout"
        }
      };
    },
    async wait() {}
  });

  const result = await pollingService.pollUntilTerminal({ generationId: "gen-timeout" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PROVIDER_TIMEOUT");
});

test("Generation Failed without failureCode", async () => {
  const pollingService = createWallpaperPollingService({
    async getGenerationProgress() {
      return {
        ok: true,
        data: {
          generationId: "gen-failed",
          status: "failed",
          terminal: true,
          recommendedPollIntervalMs: 0
        }
      };
    },
    async wait() {}
  });

  const result = await pollingService.pollUntilTerminal({ generationId: "gen-failed" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "GENERATION_FAILED");
});

test("Unauthorized", async () => {
  const pollingService = createWallpaperPollingService({
    async getGenerationProgress() {
      return {
        ok: false,
        error: {
          code: "UNAUTHORIZED_GENERATION_ACCESS",
          message: "forbidden"
        }
      };
    },
    async wait() {}
  });

  const result = await pollingService.pollUntilTerminal({ generationId: "gen-3" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNAUTHORIZED_GENERATION_ACCESS");
});

test("Polling Failure", async () => {
  const pollingService = createWallpaperPollingService({
    async getGenerationProgress() {
      throw new Error("network down");
    },
    async wait() {}
  });

  const result = await pollingService.pollUntilTerminal({ generationId: "gen-4" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "POLLING_FAILURE");
});

test("Terminal Stop", async () => {
  let called = 0;
  let waited = 0;

  const pollingService = createWallpaperPollingService({
    async getGenerationProgress() {
      called += 1;
      return {
        ok: true,
        data: {
          generationId: "gen-5",
          status: "succeeded",
          terminal: true,
          recommendedPollIntervalMs: 0,
          imageUrl: "https://cdn.example.com/ok.png"
        }
      };
    },
    async wait() {
      waited += 1;
    }
  });

  const result = await pollingService.pollUntilTerminal({ generationId: "gen-5" });
  assert.equal(result.ok, true);
  assert.equal(called, 1);
  assert.equal(waited, 0);
});
