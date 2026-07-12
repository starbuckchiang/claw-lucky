"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeProviderError } = require("../error-normalizer");
const { FAILURE_CODES } = require("../failure-codes");

test("normalizeProviderError maps raw provider errors to normalized failure codes", () => {
  const timeout = normalizeProviderError({ code: "ETIMEDOUT", message: "Request timeout" });
  const rateLimited = normalizeProviderError({ status: 429, message: "Too many requests" });
  const auth = normalizeProviderError({ status: 401, message: "Unauthorized" });
  const invalid = normalizeProviderError({ status: 400, message: "Invalid request payload" });
  const rejected = normalizeProviderError({ code: "CONTENT_REJECTED", message: "blocked by policy" });
  const unavailable = normalizeProviderError({ status: 503, message: "Service unavailable" });
  const network = normalizeProviderError({ code: "ENOTFOUND", message: "Network DNS failure" });
  const unknown = normalizeProviderError({ message: "Unhandled provider explosion" });

  assert.equal(timeout.failureCode, FAILURE_CODES.TIMEOUT);
  assert.equal(rateLimited.failureCode, FAILURE_CODES.RATE_LIMITED);
  assert.equal(auth.failureCode, FAILURE_CODES.AUTH_ERROR);
  assert.equal(invalid.failureCode, FAILURE_CODES.INVALID_REQUEST);
  assert.equal(rejected.failureCode, FAILURE_CODES.CONTENT_REJECTED);
  assert.equal(unavailable.failureCode, FAILURE_CODES.PROVIDER_UNAVAILABLE);
  assert.equal(network.failureCode, FAILURE_CODES.NETWORK_ERROR);
  assert.equal(unknown.failureCode, FAILURE_CODES.UNKNOWN_PROVIDER_ERROR);
});
