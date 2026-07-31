"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateCreateGenerationRequest } = require("../generation-validator");

function baseRequest(overrides = {}) {
  return {
    userId: "user-1",
    mascotId: "mascot-1",
    giftId: "gift-1",
    wallpaperStyle: "Retro",
    promptType: "wallpaper_generation",
    ...overrides
  };
}

test("valid request without luckyTheme/blessing succeeds (P2-AI-04 Lite)", () => {
  const result = validateCreateGenerationRequest(baseRequest());

  assert.equal(result.ok, true);
  assert.equal(result.value.luckyTheme, "");
  assert.equal(result.value.blessing, "");
  assert.equal(result.value.mascotId, "mascot-1");
});

test("legacy client still sending luckyTheme/blessing does not fail validation, values are normalized but not required", () => {
  const result = validateCreateGenerationRequest(
    baseRequest({ luckyTheme: "Golden Day", blessing: "Fortune follows you." })
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.luckyTheme, "Golden Day");
  assert.equal(result.value.blessing, "Fortune follows you.");
});

test("still requires userId/mascotId/giftId/wallpaperStyle/promptType", () => {
  const result = validateCreateGenerationRequest({});

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_REQUEST");
  assert.ok(result.error.details.errors.includes("userId is required"));
  assert.ok(result.error.details.errors.includes("mascotId is required"));
  assert.ok(result.error.details.errors.includes("giftId is required"));
  assert.ok(result.error.details.errors.includes("wallpaperStyle is required"));
  assert.ok(result.error.details.errors.includes("promptType is required"));
  // luckyTheme/blessing must NOT appear in the required-field errors anymore.
  assert.equal(result.error.details.errors.some((e) => e.includes("luckyTheme")), false);
  assert.equal(result.error.details.errors.some((e) => e.includes("blessing")), false);
});

test("rejects unsupported wallpaper style", () => {
  const result = validateCreateGenerationRequest(baseRequest({ wallpaperStyle: "Unknown" }));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNSUPPORTED_WALLPAPER_STYLE");
});

test("rejects non-object payloads", () => {
  const result = validateCreateGenerationRequest(null);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_REQUEST");
});
