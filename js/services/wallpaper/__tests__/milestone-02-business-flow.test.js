"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWallpaperGenerationClient
} = require("../wallpaper-generation-client");

function createRequest() {
  return {
    userId: "user-1",
    mascotId: "mascot-1",
    giftId: "gift-1",
    wallpaperStyle: "Retro",
    luckyTheme: "Lucky",
    blessing: "Good luck",
    promptType: "wallpaper_generation"
  };
}

test("Milestone 2: Success Flow", async () => {
  let createCalls = 0;
  const pollingCalls = [];
  const progressQueue = [
    {
      ok: true,
      data: {
        generationId: "gen-success",
        status: "pending",
        terminal: false,
        recommendedPollIntervalMs: 1200
      }
    },
    {
      ok: true,
      data: {
        generationId: "gen-success",
        status: "processing",
        terminal: false,
        recommendedPollIntervalMs: 900
      }
    },
    {
      ok: true,
      data: {
        generationId: "gen-success",
        status: "succeeded",
        terminal: true,
        recommendedPollIntervalMs: 0,
        imageUrl: "https://cdn.example.com/wallpaper.png",
        provider: "mock-provider",
        model: "mock-model",
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:03.000Z"
      }
    }
  ];
  const progressOrder = [];

  const client = createWallpaperGenerationClient({
    generationApi: {
      async createGeneration() {
        createCalls += 1;
        return {
          ok: true,
          data: {
            generationId: "gen-success",
            promptVersion: "v2"
          }
        };
      },
      async getGenerationProgress(generationId) {
        pollingCalls.push(generationId);
        const next = progressQueue.shift();
        progressOrder.push(next?.data?.status || "unknown");
        return next;
      }
    }
  });

  const result = await client.submitAndPoll(createRequest());

  assert.equal(result.ok, true);
  assert.equal(result.data.imageUrl, "https://cdn.example.com/wallpaper.png");
  assert.equal(result.data.provider, "mock-provider");
  assert.equal(result.data.promptVersion, "v2");
  assert.equal(createCalls, 1);
  assert.equal(pollingCalls.length, 3);
  assert.deepEqual(progressOrder, ["pending", "processing", "succeeded"]);
  assert.equal(progressQueue.length, 0);
});

test("Milestone 2: Provider Timeout Flow", async () => {
  let pollingCalls = 0;

  const client = createWallpaperGenerationClient({
    generationApi: {
      async createGeneration() {
        return {
          ok: true,
          data: {
            generationId: "gen-timeout",
            promptVersion: "v3"
          }
        };
      },
      async getGenerationProgress() {
        pollingCalls += 1;
        return {
          ok: true,
          data: {
            generationId: "gen-timeout",
            status: "failed",
            terminal: true,
            recommendedPollIntervalMs: 0,
            failureCode: "PROVIDER_TIMEOUT",
            failureMessage: "Provider timeout"
          }
        };
      }
    }
  });

  const result = await client.submitAndPoll(createRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PROVIDER_TIMEOUT");
  assert.equal(pollingCalls, 1);
  assert.equal(result.error.message.includes("Exception"), false);
});

test("Milestone 2: Daily Limit Flow", async () => {
  let pollingCalls = 0;

  const client = createWallpaperGenerationClient({
    generationApi: {
      async createGeneration() {
        return {
          ok: false,
          error: {
            code: "DAILY_LIMIT_EXCEEDED",
            message: "Daily limit exceeded",
            retryable: false
          }
        };
      },
      async getGenerationProgress() {
        pollingCalls += 1;
        return { ok: true, data: {} };
      }
    }
  });

  const result = await client.submitAndPoll(createRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "DAILY_LIMIT_EXCEEDED");
  assert.equal(pollingCalls, 0);
});

test("Milestone 2: Unauthorized Flow", async () => {
  let pollingCalls = 0;

  const client = createWallpaperGenerationClient({
    generationApi: {
      async createGeneration() {
        return {
          ok: true,
          data: {
            generationId: "gen-unauthorized",
            promptVersion: "v2"
          }
        };
      },
      async getGenerationProgress() {
        pollingCalls += 1;
        return {
          ok: false,
          error: {
            code: "UNAUTHORIZED_GENERATION_ACCESS",
            message: "forbidden",
            retryable: false
          }
        };
      }
    }
  });

  const result = await client.submitAndPoll(createRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNAUTHORIZED_GENERATION_ACCESS");
  assert.equal(pollingCalls, 1);
});

test("Milestone 2: Polling Failure Flow", async () => {
  let pollingCalls = 0;

  const client = createWallpaperGenerationClient({
    generationApi: {
      async createGeneration() {
        return {
          ok: true,
          data: {
            generationId: "gen-network",
            promptVersion: "v2"
          }
        };
      },
      async getGenerationProgress() {
        pollingCalls += 1;
        throw new Error("network down");
      }
    }
  });

  const result = await client.submitAndPoll(createRequest());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "POLLING_FAILURE");
  assert.equal(pollingCalls, 1);
});

test("Milestone 2: Invalid Status Flow", async () => {
  let pollingCalls = 0;
  const fetchBackup = global.fetch;
  global.fetch = async () => {
    throw new Error("unexpected real network call");
  };

  try {
    const client = createWallpaperGenerationClient({
      generationApi: {
        async createGeneration() {
          return {
            ok: true,
            data: {
              generationId: "gen-invalid-status",
              promptVersion: "v2"
            }
          };
        },
        async getGenerationProgress() {
          pollingCalls += 1;
          return {
            ok: true,
            data: {
              generationId: "gen-invalid-status",
              status: "processing",
              terminal: false,
              recommendedPollIntervalMs: 0
            }
          };
        }
      }
    });

    const result = await client.submitAndPoll(createRequest());

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_STATUS_RESPONSE");
    assert.equal(pollingCalls, 1);
  } finally {
    global.fetch = fetchBackup;
  }
});
