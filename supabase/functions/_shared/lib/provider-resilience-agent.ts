// ESM port of `js/services/ai/agents/provider-resilience-agent.js`. Logic
// unchanged. See that file for the full rationale (smallest integration
// point: exposes the exact same `generateImage(input)` contract a single
// ProviderAdapter exposes today).

import { toProviderErrorInfo } from "./provider-error.ts";
import { isFallbackEligible } from "./fallback-policy.ts";
import type { ProviderAdapter } from "./provider-adapter.ts";

// TEMPORARY diagnostic helper (P2-AI-03 error-tracing investigation):
// extracts the first stack frame that references this project's own files,
// so we can pinpoint where an exception actually originated without ever
// logging prompt/image/secret content.
function firstProjectStackLine(stack: unknown): string | null {
  if (typeof stack !== "string") return null;
  const lines = stack.split("\n").slice(1);
  const projectLine = lines.find((line) => line.includes("services") || line.includes("supabase")) || lines[0];
  return projectLine ? projectLine.trim() : null;
}

// TEMPORARY diagnostic (P2-AI-03 error-tracing investigation): logs the RAW
// error's type/name/message/stack/cause BEFORE any normalization
// (toProviderErrorInfo) or fallback-eligibility decision. Never logs API
// keys, tokens, prompt text, or image data.
// deno-lint-ignore no-explicit-any
function logRawException(event: string, correlationId: string, error: any): void {
  console.error(JSON.stringify({
    level: "error",
    event,
    correlationId,
    errorType: error?.constructor?.name || null,
    errorName: error?.name || null,
    errorMessage: error?.message || null,
    firstProjectStackLine: firstProjectStackLine(error?.stack),
    causeName: error?.cause?.name || null,
    causeMessage: error?.cause?.message || null,
    causeStackLine: firstProjectStackLine(error?.cause?.stack)
  }));
}

export interface ProviderRegistryEntry {
  name: string;
  adapter: ProviderAdapter;
}

export interface ProviderRegistry {
  primary: ProviderRegistryEntry;
  fallback: ProviderRegistryEntry | null;
}

export function createProviderResilienceAgent({
  registry,
  logger
}: {
  registry: ProviderRegistry;
  // deno-lint-ignore no-explicit-any
  logger?: any;
}) {
  if (!registry || !registry.primary || typeof registry.primary.adapter?.generateImage !== "function") {
    throw new Error("createProviderResilienceAgent requires registry.primary.adapter.generateImage(input).");
  }

  const safeLogger = logger || { info: () => {}, error: () => {} };

  // deno-lint-ignore no-explicit-any
  async function generateImage(input: any) {
    const correlationId = String(input?.correlationId || "").trim();
    const primaryName = registry.primary.name;

    safeLogger.info({ event: "generation_primary_started", correlationId, provider: primaryName });

    try {
      return await registry.primary.adapter.generateImage(input);
    } catch (primaryError) {
      // Raw error logged BEFORE toProviderErrorInfo() normalizes it and
      // BEFORE the fallback-eligibility decision below.
      logRawException("generation_primary_failed_raw", correlationId, primaryError);

      safeLogger.error({
        event: "generation_primary_failed",
        ...toProviderErrorInfo(primaryError, primaryName, correlationId)
      });

      const eligible = Boolean(registry.fallback) && isFallbackEligible({
        // deno-lint-ignore no-explicit-any
        failureCode: (primaryError as any)?.code,
        // deno-lint-ignore no-explicit-any
        diagnostics: (primaryError as any)?.diagnostics || null
      });

      // TEMPORARY diagnostic: confirms the EXACT failureCode isFallbackEligible()
      // actually received, and whether fallback was even configured.
      console.error(JSON.stringify({
        level: "error",
        event: "generation_fallback_eligibility_check",
        correlationId,
        // deno-lint-ignore no-explicit-any
        failureCode: (primaryError as any)?.code || null,
        fallbackConfigured: Boolean(registry.fallback),
        eligible
      }));

      if (!eligible) {
        throw primaryError;
      }

      const fallbackName = registry.fallback!.name;

      safeLogger.info({ event: "generation_fallback_started", correlationId, provider: fallbackName });

      try {
        const fallbackResult = await registry.fallback!.adapter.generateImage(input);

        safeLogger.info({ event: "generation_fallback_succeeded", correlationId, provider: fallbackName });

        return fallbackResult;
      } catch (fallbackError) {
        logRawException("generation_fallback_failed_raw", correlationId, fallbackError);

        safeLogger.error({
          event: "generation_fallback_failed",
          ...toProviderErrorInfo(fallbackError, fallbackName, correlationId)
        });

        throw fallbackError;
      }
    }
  }

  return { generateImage };
}
