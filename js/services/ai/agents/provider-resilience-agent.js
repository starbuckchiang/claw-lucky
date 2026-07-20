"use strict";

/**
 * Provider Resilience Agent.
 *
 * A deterministic APPLICATION WORKFLOW (not an autonomous/LLM agent): given
 * a resolved provider registry (primary + optional fallback), it executes
 * the primary provider, and — ONLY when the fallback policy says the
 * failure is fallback-eligible — executes exactly ONE fallback attempt.
 *
 * Integration point (deliberately the SMALLEST possible): this exposes the
 * exact same `generateImage(input)` contract a single `ProviderAdapter`
 * instance exposes today (js/services/ai/provider-adapter.js). It is a
 * drop-in replacement for the `rawProviderAdapter` that
 * `wallpaper-provider-adapter.js` wraps — nothing downstream
 * (wallpaper-provider-adapter.js, generation-service.js,
 * generation-orchestrator.js, Storage Service, frontend polling contract)
 * changes at all.
 *
 * Bounded by design: exactly one primary attempt (with its OWN existing
 * bounded retry) and exactly one fallback provider attempt (also with its
 * own existing bounded retry) — never a chain of multiple fallback
 * providers.
 */

const { toProviderErrorInfo } = require("../contracts/provider-error.js");
const { isFallbackEligible } = require("../fallback/fallback-policy.js");

function createProviderResilienceAgent({ registry, logger }) {
  if (!registry || !registry.primary || typeof registry.primary.adapter?.generateImage !== "function") {
    throw new Error("createProviderResilienceAgent requires registry.primary.adapter.generateImage(input).");
  }

  const safeLogger = logger || { info: () => {}, error: () => {} };

  async function generateImage(input) {
    const correlationId = String(input?.correlationId || "").trim();
    const primaryName = registry.primary.name;

    safeLogger.info({
      event: "generation_primary_started",
      correlationId,
      provider: primaryName
    });

    try {
      return await registry.primary.adapter.generateImage(input);
    } catch (primaryError) {
      safeLogger.error({
        event: "generation_primary_failed",
        ...toProviderErrorInfo(primaryError, primaryName, correlationId)
      });

      const eligible = Boolean(registry.fallback) && isFallbackEligible({
        failureCode: primaryError?.code,
        diagnostics: primaryError?.diagnostics || null
      });

      if (!eligible) {
        throw primaryError;
      }

      const fallbackName = registry.fallback.name;

      safeLogger.info({
        event: "generation_fallback_started",
        correlationId,
        provider: fallbackName
      });

      try {
        const fallbackResult = await registry.fallback.adapter.generateImage(input);

        safeLogger.info({
          event: "generation_fallback_succeeded",
          correlationId,
          provider: fallbackName
        });

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

module.exports = { createProviderResilienceAgent };
