"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createWallpaperGenerationClient } = require("../wallpaper-generation-client");

test("Happy Path", async () => {
  const generationApi = {
    async createGeneration() {
      return {
        ok: true,
        data: {
          generationId: "gen-1",
          promptVersion: "v2"
        }
      };
    },
    async getGenerationProgress() {
      return {
        ok: true,
        data: {
          generationId: "gen-1",
          status: "succeeded",
          terminal: true,
          recommendedPollIntervalMs: 0,
          imageUrl: "https://cdn.example.com/ok.png",
          provider: "mock-provider",
          model: "mock-model"
        }
      };
    }
  };

  const client = createWallpaperGenerationClient({ generationApi });
  const result = await client.submitAndPoll({
    userId: "user-1",
    mascotId: "mascot-1",
    giftId: "gift-1",
    wallpaperStyle: "Retro",
    luckyTheme: "Lucky",
    blessing: "Good luck",
    promptType: "wallpaper_generation"
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.imageUrl, "https://cdn.example.com/ok.png");
  assert.equal(result.data.provider, "mock-provider");
  assert.equal(result.data.promptVersion, "v2");
});

test("Daily Limit", async () => {
  let polled = 0;
  const generationApi = {
    async createGeneration() {
      return {
        ok: false,
        error: {
          code: "DAILY_LIMIT_EXCEEDED",
          message: "limit exceeded",
          retryable: false
        }
      };
    },
    async getGenerationProgress() {
      polled += 1;
      return { ok: true, data: {} };
    }
  };

  const client = createWallpaperGenerationClient({ generationApi });
  const result = await client.submitAndPoll({});

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "DAILY_LIMIT_EXCEEDED");
  assert.equal(polled, 0);
});
