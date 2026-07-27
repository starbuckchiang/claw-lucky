// ESM port of `js/services/ai/gemini-text-provider.js`. Logic unchanged.
// Separate from `gemini-provider.ts` (image generation): calls the SAME
// injected GoogleGenAI client but for TEXT/Structured-Output generation
// only, never images.

import { NormalizedProviderError } from "./provider-types.ts";

// deno-lint-ignore no-explicit-any
function mapTextProviderError(e: any): NormalizedProviderError {
  const status = e?.status ?? e?.response?.status ?? e?.statusCode;
  const msg = String(e?.message ?? "Shopkeeper text provider error");
  const isTimeout = e?.name === "AbortError" || /timeout/i.test(msg) || status === 408;
  const isRateLimit = status === 429;
  const isAuth = status === 401 || status === 403;
  const isBadRequest = status === 400 || status === 404;
  const isUnavailable = status >= 500 && status <= 504;

  if (isTimeout) return new NormalizedProviderError("PROVIDER_TIMEOUT", "Shopkeeper text request timeout", true, status, e, null);
  if (isRateLimit) return new NormalizedProviderError("PROVIDER_RATE_LIMIT", "Shopkeeper text provider rate limited", true, status, e, null);
  if (isAuth) return new NormalizedProviderError("PROVIDER_AUTH_FAILED", "Shopkeeper text provider auth failed", false, status, e, null);
  if (isBadRequest) return new NormalizedProviderError("PROVIDER_BAD_REQUEST", "Shopkeeper text provider bad request", false, status, e, null);
  if (isUnavailable) return new NormalizedProviderError("PROVIDER_UNAVAILABLE", "Shopkeeper text provider unavailable", true, status, e, null);
  return new NormalizedProviderError("PROVIDER_UNKNOWN", "Shopkeeper text provider unknown error", false, status, e, null);
}

export interface GeminiTextProviderLogger {
  // deno-lint-ignore no-explicit-any
  info(entry: any): void;
  // deno-lint-ignore no-explicit-any
  error(entry: any): void;
}

export class GeminiTextProvider {
  // deno-lint-ignore no-explicit-any
  #client: any;
  // deno-lint-ignore no-explicit-any
  #config: any;
  #logger: GeminiTextProviderLogger;

  constructor(
    // deno-lint-ignore no-explicit-any
    { config, client, logger }: { config: any; client: any; logger: GeminiTextProviderLogger }
  ) {
    if (!client || typeof client.models?.generateContent !== "function") {
      throw new TypeError(
        "GeminiTextProvider requires a valid GoogleGenAI client with a 'models.generateContent' method."
      );
    }
    if (!config) throw new Error("GeminiTextProvider: config is required.");
    if (!logger) throw new Error("GeminiTextProvider: logger is required.");

    this.#config = config;
    this.#client = client;
    this.#logger = logger;
  }

  async generateContext(
    { promptText, correlationId }: { promptText: string; correlationId: string }
  ): Promise<{ text: string; durationMs: number }> {
    const started = Date.now();

    try {
      this.#logger.info({ event: "shopkeeper.text_provider.start", correlationId, model: this.#config.model });

      const result = await this.#client.models.generateContent({
        model: this.#config.model,
        contents: promptText,
        config: {
          responseMimeType: "application/json"
        }
      });

      const response = result.response ?? result;
      const text = response?.text ?? response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

      if (!text) {
        throw new NormalizedProviderError(
          "PROVIDER_INVALID_RESPONSE",
          "Shopkeeper text provider returned no text.",
          false,
          200,
          null,
          null
        );
      }

      this.#logger.info({ event: "shopkeeper.text_provider.succeeded", correlationId, durationMs: Date.now() - started });

      return {
        text,
        durationMs: Date.now() - started
      };
    } catch (e) {
      const errorToThrow = (e instanceof NormalizedProviderError) ? e : mapTextProviderError(e);

      this.#logger.error({
        event: "shopkeeper.text_provider.error",
        correlationId,
        code: errorToThrow.code,
        message: errorToThrow.message
      });

      throw errorToThrow;
    }
  }
}
