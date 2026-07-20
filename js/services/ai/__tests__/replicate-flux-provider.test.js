"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { ReplicateFluxProvider } = require("../providers/replicate-flux-provider");

const baseConfig = {
  model: "black-forest-labs/flux-2-dev",
  pollIntervalMs: 1,
  maxPollAttempts: 3
};

const logger = { info: () => {}, error: () => {} };

function noWaitRunner(overrides = {}) {
  return {
    async create() {
      return { predictionId: "pred-1", status: "starting" };
    },
    async waitUntilTerminal() {
      return { terminal: true, status: "succeeded", output: ["https://replicate.example/output.png"] };
    },
    ...overrides
  };
}

function mockFetchSuccess() {
  return async () => ({
    ok: true,
    headers: { get: () => "image/png" },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
  });
}

test("Replicate prediction success -> normalized GenerationResult contract", async () => {
  const client = { createPrediction: async () => ({}), getPrediction: async () => ({}) };
  const provider = new ReplicateFluxProvider({
    config: baseConfig,
    client,
    logger,
    predictionRunner: noWaitRunner(),
    fetchImpl: mockFetchSuccess()
  });

  const result = await provider.generateWallpaper({ renderedPrompt: "a lucky bear", correlationId: "corr-1" });

  assert.equal(result.provider, "replicate");
  assert.equal(result.model, baseConfig.model);
  assert.equal(typeof result.image.base64, "string");
  assert.equal(result.image.mimeType, "image/png");
  assert.equal(result.providerRequestId, "pred-1");
  // Never leak the temporary Replicate output URL as if it were the final URL.
  assert.equal("imageUrl" in result, false);
});

test("Replicate prediction failure -> normalized PROVIDER_UNAVAILABLE error", async () => {
  const client = { createPrediction: async () => ({}), getPrediction: async () => ({}) };
  const provider = new ReplicateFluxProvider({
    config: baseConfig,
    client,
    logger,
    predictionRunner: noWaitRunner({
      async waitUntilTerminal() {
        return { terminal: true, status: "failed", error: "NSFW content detected", raw: { status: "failed", error: "NSFW content detected" } };
      }
    }),
    fetchImpl: mockFetchSuccess()
  });

  await assert.rejects(
    () => provider.generateWallpaper({ renderedPrompt: "x", correlationId: "corr-2" }),
    (error) => {
      assert.equal(error.code, "PROVIDER_UNAVAILABLE");
      assert.equal(error.retryable, true);
      assert.match(error.message, /NSFW/);
      return true;
    }
  );
});

test("Replicate prediction polling timeout -> normalized PROVIDER_TIMEOUT error", async () => {
  const client = { createPrediction: async () => ({}), getPrediction: async () => ({}) };
  const provider = new ReplicateFluxProvider({
    config: baseConfig,
    client,
    logger,
    predictionRunner: noWaitRunner({
      async waitUntilTerminal() {
        return { terminal: false, status: "timeout", predictionId: "pred-1" };
      }
    }),
    fetchImpl: mockFetchSuccess()
  });

  await assert.rejects(
    () => provider.generateWallpaper({ renderedPrompt: "x", correlationId: "corr-3" }),
    (error) => {
      assert.equal(error.code, "PROVIDER_TIMEOUT");
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("invalid Replicate output (no image) -> normalized PROVIDER_INVALID_RESPONSE error", async () => {
  const client = { createPrediction: async () => ({}), getPrediction: async () => ({}) };
  const provider = new ReplicateFluxProvider({
    config: baseConfig,
    client,
    logger,
    predictionRunner: noWaitRunner({
      async waitUntilTerminal() {
        return { terminal: true, status: "succeeded", output: [] };
      }
    }),
    fetchImpl: mockFetchSuccess()
  });

  await assert.rejects(
    () => provider.generateWallpaper({ renderedPrompt: "x", correlationId: "corr-4" }),
    (error) => {
      assert.equal(error.code, "PROVIDER_INVALID_RESPONSE");
      assert.equal(error.retryable, false);
      return true;
    }
  );
});

test("emits replicate_prediction_created and replicate_prediction_processing events", async () => {
  const events = [];
  const trackingLogger = {
    info: (entry) => events.push(entry.event),
    error: () => {}
  };
  const client = { createPrediction: async () => ({}), getPrediction: async () => ({}) };
  const provider = new ReplicateFluxProvider({
    config: baseConfig,
    client,
    logger: trackingLogger,
    predictionRunner: {
      async create() {
        return { predictionId: "pred-5", status: "starting" };
      },
      async waitUntilTerminal(_id, { onProgress }) {
        await onProgress({ status: "processing" });
        return { terminal: true, status: "succeeded", output: "https://replicate.example/out.png" };
      }
    },
    fetchImpl: mockFetchSuccess()
  });

  await provider.generateWallpaper({ renderedPrompt: "x", correlationId: "corr-5" });

  assert.ok(events.includes("replicate_prediction_created"));
  assert.ok(events.includes("replicate_prediction_processing"));
});

test("never logs the API token / Authorization header", async () => {
  const loggedEntries = [];
  const trackingLogger = {
    info: (entry) => loggedEntries.push(entry),
    error: (entry) => loggedEntries.push(entry)
  };
  const client = { createPrediction: async () => ({}), getPrediction: async () => ({}) };
  const provider = new ReplicateFluxProvider({
    config: baseConfig,
    client,
    logger: trackingLogger,
    predictionRunner: noWaitRunner(),
    fetchImpl: mockFetchSuccess()
  });

  await provider.generateWallpaper({ renderedPrompt: "secret prompt content", correlationId: "corr-6" });

  const serialized = JSON.stringify(loggedEntries);
  assert.equal(serialized.toLowerCase().includes("bearer"), false);
  assert.equal(serialized.toLowerCase().includes("authorization"), false);
  assert.equal(serialized.includes("secret prompt content"), false);
});

test("generateWallpaper never sends a version field to the prediction runner (model endpoint contract)", async () => {
  let capturedCreateInput = null;
  const client = { createPrediction: async () => ({}), getPrediction: async () => ({}) };
  const provider = new ReplicateFluxProvider({
    config: baseConfig,
    client,
    logger,
    predictionRunner: {
      async create(input) {
        capturedCreateInput = input;
        return { predictionId: "pred-7", status: "starting" };
      },
      async waitUntilTerminal() {
        return { terminal: true, status: "succeeded", output: ["https://replicate.example/output.png"] };
      }
    },
    fetchImpl: mockFetchSuccess()
  });

  await provider.generateWallpaper({ renderedPrompt: "a lucky bear", correlationId: "corr-7" });

  assert.ok(capturedCreateInput, "prediction runner create() should have been called");
  assert.equal("version" in capturedCreateInput, false);
  assert.equal("model" in capturedCreateInput, false);
  assert.deepEqual(Object.keys(capturedCreateInput), ["input"]);
  assert.equal(capturedCreateInput.input.prompt, "a lucky bear");
});

test("structured log and provider result report the model slug, not a version id", async () => {
  const events = [];
  const trackingLogger = {
    info: (entry) => events.push(entry),
    error: () => {}
  };
  const client = { createPrediction: async () => ({}), getPrediction: async () => ({}) };
  const provider = new ReplicateFluxProvider({
    config: baseConfig,
    client,
    logger: trackingLogger,
    predictionRunner: noWaitRunner(),
    fetchImpl: mockFetchSuccess()
  });

  const result = await provider.generateWallpaper({ renderedPrompt: "x", correlationId: "corr-8" });

  const createdEvent = events.find((entry) => entry.event === "replicate_prediction_created");
  assert.equal(createdEvent.model, "black-forest-labs/flux-2-dev");
  assert.equal(result.model, "black-forest-labs/flux-2-dev");
});
