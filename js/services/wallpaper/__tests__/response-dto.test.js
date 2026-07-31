"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createGenerationSuccessDto, createGenerationErrorDto } = require("../response-dto");

function baseRecord(overrides = {}) {
  return {
    generationId: "gen-1",
    status: "succeeded",
    provider: "gemini",
    model: "gemini-2.5-flash-image",
    imageUrl: "https://signed.example/file.png",
    promptVersion: "v1",
    durationMs: 900,
    createdAt: "2026-07-31T00:00:00.000Z",
    ...overrides
  };
}

test("P2-AI-04 Lite: success DTO includes the 5 safe Shopkeeper display fields", () => {
  const dto = createGenerationSuccessDto(
    baseRecord({
      luckyTheme: "Golden Day",
      blessing: "Fortune follows you.",
      story: "A tiny lucky story.",
      oneLiner: "Shine on.",
      shopkeeperMessage: "Hi there!"
    })
  );

  assert.equal(dto.ok, true);
  assert.equal(dto.data.luckyTheme, "Golden Day");
  assert.equal(dto.data.blessing, "Fortune follows you.");
  assert.equal(dto.data.story, "A tiny lucky story.");
  assert.equal(dto.data.oneLiner, "Shine on.");
  assert.equal(dto.data.shopkeeperMessage, "Hi there!");
});

test("P2-AI-04 Lite: never exposes source/shopkeeperVersion even if present on the record", () => {
  const dto = createGenerationSuccessDto(
    baseRecord({
      luckyTheme: "Golden Day",
      blessing: "Fortune follows you.",
      story: "A tiny lucky story.",
      oneLiner: "Shine on.",
      shopkeeperMessage: "Hi there!",
      source: "ai",
      shopkeeperVersion: "shopkeeper-context-v1"
    })
  );

  assert.equal(dto.data.source, undefined);
  assert.equal(dto.data.shopkeeperVersion, undefined);
  assert.equal(JSON.stringify(dto).toLowerCase().includes("shopkeeperversion"), false);
});

test("missing Shopkeeper fields degrade to null (never throw)", () => {
  const dto = createGenerationSuccessDto(baseRecord());

  assert.equal(dto.ok, true);
  assert.equal(dto.data.luckyTheme, null);
  assert.equal(dto.data.blessing, null);
  assert.equal(dto.data.story, null);
  assert.equal(dto.data.oneLiner, null);
  assert.equal(dto.data.shopkeeperMessage, null);
});

test("createGenerationErrorDto shape unchanged", () => {
  const dto = createGenerationErrorDto({ code: "X", message: "y", retryable: true });

  assert.equal(dto.ok, false);
  assert.equal(dto.error.code, "X");
  assert.equal(dto.error.retryable, true);
});
