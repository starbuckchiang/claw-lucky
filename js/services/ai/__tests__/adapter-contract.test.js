"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createProviderAdapter } = require("../provider-adapter");
const { createMockProvider } = require("./test-helpers");

test("adapter exposes required interface and normalized output shape", async () => {
  const adapter = createProviderAdapter({
    providerName: "mock-provider",
    model: "mock-model-v1",
    provider: createMockProvider()
  });

  assert.equal(typeof adapter.generateLuckyContext, "function");
  assert.equal(typeof adapter.generateWallpaper, "function");
  assert.equal(typeof adapter.classifyRetryability, "function");
  assert.equal(typeof adapter.normalizeProviderError, "function");

  const output = await adapter.generateLuckyContext({ userId: "u1" });
  const expectedFields = [
    "providerRequestId",
    "provider",
    "model",
    "result",
    "durationMs",
    "retryable",
    "failureCode",
    "failureMessage"
  ];

  expectedFields.forEach((field) => {
    assert.ok(Object.prototype.hasOwnProperty.call(output, field), `missing field: ${field}`);
  });
});
