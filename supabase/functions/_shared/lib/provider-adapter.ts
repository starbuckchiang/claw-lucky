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
    // TEMPORARY diagnostic (P2-AI-03 error-tracing investigation): logged
    // right before the final, unchanged rethrow. Never logs API keys,
    // tokens, prompt text, or image data.
    const err = lastError as { constructor?: { name?: string }; name?: string; message?: string; stack?: string; cause?: { name?: string; message?: string; stack?: string } };
    console.error(JSON.stringify({
      level: "error",
      event: "provider.adapter.exhausted",
      correlationId: input?.correlationId || null,
      errorType: err?.constructor?.name || null,
      errorName: err?.name || null,
      errorMessage: err?.message || null,
      firstProjectStackLine: firstProjectStackLine(err?.stack),
      causeName: err?.cause?.name || null,
      causeMessage: err?.cause?.message || null,
      causeStackLine: firstProjectStackLine(err?.cause?.stack)
    }));
    throw lastError;
  }
}
