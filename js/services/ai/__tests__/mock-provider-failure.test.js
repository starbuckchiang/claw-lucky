"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createProviderAdapter } = require("../provider-adapter");
const { FAILURE_CODES } = require("../failure-codes");
const { createMockProvider } = require("./test-helpers");

test("mock provider failure returns normalized error payload", async () => {
  const adapter = createProviderAdapter({
    providerName: "mock-provider",
    model: "mock-model-v1",
    provider: createMockProvider({
      shouldFail: true,
      errorFactory() {
        return {
          status: 503,
          code: "SERVICE_UNAVAILABLE",
          message: "provider temporarily unavailable",
          requestId: "provider-req-err-1"
        };
      }
    })
  });

  const response = await adapter.generateLuckyContext({ userId: "u1" });

  assert.equal(response.provider, "mock-provider");
  assert.equal(response.model, "mock-model-v1");
  assert.equal(response.result, null);
  assert.equal(response.failureCode, FAILURE_CODES.PROVIDER_UNAVAILABLE);
  assert.equal(response.retryable, true);
  assert.equal(response.providerRequestId, "provider-req-err-1");
  assert.equal(typeof response.failureMessage, "string");
  assert.ok(response.failureMessage.length > 0);
});
