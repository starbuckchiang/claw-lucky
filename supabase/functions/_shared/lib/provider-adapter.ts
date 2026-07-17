// ESM port of `js/services/ai/provider-adapter.js` for the Deno Edge
// Runtime. Retry-loop logic is unchanged (same maxRetry / retryable check).
//
// Difference from the CommonJS version (intentional, Deno-only
// simplification): the Node version supports building its own provider via
// `provider-factory.js` (`require("@google/genai")`) when no provider is
// injected. The Deno entrypoint ALWAYS constructs and injects a
// `GeminiProvider` wired with a Deno-native `GoogleGenAI` client (see
// `gemini-client.ts`), so that fallback path is dropped here entirely —
// there is no `@google/genai` import in this file at all.

import { NormalizedProviderError } from "./provider-types.ts";

export class ProviderAdapter {
  // deno-lint-ignore no-explicit-any
  #provider: any;
  // deno-lint-ignore no-explicit-any
  #config: any;
  // deno-lint-ignore no-explicit-any
  #logger: any;

  constructor(
    // deno-lint-ignore no-explicit-any
    logger: any,
    // deno-lint-ignore no-explicit-any
    config: any,
    // deno-lint-ignore no-explicit-any
    injectedProvider: any
  ) {
    if (!injectedProvider) {
      throw new Error("ProviderAdapter (Deno ESM port) requires an injected provider — see gemini-client.ts.");
    }

    this.#logger = logger;
    this.#config = config;
    this.#provider = injectedProvider;
  }

  // deno-lint-ignore no-explicit-any
  async generateImage(input: any) {
    const maxRetry = this.#config?.maxRetry ?? 2;
    let attempt = 0;
    // deno-lint-ignore no-explicit-any
    let lastError: any;

    while (attempt <= maxRetry) {
      attempt++;
      try {
        return await this.#provider.generateWallpaper(input);
      } catch (e) {
        lastError = e;
        if (e instanceof NormalizedProviderError && e.retryable && attempt <= maxRetry) {
          this.#logger.info({
            event: "provider.adapter.retry",
            correlationId: input.correlationId,
            attempt,
            code: e.code,
          });
          continue;
        }
        break;
      }
    }
    throw lastError;
  }
}
