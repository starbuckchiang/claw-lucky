// NOTE: `./provider-factory.js` (and therefore `@google/genai`) is required
// lazily inside the constructor, only when no `injectedProvider` is supplied.
// This keeps this module safe to `require()` from runtimes (e.g. Deno Edge
// Functions via `node:module` createRequire) where a bare CommonJS
// `require("@google/genai")` may not resolve. Node.js callers that rely on
// the 2-argument constructor form are unaffected.
// 依賴 provider-types.js
const { NormalizedProviderError } = require("./provider-types.js");

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
    // TEMPORARY diagnostic (P2-AI-03 error-tracing investigation): logged
    // right before the final, unchanged rethrow. Never logs API keys,
    // tokens, prompt text, or image data.
    console.error(JSON.stringify({
      level: "error",
      event: "provider.adapter.exhausted",
      correlationId: input?.correlationId || null,
      errorType: lastError?.constructor?.name || null,
      errorName: lastError?.name || null,
      errorMessage: lastError?.message || null,
      firstProjectStackLine: firstProjectStackLine(lastError?.stack),
      causeName: lastError?.cause?.name || null,
      causeMessage: lastError?.cause?.message || null,
      causeStackLine: firstProjectStackLine(lastError?.cause?.stack)
    }));
    throw lastError;
  }
}

module.exports = { ProviderAdapter };