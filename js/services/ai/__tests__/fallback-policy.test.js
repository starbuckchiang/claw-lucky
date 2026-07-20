"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { isFallbackEligible, NEVER_FALLBACK_CODES, FALLBACK_ELIGIBLE_CODES } = require("../fallback/fallback-policy");

test("never falls back for invalid input / auth / daily limit / content policy", () => {
  for (const code of [
    "INVALID_REQUEST",
    "UNSUPPORTED_WALLPAPER_STYLE",
    "UNSUPPORTED_PROMPT_TYPE",
    "UNAUTHORIZED",
    "UNAUTHORIZED_GENERATION_ACCESS",
    "DAILY_LIMIT_EXCEEDED",
    "PROVIDER_AUTH_FAILED",
    "PROVIDER_BAD_REQUEST",
    "CONTENT_REJECTED"
  ]) {
    assert.equal(isFallbackEligible({ failureCode: code }), false, `${code} must never be fallback-eligible`);
  }
});

test("falls back for infra/provider failures", () => {
  for (const code of [
    "PROVIDER_TIMEOUT",
    "PROVIDER_RATE_LIMIT",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_UNKNOWN",
    "PROVIDER_FAILURE"
  ]) {
    assert.equal(isFallbackEligible({ failureCode: code }), true, `${code} must be fallback-eligible`);
  }
});

test("PROVIDER_INVALID_RESPONSE: eligible when NOT a safety block", () => {
  assert.equal(
    isFallbackEligible({ failureCode: "PROVIDER_INVALID_RESPONSE", diagnostics: { finishReason: "NO_IMAGE" } }),
    true
  );
});

test("PROVIDER_INVALID_RESPONSE: never eligible when safety-blocked", () => {
  assert.equal(
    isFallbackEligible({ failureCode: "PROVIDER_INVALID_RESPONSE", diagnostics: { finishReason: "SAFETY" } }),
    false
  );
});

test("empty/missing failureCode is never eligible", () => {
  assert.equal(isFallbackEligible({}), false);
  assert.equal(isFallbackEligible(), false);
});

test("policy tables are deterministic plain sets (no heuristics)", () => {
  assert.ok(NEVER_FALLBACK_CODES instanceof Set);
  assert.ok(FALLBACK_ELIGIBLE_CODES instanceof Set);
});
