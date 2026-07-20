"use strict";

/**
 * Pure, provider-agnostic helpers for Replicate's "model slug" (e.g.
 * "black-forest-labs/flux-2-dev") based prediction API.
 *
 * Extracted as its own module (no Deno/env/network dependency) purely so
 * this validation/URL-building logic is Node-testable — the Deno-only
 * `supabase/functions/_shared/replicate-client.ts` imports the ESM twin of
 * this file and re-uses it unchanged, keeping a single source of truth for
 * the "owner/model" format contract.
 */

const MODEL_SLUG_PATTERN = /^([^/\s]+)\/([^/\s]+)$/;

/**
 * Parses a Replicate model slug ("owner/model") into its two parts.
 * Throws a clear configuration error if the format is not EXACTLY
 * "owner/model" (no missing/empty parts, no extra path segments).
 *
 * @param {string} model
 * @returns {{ owner: string, name: string }}
 */
function parseReplicateModelSlug(model) {
  const value = String(model || "").trim();
  const match = MODEL_SLUG_PATTERN.exec(value);
  if (!match) {
    throw new Error(`REPLICATE_MODEL must be in "owner/model" format, got: "${value}".`);
  }
  return { owner: match[1], name: match[2] };
}

/**
 * Builds the official Replicate "model predictions" endpoint path:
 * POST /v1/models/{owner}/{model}/predictions
 *
 * @param {string} model - "owner/model" slug, e.g. "black-forest-labs/flux-2-dev"
 * @returns {string} path relative to the Replicate API base URL
 */
function buildReplicatePredictionsPath(model) {
  const { owner, name } = parseReplicateModelSlug(model);
  return `/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`;
}

/**
 * Builds the request body for the model-endpoint predictions call. The
 * official model endpoint takes ONLY `input` — no `version` field (that
 * field only applies to the generic `/v1/predictions` version-based
 * endpoint, which this feature no longer uses).
 *
 * @param {Record<string, unknown>} input
 * @returns {{ input: Record<string, unknown> }}
 */
function buildReplicatePredictionRequestBody(input) {
  return { input };
}

module.exports = {
  parseReplicateModelSlug,
  buildReplicatePredictionsPath,
  buildReplicatePredictionRequestBody
};
