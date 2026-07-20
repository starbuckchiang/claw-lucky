// ESM port of `js/services/ai/predictions/prediction-runner.js`. Logic
// unchanged: bounded synchronous polling now, webhook-ready interface shape
// for later.

// deno-lint-ignore no-explicit-any
export interface PredictionResult {
  terminal: boolean;
  status: string;
  // deno-lint-ignore no-explicit-any
  output?: any;
  // deno-lint-ignore no-explicit-any
  error?: any;
  // deno-lint-ignore no-explicit-any
  raw?: any;
  predictionId?: string;
}

export function createPredictionRunner({
  createPrediction,
  getPrediction,
  pollIntervalMs = 2000,
  maxPollAttempts = 30,
  wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
}: {
  // deno-lint-ignore no-explicit-any
  createPrediction: (input: any) => Promise<{ predictionId: string; status: string }>;
  // deno-lint-ignore no-explicit-any
  getPrediction: (predictionId: string) => Promise<any>;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  wait?: (ms: number) => Promise<void>;
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

  // deno-lint-ignore no-explicit-any
  async function create(input: any) {
    return createPrediction(input);
  }

  async function waitUntilTerminal(
    predictionId: string,
    { onProgress }: { onProgress?: (info: { predictionId: string; status: string; attempt: number }) => void | Promise<void> } = {}
  ): Promise<PredictionResult> {
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

      if (attempt < normalizedMaxAttempts - 1) {
        await wait(normalizedIntervalMs);
      }
    }

    return { terminal: false, status: "timeout", predictionId };
  }

  return { create, waitUntilTerminal };
}
