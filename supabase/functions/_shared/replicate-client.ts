// Deno-native Replicate HTTP client.
//
// This is the ONLY file in the Edge Function runtime that talks to the
// Replicate REST API directly (plain `fetch`, no SDK/npm dependency needed
// since Replicate's API is a simple REST/JSON API). It exists purely so
// `_shared/lib/replicate-flux-provider.ts` (provider-agnostic otherwise)
// can be reused unmodified: the client is constructed here and *injected*
// into `ReplicateFluxProvider` as its `client` constructor argument, mirroring
// the same pattern `gemini-client.ts` uses for Gemini (ADR-005: only the
// provider adapter itself may know about the concrete vendor API).
//
// Fallback is entirely OPTIONAL and config-driven: if `REPLICATE_API_TOKEN`
// is not set, `loadReplicateProviderConfig()` returns `null` and the caller
// (index.ts) simply does not configure a fallback provider — the Provider
// Resilience Agent then behaves exactly as it did before this feature
// existed (primary-only, no behavior change).
//
// Uses Replicate's official MODEL endpoint (`/v1/models/{owner}/{model}/predictions`),
// identified by a stable model slug (e.g. "black-forest-labs/flux-2-dev"),
// rather than a pinned version ID/hash.

import { parseReplicateModelSlug, buildReplicatePredictionsPath, buildReplicatePredictionRequestBody } from "./lib/replicate-model-config.ts";

export interface ReplicateProviderConfig {
  model: string;
  apiToken: string;
  pollIntervalMs: number;
  maxPollAttempts: number;
}

export function loadReplicateProviderConfig(): ReplicateProviderConfig | null {
  const apiToken = Deno.env.get("REPLICATE_API_TOKEN") ?? "";
  if (!apiToken) {
    // No fallback configured — this is the default, expected state until a
    // Replicate account/token is provisioned.
    return null;
  }

  const model = Deno.env.get("REPLICATE_MODEL") ?? "";
  if (!model) {
    throw new Error("REPLICATE_MODEL must be set when REPLICATE_API_TOKEN is configured.");
  }
  // Fail fast on startup if the slug isn't exactly "owner/model".
  parseReplicateModelSlug(model);

  return {
    model,
    apiToken,
    pollIntervalMs: Number(Deno.env.get("REPLICATE_POLL_INTERVAL_MS") ?? "2000"),
    maxPollAttempts: Number(Deno.env.get("REPLICATE_MAX_POLL_ATTEMPTS") ?? "30"),
  };
}

/**
 * Constructs a Deno-native Replicate client bound to a single model slug
 * (e.g. "black-forest-labs/flux-2-dev"). The returned object satisfies the
 * same shape `ReplicateFluxProvider` expects:
 * `client.createPrediction(input)` / `client.getPrediction(id)`.
 *
 * NEVER logs the API token; it is only ever sent as a request header.
 */
export function createDenoReplicateClient(apiToken: string, model: string) {
  const baseUrl = "https://api.replicate.com/v1";
  const predictionsPath = buildReplicatePredictionsPath(model);

  async function requestJson(path: string, options: RequestInit) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch (_error) {
      body = null;
    }

    if (!response.ok) {
      const error = new Error(
        (body as { detail?: string })?.detail || `Replicate API request failed (HTTP ${response.status}).`
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    return body as Record<string, unknown>;
  }

  return {
    async createPrediction(input: { input: Record<string, unknown> }) {
      const body = await requestJson(predictionsPath, {
        method: "POST",
        body: JSON.stringify(buildReplicatePredictionRequestBody(input.input)),
      });

      return {
        predictionId: String(body.id),
        status: String(body.status || "starting"),
      };
    },

    async getPrediction(predictionId: string) {
      const body = await requestJson(`/predictions/${encodeURIComponent(predictionId)}`, {
        method: "GET",
      });

      return {
        status: String(body.status || "processing"),
        output: body.output,
        error: body.error ?? null,
      };
    },
  };
}
