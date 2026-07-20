"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createProviderRegistry } = require("../providers/provider-registry");
const { GeminiProvider } = require("../gemini-provider");
const { ReplicateFluxProvider } = require("../providers/replicate-flux-provider");

const logger = { info: () => {}, error: () => {} };

test("builds a primary-only registry (no fallback configured)", () => {
  const geminiClient = { models: { generateContent: async () => ({}) } };
  const registry = createProviderRegistry({
    primary: { name: "gemini", config: { model: "gemini-2.5-flash-image", maxRetry: 1 }, client: geminiClient, logger }
  });

  assert.equal(registry.primary.name, "gemini");
  assert.equal(typeof registry.primary.adapter.generateImage, "function");
  assert.equal(registry.fallback, null);
});

test("builds a primary + fallback registry", () => {
  const geminiClient = { models: { generateContent: async () => ({}) } };
  const replicateClient = { createPrediction: async () => ({}), getPrediction: async () => ({}) };

  const registry = createProviderRegistry({
    primary: { name: "gemini", config: { model: "gemini-2.5-flash-image", maxRetry: 1 }, client: geminiClient, logger },
    fallback: { name: "replicate-flux", config: { model: "black-forest-labs/flux-2-dev", maxRetry: 1 }, client: replicateClient, logger }
  });

  assert.equal(registry.fallback.name, "replicate-flux");
  assert.equal(typeof registry.fallback.adapter.generateImage, "function");
});

test("throws for an unsupported provider name", () => {
  assert.throws(() => createProviderRegistry({
    primary: { name: "unknown-provider", config: {}, client: {}, logger }
  }));
});

test("sanity: builders return the expected concrete provider classes", () => {
  const { buildRawProvider } = require("../providers/provider-registry");
  const geminiInstance = buildRawProvider("gemini", { config: { model: "m" }, client: { models: { generateContent: async () => ({}) } }, logger });
  assert.ok(geminiInstance instanceof GeminiProvider);

  const replicateInstance = buildRawProvider("replicate-flux", { config: { model: "black-forest-labs/flux-2-dev" }, client: { createPrediction: async () => ({}), getPrediction: async () => ({}) }, logger });
  assert.ok(replicateInstance instanceof ReplicateFluxProvider);
});
