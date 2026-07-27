"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFallbackShopkeeperContext, FALLBACK_VERSION } = require("../shopkeeper-fallback-context");

test("returns a complete, non-empty ShopkeeperContext", () => {
  const context = createFallbackShopkeeperContext();

  assert.equal(typeof context.luckyTheme, "string");
  assert.ok(context.luckyTheme.length > 0);
  assert.equal(typeof context.blessing, "string");
  assert.ok(context.blessing.length > 0);
  assert.equal(typeof context.story, "string");
  assert.ok(context.story.length > 0);
});

test("version and source are always the deterministic fallback markers", () => {
  const context = createFallbackShopkeeperContext();

  assert.equal(context.version, FALLBACK_VERSION);
  assert.equal(context.source, "fallback");
});

test("is deterministic across calls (no randomness, never blocks image generation with variance)", () => {
  const first = createFallbackShopkeeperContext();
  const second = createFallbackShopkeeperContext();

  assert.deepEqual(first, second);
});
