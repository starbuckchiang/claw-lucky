"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createWallpaperResultPresenter } = require("../wallpaper-result-presenter");

function baseSubmitData(overrides = {}) {
  return {
    generationId: "gen-1",
    promptVersion: "v1",
    ...overrides
  };
}

function baseStatusData(overrides = {}) {
  return {
    generationId: "gen-1",
    imageUrl: "https://signed.example/file.png",
    provider: "gemini",
    model: "gemini-2.5-flash-image",
    status: "succeeded",
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:01.000Z",
    ...overrides
  };
}

test("P2-AI-04 Lite: presentSuccess passes through the 5 Shopkeeper fields from statusData (polling result)", () => {
  const presenter = createWallpaperResultPresenter();

  const result = presenter.presentSuccess({
    submitData: baseSubmitData(),
    statusData: baseStatusData({
      luckyTheme: "Golden Day",
      blessing: "Fortune follows you.",
      story: "A tiny lucky story.",
      oneLiner: "Shine on.",
      shopkeeperMessage: "Hi there!"
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.luckyTheme, "Golden Day");
  assert.equal(result.data.blessing, "Fortune follows you.");
  assert.equal(result.data.story, "A tiny lucky story.");
  assert.equal(result.data.oneLiner, "Shine on.");
  assert.equal(result.data.shopkeeperMessage, "Hi there!");
});

test("falls back to submitData's Shopkeeper fields when statusData omits them", () => {
  const presenter = createWallpaperResultPresenter();

  const result = presenter.presentSuccess({
    submitData: baseSubmitData({
      luckyTheme: "Golden Day",
      blessing: "Fortune follows you.",
      story: "A tiny lucky story.",
      oneLiner: "Shine on.",
      shopkeeperMessage: "Hi there!"
    }),
    statusData: baseStatusData()
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.luckyTheme, "Golden Day");
  assert.equal(result.data.shopkeeperMessage, "Hi there!");
});

test("missing Shopkeeper fields on both layers degrade to null (never throw)", () => {
  const presenter = createWallpaperResultPresenter();

  const result = presenter.presentSuccess({
    submitData: baseSubmitData(),
    statusData: baseStatusData()
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.luckyTheme, null);
  assert.equal(result.data.blessing, null);
  assert.equal(result.data.story, null);
  assert.equal(result.data.oneLiner, null);
  assert.equal(result.data.shopkeeperMessage, null);
});

test("still fails when imageUrl is missing (unchanged behavior)", () => {
  const presenter = createWallpaperResultPresenter();

  const result = presenter.presentSuccess({
    submitData: baseSubmitData(),
    statusData: baseStatusData({ imageUrl: "" })
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_STATUS_RESPONSE");
});
