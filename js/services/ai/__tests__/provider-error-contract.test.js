"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { toProviderErrorInfo } = require("../contracts/provider-error");

test("preserves original exception metadata without discarding it", () => {
  const error = new Error("bad gateway");
  error.model = "gemini-2.5-flash-image";
  error.httpStatus = 502;
  error.providerStatus = "UNAVAILABLE";
  error.providerCode = 502;
  error.providerMessage = "upstream unavailable";
  error.retryable = true;

  const info = toProviderErrorInfo(error, "gemini", "corr-1");

  assert.deepEqual(info, {
    provider: "gemini",
    model: "gemini-2.5-flash-image",
    httpStatus: 502,
    providerStatus: "UNAVAILABLE",
    providerCode: 502,
    providerMessage: "upstream unavailable",
    retryable: true,
    correlationId: "corr-1"
  });
});

test("falls back gracefully when metadata is absent", () => {
  const info = toProviderErrorInfo(new Error("plain failure"), "replicate", "corr-2");

  assert.equal(info.model, null);
  assert.equal(info.httpStatus, null);
  assert.equal(info.providerStatus, null);
  assert.equal(info.providerCode, null);
  assert.equal(info.providerMessage, "plain failure");
  assert.equal(info.retryable, false);
  assert.equal(info.correlationId, "corr-2");
});
