// NOTE: `./provider-factory.js` (and therefore `@google/genai`) is required
// lazily inside the constructor, only when no `injectedProvider` is supplied.
// This keeps this module safe to `require()` from runtimes (e.g. Deno Edge
// Functions via `node:module` createRequire) where a bare CommonJS
// `require("@google/genai")` may not resolve. Node.js callers that rely on
// the 2-argument constructor form are unaffected.
// 依賴 provider-types.js
const { NormalizedProviderError } = require("./provider-types.js");

class ProviderAdapter {
  #provider;
  #config;
  #logger;

  /**
   * @param {object} logger
   * @param {object} config
   * @param {object} [injectedProvider] - Optional pre-constructed provider
   *   (e.g. a GeminiProvider wired with a Deno-native GoogleGenAI client).
   *   When supplied, `createProvider()` (which `require()`s the Node
   *   `@google/genai` SDK) is skipped entirely. This is the server adapter /
   *   runtime boundary used by Supabase Edge Functions (Deno) so the rest of
   *   this module can remain plain CommonJS. Node.js callers (scripts, unit
   *   tests, future backend workers) are unaffected and keep using the
   *   2-argument form.
   */
  constructor(logger, config, injectedProvider) {
    this.#logger = logger;
    this.#config = config;

    if (injectedProvider) {
      this.#provider = injectedProvider;
    } else {
      // Lazy require: only Node.js callers that rely on the real
      // `@google/genai` SDK pay the cost of resolving it.
      const { createProvider } = require("./provider-factory.js");
      this.#provider = createProvider(logger, config);
    }
  }

  async generateImage(input) {
    const maxRetry = this.#config?.maxRetry ?? 2;
    let attempt = 0;
    let lastError;

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

module.exports = { ProviderAdapter };