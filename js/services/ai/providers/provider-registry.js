"use strict";

/**
 * Provider Registry.
 *
 * Resolves the configured primary and (optional) fallback provider into
 * ready-to-use `ProviderAdapter` instances (retry logic REUSED unchanged
 * from js/services/ai/provider-adapter.js — no new retry logic here).
 *
 * This is a deterministic, configuration-driven lookup — it does not decide
 * WHEN to fall back (see fallback/fallback-policy.js); it only knows HOW to
 * build a provider instance for a given name.
 */

const { ProviderAdapter } = require("../provider-adapter.js");
const { GeminiProvider } = require("../gemini-provider.js");
const { ReplicateFluxProvider } = require("./replicate-flux-provider.js");

const PROVIDER_BUILDERS = Object.freeze({
  gemini({ config, client, logger }) {
    return new GeminiProvider({ config, client, logger });
  },
  "replicate-flux": ({ config, client, logger }) => {
    return new ReplicateFluxProvider({ config, client, logger });
  }
});

function buildRawProvider(providerName, deps) {
  const builder = PROVIDER_BUILDERS[providerName];
  if (typeof builder !== "function") {
    throw new Error(`Unsupported provider: ${providerName}`);
  }
  return builder(deps);
}

/**
 * @param {object} params
 * @param {object} params.primary - { name, config, client, logger }
 * @param {object} [params.fallback] - { name, config, client, logger } or omitted/null to disable fallback
 */
function createProviderRegistry({ primary, fallback }) {
  if (!primary || !primary.name) {
    throw new Error("createProviderRegistry requires primary.name.");
  }

  const primaryRawProvider = buildRawProvider(primary.name, primary);
  const primaryAdapter = new ProviderAdapter(primary.logger, primary.config, primaryRawProvider);

  let fallbackEntry = null;
  if (fallback && fallback.name) {
    const fallbackRawProvider = buildRawProvider(fallback.name, fallback);
    const fallbackAdapter = new ProviderAdapter(fallback.logger, fallback.config, fallbackRawProvider);
    fallbackEntry = { name: fallback.name, adapter: fallbackAdapter };
  }

  return {
    primary: { name: primary.name, adapter: primaryAdapter },
    fallback: fallbackEntry
  };
}

module.exports = {
  createProviderRegistry,
  buildRawProvider,
  PROVIDER_BUILDERS
};
