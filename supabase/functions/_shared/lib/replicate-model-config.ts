// ESM port of `js/services/ai/providers/replicate-model-config.js`. Logic
// unchanged — pure functions, no Deno/env/network dependency. See that file
// for the full rationale.

const MODEL_SLUG_PATTERN = /^([^/\s]+)\/([^/\s]+)$/;

export function parseReplicateModelSlug(model: string): { owner: string; name: string } {
  const value = String(model || "").trim();
  const match = MODEL_SLUG_PATTERN.exec(value);
  if (!match) {
    throw new Error(`REPLICATE_MODEL must be in "owner/model" format, got: "${value}".`);
  }
  return { owner: match[1], name: match[2] };
}

export function buildReplicatePredictionsPath(model: string): string {
  const { owner, name } = parseReplicateModelSlug(model);
  return `/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`;
}

export function buildReplicatePredictionRequestBody(
  input: Record<string, unknown>
): { input: Record<string, unknown> } {
  return { input };
}
