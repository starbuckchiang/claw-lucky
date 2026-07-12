"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createProviderAdapter } = require("../provider-adapter");
const { createMockProvider } = require("./test-helpers");

test("mock provider success returns normalized success payload", async () => {
  const adapter = createProviderAdapter({
    providerName: "mock-provider",
    model: "mock-model-v1",
    provider: createMockProvider()
  });

  const response = await adapter.generateWallpaper({ prompt: "lucky wallpaper" });

  assert.equal(response.provider, "mock-provider");
  assert.equal(response.model, "mock-model-v1");
  assert.equal(response.failureCode, null);
  assert.equal(response.failureMessage, null);
  assert.equal(response.retryable, false);
  assert.equal(typeof response.durationMs, "number");
  assert.ok(response.durationMs >= 0);
  assert.ok(response.result);
  assert.equal(response.result.imageUrl, "mock://wallpaper.png");
});
