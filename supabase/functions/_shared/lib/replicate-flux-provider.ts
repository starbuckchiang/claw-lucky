// ESM port of `js/services/ai/providers/replicate-flux-provider.js`. Logic
// unchanged. See that file for the full rationale (temporary Replicate URL
// is downloaded + base64-encoded HERE, never persisted/returned as the
// final wallpaper URL — only the existing Storage Service's signed URL is).

import { NormalizedProviderError } from "./provider-types.ts";
import { createPredictionRunner } from "./prediction-runner.ts";

// deno-lint-ignore no-explicit-any
function mapReplicatePredictionFailure(prediction: any): NormalizedProviderError {
  const status = prediction?.status || "failed";
  const message = prediction?.error ? String(prediction.error) : `Replicate prediction ${status}.`;
  return new NormalizedProviderError("PROVIDER_UNAVAILABLE", message, true, undefined, null, { predictionStatus: status });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

export interface ReplicateClient {
  // deno-lint-ignore no-explicit-any
  createPrediction(input: any): Promise<{ predictionId: string; status: string }>;
  // deno-lint-ignore no-explicit-any
  getPrediction(predictionId: string): Promise<any>;
}

export class ReplicateFluxProvider {
  #client: ReplicateClient;
  // deno-lint-ignore no-explicit-any
  #config: any;
  // deno-lint-ignore no-explicit-any
  #logger: any;
  // deno-lint-ignore no-explicit-any
  #runner: any;
  #fetchImpl: typeof fetch;

  constructor(
    {
      config,
      client,
      logger,
      predictionRunner,
      fetchImpl
      // deno-lint-ignore no-explicit-any
    }: { config: any; client: ReplicateClient; logger: any; predictionRunner?: any; fetchImpl?: typeof fetch }
  ) {
    if (!client || typeof client.createPrediction !== "function" || typeof client.getPrediction !== "function") {
      throw new TypeError("ReplicateFluxProvider requires a client with createPrediction()/getPrediction() methods.");
    }
    if (!config) throw new Error("ReplicateFluxProvider: config is required.");
    if (!logger) throw new Error("ReplicateFluxProvider: logger is required.");

    this.#client = client;
    this.#config = config;
    this.#logger = logger;
    this.#fetchImpl = fetchImpl || fetch;
    this.#runner = predictionRunner || createPredictionRunner({
      createPrediction: (input) => client.createPrediction(input),
      getPrediction: (id) => client.getPrediction(id),
      pollIntervalMs: config.pollIntervalMs,
      maxPollAttempts: config.maxPollAttempts
    });
  }

  // deno-lint-ignore no-explicit-any
  async generateWallpaper(input: any) {
    const { renderedPrompt, correlationId, aspectRatio = "9:16" } = input;
    const started = Date.now();

    // deno-lint-ignore no-explicit-any
    let prediction: any;
    try {
      prediction = await this.#runner.create({
        input: { prompt: renderedPrompt, aspect_ratio: aspectRatio }
      });
    } catch (createError) {
      this.#logger.error({
        event: "replicate_prediction_create_failed",
        correlationId,
        message: (createError as Error)?.message || "unknown"
      });
      throw new NormalizedProviderError("PROVIDER_UNAVAILABLE", "Failed to create Replicate prediction.", true, undefined, null, null);
    }

    this.#logger.info({
      event: "replicate_prediction_created",
      correlationId,
      predictionId: prediction.predictionId,
      model: this.#config.model
    });

    const result = await this.#runner.waitUntilTerminal(prediction.predictionId, {
      onProgress: ({ status }: { status: string }) => {
        this.#logger.info({
          event: "replicate_prediction_processing",
          correlationId,
          predictionId: prediction.predictionId,
          status
        });
      }
    });

    if (!result.terminal) {
      throw new NormalizedProviderError("PROVIDER_TIMEOUT", "Replicate prediction polling timed out.", true, undefined, null, { predictionId: prediction.predictionId });
    }

    if (result.status !== "succeeded") {
      throw mapReplicatePredictionFailure(result.raw);
    }

    const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
    if (!outputUrl || typeof outputUrl !== "string") {
      throw new NormalizedProviderError("PROVIDER_INVALID_RESPONSE", "Replicate prediction succeeded but returned no image output.", false, undefined, null, { predictionId: prediction.predictionId });
    }

    let base64: string;
    let mimeType = "image/png";
    try {
      const response = await this.#fetchImpl(outputUrl);
      if (!response.ok) {
        throw new Error(`Failed to download Replicate output (HTTP ${response.status})`);
      }
      mimeType = response.headers.get("content-type") || mimeType;
      const arrayBuffer = await response.arrayBuffer();
      base64 = bytesToBase64(new Uint8Array(arrayBuffer));
    } catch (downloadError) {
      throw new NormalizedProviderError(
        "PROVIDER_UNAVAILABLE",
        "Failed to download Replicate prediction output.",
        true,
        undefined,
        null,
        { predictionId: prediction.predictionId, reason: (downloadError as Error)?.message || "unknown" }
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
