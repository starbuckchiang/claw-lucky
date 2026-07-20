"use strict";

/**
 * Replicate FLUX Provider.
 *
 * Same shape/contract as GeminiProvider (js/services/ai/gemini-provider.js):
 * `constructor({ config, client, logger })`, `async generateWallpaper(input)`
 * returning `{ provider, model, durationMs, image: { base64, mimeType },
 * providerRequestId, correlationId }` or throwing `NormalizedProviderError`.
 * This is what lets it slot into the SAME `providers/provider-registry.js`
 * wiring (wrapped in the existing `ProviderAdapter` retry class) as Gemini,
 * with zero changes to generation-service.js / wallpaper-provider-adapter.js.
 *
 * The `client` is injected (never constructed here) — see
 * `supabase/functions/_shared/replicate-client.ts` for the real Deno-native
 * HTTP client. This file never touches an API token directly.
 *
 * IMPORTANT: the temporary Replicate output URL is downloaded and converted
 * to base64 HERE, then handed off through the exact same
 * `wallpaper-provider-adapter.js` -> Storage Service path Gemini output uses
 * today. The temporary Replicate URL itself is NEVER returned/persisted as
 * the final wallpaper URL (requirement: only the Storage Service's signed
 * URL is ever the final URL).
 */

const { NormalizedProviderError } = require("../provider-types.js");
const { createPredictionRunner } = require("../predictions/prediction-runner.js");

function mapReplicatePredictionFailure(prediction) {
  const status = prediction?.status || "failed";
  const message = prediction?.error ? String(prediction.error) : `Replicate prediction ${status}.`;
  return new NormalizedProviderError(
    "PROVIDER_UNAVAILABLE",
    message,
    true,
    null,
    null,
    { predictionStatus: status }
  );
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  // deno-lint-ignore no-undef
  return btoa(binary);
}

class ReplicateFluxProvider {
  #client;
  #config;
  #logger;
  #runner;
  #fetchImpl;

  constructor({ config, client, logger, predictionRunner, fetchImpl }) {
    if (!client || typeof client.createPrediction !== "function" || typeof client.getPrediction !== "function") {
      throw new TypeError(
        "ReplicateFluxProvider requires a client with createPrediction()/getPrediction() methods."
      );
    }
    if (!config) throw new Error("ReplicateFluxProvider: config is required.");
    if (!logger) throw new Error("ReplicateFluxProvider: logger is required.");

    this.#client = client;
    this.#config = config;
    this.#logger = logger;
    this.#fetchImpl = typeof fetchImpl === "function" ? fetchImpl : fetch;
    this.#runner = predictionRunner || createPredictionRunner({
      createPrediction: (input) => client.createPrediction(input),
      getPrediction: (id) => client.getPrediction(id),
      pollIntervalMs: config.pollIntervalMs,
      maxPollAttempts: config.maxPollAttempts
    });
  }

  async generateWallpaper(input) {
    const { renderedPrompt, correlationId, aspectRatio = "9:16" } = input;
    const started = Date.now();

    let prediction;
    try {
      prediction = await this.#runner.create({
        input: {
          prompt: renderedPrompt,
          aspect_ratio: aspectRatio
        }
      });
    } catch (createError) {
      this.#logger.error({
        event: "replicate_prediction_create_failed",
        correlationId,
        message: createError?.message || "unknown"
      });
      throw new NormalizedProviderError(
        "PROVIDER_UNAVAILABLE",
        "Failed to create Replicate prediction.",
        true,
        createError?.status ?? null,
        null,
        null
      );
    }

    this.#logger.info({
      event: "replicate_prediction_created",
      correlationId,
      predictionId: prediction.predictionId,
      model: this.#config.model
    });

    const result = await this.#runner.waitUntilTerminal(prediction.predictionId, {
      onProgress: ({ status }) => {
        this.#logger.info({
          event: "replicate_prediction_processing",
          correlationId,
          predictionId: prediction.predictionId,
          status
        });
      }
    });

    if (!result.terminal) {
      throw new NormalizedProviderError(
        "PROVIDER_TIMEOUT",
        "Replicate prediction polling timed out.",
        true,
        null,
        null,
        { predictionId: prediction.predictionId }
      );
    }

    if (result.status !== "succeeded") {
      throw mapReplicatePredictionFailure(result.raw);
    }

    const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
    if (!outputUrl || typeof outputUrl !== "string") {
      throw new NormalizedProviderError(
        "PROVIDER_INVALID_RESPONSE",
        "Replicate prediction succeeded but returned no image output.",
        false,
        null,
        null,
        { predictionId: prediction.predictionId }
      );
    }

    let base64;
    let mimeType = "image/png";
    try {
      const response = await this.#fetchImpl(outputUrl);
      if (!response.ok) {
        throw new Error(`Failed to download Replicate output (HTTP ${response.status})`);
      }
      mimeType = response.headers?.get?.("content-type") || mimeType;
      const arrayBuffer = await response.arrayBuffer();
      base64 = bytesToBase64(new Uint8Array(arrayBuffer));
    } catch (downloadError) {
      throw new NormalizedProviderError(
        "PROVIDER_UNAVAILABLE",
        "Failed to download Replicate prediction output.",
        true,
        null,
        null,
        { predictionId: prediction.predictionId, reason: downloadError?.message || "unknown" }
      );
    }

    return {
      provider: "replicate",
      model: this.#config.model,
      durationMs: Date.now() - started,
      image: { base64, mimeType },
      providerRequestId: prediction.predictionId,
      correlationId
    };
  }
}

module.exports = { ReplicateFluxProvider };
