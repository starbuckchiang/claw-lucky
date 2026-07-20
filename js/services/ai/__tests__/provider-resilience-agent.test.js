"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createProviderResilienceAgent } = require("../agents/provider-resilience-agent");
const { NormalizedProviderError } = require("../provider-types");

function makeAdapter(impl) {
  return { generateImage: impl };
}

function collectLogger() {
  const events = [];
  return {
    events,
    info: (entry) => events.push(entry),
    error: (entry) => events.push(entry)
  };
}

test("primary success -> fallback never invoked", async () => {
  let fallbackCalls = 0;
  const logger = collectLogger();
  const agent = createProviderResilienceAgent({
    registry: {
      primary: { name: "gemini", adapter: makeAdapter(async () => ({ provider: "gemini", model: "m", image: { base64: "abc", mimeType: "image/png" } })) },
      fallback: { name: "replicate-flux", adapter: makeAdapter(async () => { fallbackCalls += 1; return {}; }) }
    },
    logger
  });

  const result = await agent.generateImage({ correlationId: "corr-1" });

  assert.equal(result.provider, "gemini");
  assert.equal(fallbackCalls, 0);
  assert.ok(logger.events.some((e) => e.event === "generation_primary_started"));
  assert.equal(logger.events.some((e) => e.event === "generation_fallback_started"), false);
});

test("fallback-eligible primary failure -> fallback invoked and succeeds", async () => {
  const logger = collectLogger();
  const primaryError = new NormalizedProviderError("PROVIDER_TIMEOUT", "timed out", true, 408);
  const agent = createProviderResilienceAgent({
    registry: {
      primary: { name: "gemini", adapter: makeAdapter(async () => { throw primaryError; }) },
      fallback: { name: "replicate-flux", adapter: makeAdapter(async () => ({ provider: "replicate", model: "flux", image: { base64: "xyz", mimeType: "image/png" } })) }
    },
    logger
  });

  const result = await agent.generateImage({ correlationId: "corr-2" });

  assert.equal(result.provider, "replicate");
  assert.ok(logger.events.some((e) => e.event === "generation_primary_failed"));
  assert.ok(logger.events.some((e) => e.event === "generation_fallback_started"));
  assert.ok(logger.events.some((e) => e.event === "generation_fallback_succeeded"));
});

test("non-fallback-eligible failure (DAILY_LIMIT_EXCEEDED) -> fallback never invoked", async () => {
  let fallbackCalls = 0;
  const logger = collectLogger();
  const primaryError = new NormalizedProviderError("DAILY_LIMIT_EXCEEDED", "limit reached", false);
  const agent = createProviderResilienceAgent({
    registry: {
      primary: { name: "gemini", adapter: makeAdapter(async () => { throw primaryError; }) },
      fallback: { name: "replicate-flux", adapter: makeAdapter(async () => { fallbackCalls += 1; return {}; }) }
    },
    logger
  });

  await assert.rejects(() => agent.generateImage({ correlationId: "corr-3" }), (error) => {
    assert.equal(error.code, "DAILY_LIMIT_EXCEEDED");
    return true;
  });
  assert.equal(fallbackCalls, 0);
  assert.equal(logger.events.some((e) => e.event === "generation_fallback_started"), false);
});

test("no fallback configured -> primary failure rethrown unchanged (pre-existing behavior)", async () => {
  const logger = collectLogger();
  const primaryError = new NormalizedProviderError("PROVIDER_UNAVAILABLE", "down", true, 503);
  const agent = createProviderResilienceAgent({
    registry: {
      primary: { name: "gemini", adapter: makeAdapter(async () => { throw primaryError; }) },
      fallback: null
    },
    logger
  });

  await assert.rejects(() => agent.generateImage({ correlationId: "corr-4" }), (error) => {
    assert.equal(error, primaryError);
    return true;
  });
});

test("both providers failing -> final normalized error propagates, no crash", async () => {
  const logger = collectLogger();
  const primaryError = new NormalizedProviderError("PROVIDER_UNAVAILABLE", "primary down", true, 503);
  const fallbackError = new NormalizedProviderError("PROVIDER_TIMEOUT", "fallback timed out", true, 408);
  const agent = createProviderResilienceAgent({
    registry: {
      primary: { name: "gemini", adapter: makeAdapter(async () => { throw primaryError; }) },
      fallback: { name: "replicate-flux", adapter: makeAdapter(async () => { throw fallbackError; }) }
    },
    logger
  });

  await assert.rejects(() => agent.generateImage({ correlationId: "corr-5" }), (error) => {
    assert.equal(error, fallbackError);
    return true;
  });
  assert.ok(logger.events.some((e) => e.event === "generation_fallback_failed"));
});

test("never logs API tokens / auth headers / full prompt in failure events", async () => {
  const logger = collectLogger();
  const primaryError = new NormalizedProviderError("PROVIDER_TIMEOUT", "timed out", true, 408);
  const agent = createProviderResilienceAgent({
    registry: {
      primary: { name: "gemini", adapter: makeAdapter(async () => { throw primaryError; }) },
      fallback: null
    },
    logger
  });

  await assert.rejects(() => agent.generateImage({ correlationId: "corr-6", renderedPrompt: "a secret prompt with details" }));

  const serialized = JSON.stringify(logger.events);
  assert.equal(serialized.toLowerCase().includes("bearer"), false);
  assert.equal(serialized.toLowerCase().includes("apikey"), false);
  assert.equal(serialized.includes("a secret prompt with details"), false);
});
