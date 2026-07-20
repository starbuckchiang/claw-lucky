// ESM port of `js/services/ai/providers/provider-registry.js`. Logic
// unchanged: resolves primary/fallback provider name -> instance, wrapped
// in the existing ProviderAdapter retry class (no new retry logic).

import { ProviderAdapter } from "./provider-adapter.ts";
import { GeminiProvider } from "./gemini-provider.ts";
import { ReplicateFluxProvider } from "./replicate-flux-provider.ts";

// deno-lint-ignore no-explicit-any
type ProviderDeps = { config: any; client: any; logger: any };

export const PROVIDER_BUILDERS: Record<string, (deps: ProviderDeps) => unknown> = Object.freeze({
  gemini({ config, client, logger }: ProviderDeps) {
    return new GeminiProvider({ config, client, logger });
  },
  "replicate-flux"({ config, client, logger }: ProviderDeps) {
    return new ReplicateFluxProvider({ config, client, logger });
  }
});

export function buildRawProvider(providerName: string, deps: ProviderDeps) {
  const builder = PROVIDER_BUILDERS[providerName];
  if (typeof builder !== "function") {
    throw new Error(`Unsupported provider: ${providerName}`);
  }
  return builder(deps);
}

export function createProviderRegistry({
  primary,
  fallback
}: {
  primary: ProviderDeps & { name: string };
  fallback?: (ProviderDeps & { name: string }) | null;
}) {
  if (!primary || !primary.name) {
    throw new Error("createProviderRegistry requires primary.name.");
  }

  const primaryRawProvider = buildRawProvider(primary.name, primary);
  const primaryAdapter = new ProviderAdapter(primary.logger, primary.config, primaryRawProvider);

  let fallbackEntry: { name: string; adapter: ProviderAdapter } | null = null;
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
