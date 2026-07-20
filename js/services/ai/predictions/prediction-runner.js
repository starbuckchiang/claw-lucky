"use strict";

/**
 * Bounded-polling Prediction Runner.
 *
 * Generic (provider-agnostic) helper for "create async job -> poll until
 * terminal" workflows. Used today by replicate-flux-provider.js for
 * Replicate's asynchronous predictions API, but intentionally has no
 * Replicate-specific knowledge itself.
 *
 * Phase 1 (this implementation): bounded synchronous polling within a single
 * call. The interface is deliberately shaped so a future
 * `resolveFromWebhook(payload)` can be added later returning the SAME
 * `{ terminal, status, output|error, raw }` result shape, without changing
 * any caller.
 */
function createPredictionRunner({
  createPrediction,
  getPrediction,
  pollIntervalMs = 2000,
  maxPollAttempts = 30,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  if (typeof createPrediction !== "function") {
    throw new Error("createPredictionRunner requires createPrediction(input).");
  }
  if (typeof getPrediction !== "function") {
    throw new Error("createPredictionRunner requires getPrediction(predictionId).");
  }

  const normalizedIntervalMs = Number.isFinite(Number(pollIntervalMs)) ? Math.max(100, Number(pollIntervalMs)) : 2000;
  const normalizedMaxAttempts = Number.isFinite(Number(maxPollAttempts)) ? Math.max(1, Number(maxPollAttempts)) : 30;

  const TERMINAL_SUCCESS = new Set(["succeeded"]);
  const TERMINAL_FAILURE = new Set(["failed", "canceled", "cancelled"]);

  async function create(input) {
    return createPrediction(input); // expected shape: { predictionId, status }
  }

  async function waitUntilTerminal(predictionId, { onProgress } = {}) {
    for (let attempt = 0; attempt < normalizedMaxAttempts; attempt += 1) {
      const prediction = await getPrediction(predictionId);
      const status = String(prediction?.status || "").trim();

      if (typeof onProgress === "function") {
        await onProgress({ predictionId, status, attempt });
      }

      if (TERMINAL_SUCCESS.has(status)) {
        return { terminal: true, status: "succeeded", output: prediction.output, raw: prediction };
      }

      if (TERMINAL_FAILURE.has(status)) {
        return { terminal: true, status: "failed", error: prediction.error || null, raw: prediction };
      }

      // "starting" | "processing" | any other in-flight status -> keep polling
      if (attempt < normalizedMaxAttempts - 1) {
        await wait(normalizedIntervalMs);
      }
    }

    return { terminal: false, status: "timeout", predictionId };
  }

  return { create, waitUntilTerminal };
}

module.exports = { createPredictionRunner };
