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

// TEMPORARY diagnostic helper (P2-AI-03 error-tracing investigation):
// extracts the first stack frame that references this project's own files,
// so we can pinpoint where an exception actually originated without ever
// logging prompt/image/secret content.
function firstProjectStackLine(stack) {
  if (typeof stack !== "string") return null;
  const lines = stack.split("\n").slice(1);
  const projectLine = lines.find((line) => line.includes("services") || line.includes("supabase")) || lines[0];
  return projectLine ? projectLine.trim() : null;
}

// TEMPORARY diagnostic (P2-AI-03 error-tracing investigation): logs the RAW
// error's type/name/message/stack/cause BEFORE any normalization
// (toProviderErrorInfo) or fallback-eligibility decision. Never logs API
// keys, tokens, prompt text, or image data.
function logRawException(event, correlationId, error) {
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
      // Raw error logged BEFORE toProviderErrorInfo() normalizes it and
      // BEFORE the fallback-eligibility decision below.
      logRawException("generation_primary_failed_raw", correlationId, primaryError);

      safeLogger.error({
        event: "generation_primary_failed",
        ...toProviderErrorInfo(primaryError, primaryName, correlationId)
      });

      const eligible = Boolean(registry.fallback) && isFallbackEligible({
        failureCode: primaryError?.code,
        diagnostics: primaryError?.diagnostics || null
      });

      // TEMPORARY diagnostic: confirms the EXACT failureCode isFallbackEligible()
      // actually received, and whether fallback was even configured.
      console.error(JSON.stringify({
        level: "error",
        event: "generation_fallback_eligibility_check",
        correlationId,
        failureCode: primaryError?.code || null,
        fallbackConfigured: Boolean(registry.fallback),
        eligible
      }));

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

module.exports = { createProviderResilienceAgent };
