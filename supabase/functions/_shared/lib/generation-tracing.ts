// ESM port of `js/services/logging/generation-tracing.js`. Logic unchanged.

import { createCorrelationId } from "./correlation-id.ts";

export interface Trace {
  correlationId: string;
  createdAt: string;
}

export function createGenerationTracing({
  createId = createCorrelationId,
  now = () => new Date().toISOString()
}: {
  createId?: (prefix?: string) => string;
  now?: () => string;
} = {}) {
  if (typeof createId !== "function") {
    throw new Error("createGenerationTracing requires createId() function.");
  }

  function startTrace(seed: { correlationId?: string } = {}): Trace {
    const incomingCorrelationId = String(seed.correlationId || "").trim();
    const correlationId = incomingCorrelationId || createId("gen");
    const createdAt = now();

    return {
      correlationId,
      createdAt
    };
  }

  // deno-lint-ignore no-explicit-any
  function buildGenerationTrace(trace: Trace, payload: any = {}) {
    return {
      correlationId: String(trace?.correlationId || ""),
      generationId: payload.generationId ? String(payload.generationId) : null,
      jobId: payload.jobId ? String(payload.jobId) : null,
      provider: payload.provider ? String(payload.provider) : null,
      model: payload.model ? String(payload.model) : null,
      promptVersion: payload.promptVersion ? String(payload.promptVersion) : null,
      status: payload.status ? String(payload.status) : null,
      durationMs: Number.isFinite(Number(payload.durationMs)) ? Number(payload.durationMs) : null,
      createdAt: payload.createdAt ? String(payload.createdAt) : String(trace?.createdAt || now())
    };
  }

  function buildErrorTrace(trace: Trace, errorCode: string, timestamp: string = now()) {
    return {
      correlationId: String(trace?.correlationId || ""),
      errorCode: String(errorCode || "UNKNOWN_ERROR"),
      timestamp: String(timestamp)
    };
  }

  return {
    startTrace,
    buildGenerationTrace,
    buildErrorTrace
  };
}
