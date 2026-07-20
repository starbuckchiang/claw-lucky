// ESM port of `js/services/ai/agents/provider-resilience-agent.js`. Logic
// unchanged. See that file for the full rationale (smallest integration
// point: exposes the exact same `generateImage(input)` contract a single
// ProviderAdapter exposes today).

import { toProviderErrorInfo } from "./provider-error.ts";
import { isFallbackEligible } from "./fallback-policy.ts";
import type { ProviderAdapter } from "./provider-adapter.ts";

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
