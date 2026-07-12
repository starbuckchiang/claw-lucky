"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyRetryability } = require("../error-normalizer");
const { FAILURE_CODES } = require("../failure-codes");

test("classifyRetryability distinguishes retryable and non-retryable failures", () => {
  assert.equal(classifyRetryability({ failureCode: FAILURE_CODES.TIMEOUT }), true);
  assert.equal(classifyRetryability({ failureCode: FAILURE_CODES.RATE_LIMITED }), true);
  assert.equal(classifyRetryability({ failureCode: FAILURE_CODES.PROVIDER_UNAVAILABLE }), true);
  assert.equal(classifyRetryability({ failureCode: FAILURE_CODES.NETWORK_ERROR }), true);

  assert.equal(classifyRetryability({ failureCode: FAILURE_CODES.AUTH_ERROR }), false);
  assert.equal(classifyRetryability({ failureCode: FAILURE_CODES.INVALID_REQUEST }), false);
  assert.equal(classifyRetryability({ failureCode: FAILURE_CODES.CONTENT_REJECTED }), false);
  assert.equal(classifyRetryability({ failureCode: FAILURE_CODES.UNKNOWN_PROVIDER_ERROR }), false);
});
