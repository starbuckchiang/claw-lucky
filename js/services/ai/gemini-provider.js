const { NormalizedProviderError } = require("./provider-types.js");

function sanitizeErrorForDiagnostics(e) {
  if (!e) return null;
  const get = (obj, path) => path.split('.').reduce((acc, part) => acc && acc[part], obj);
  const safePaths = [
    'name', 'message', 'code', 'status', 'statusText',
    'cause.name', 'cause.message', 'cause.code', 'cause.status',
    'response.status', 'response.statusText',
    'response.data.error.code', 'response.data.error.status', 'response.data.error.message'
  ];
  const diagnostics = {};
  for (const path of safePaths) {
    const value = get(e, path);
    if (value !== undefined) diagnostics[path.replace(/\./g, '_')] = value;
  }
  return diagnostics;
}

function mapError(e) {
  const diagnostics = sanitizeErrorForDiagnostics(e);
  const status = e?.status ?? e?.response?.status ?? e?.statusCode;
  const msg = String(e?.message ?? "Provider error");
  const isTimeout = e?.name === "AbortError" || /timeout/i.test(msg) || status === 408;
  const isAuth = status === 401 || status === 403;
  const isRateLimit = status === 429;
  const isBadRequest = status === 400 || status === 404;
  const isUnavailable = status >= 500 && status <= 504;

  if (isTimeout) return new NormalizedProviderError("PROVIDER_TIMEOUT", "Provider request timeout", true, status, e, diagnostics);
  if (isRateLimit) return new NormalizedProviderError("PROVIDER_RATE_LIMIT", "Provider rate limited", true, status, e, diagnostics);
  if (isAuth) return new NormalizedProviderError("PROVIDER_AUTH_FAILED", "Provider auth failed", false, status, e, diagnostics);
  if (isBadRequest) return new NormalizedProviderError("PROVIDER_BAD_REQUEST", "Provider bad request", false, status, e, diagnostics);
  if (isUnavailable) return new NormalizedProviderError("PROVIDER_UNAVAILABLE", "Provider unavailable", true, status, e, diagnostics);
  return new NormalizedProviderError("PROVIDER_UNKNOWN", "Provider unknown error", false, status, e, diagnostics);
}

function mapFinishReason(reason) {
  if (!reason) return "UNKNOWN";
  const upper = reason.toUpperCase();
  if (upper.includes("STOP")) return "STOP";
  if (upper.includes("SAFETY")) return "SAFETY";
  if (upper.includes("LENGTH")) return "LENGTH";
  return "UNKNOWN";
}

class GeminiProvider {
  #client;
  #config;
  #logger;

  constructor({ config, client, logger }) {
    if (!client || typeof client.models?.generateContent !== "function") {
      throw new TypeError(
        "GeminiProvider requires a valid GoogleGenAI client with a 'models.generateContent' method."
      );
    }
    if (!config) throw new Error("GeminiProvider: config is required.");
    if (!logger) throw new Error("GeminiProvider: logger is required.");

    this.#config = config;
    this.#client = client;
    this.#logger = logger;
  }

  async generateWallpaper(input) {
    const { renderedPrompt, correlationId, aspectRatio = "9:16" } = input;
    const started = Date.now();

    try {
      this.#logger.info({ event: "gemini.provider.start", correlationId, model: this.#config.model });

      const result = await this.#client.models.generateContent({
        model: this.#config.model,
        contents: renderedPrompt,
        config: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio,
          },
        },
      });

      const response = result.response ?? result;
      const imagePart = response?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

      if (!imagePart || !imagePart.inlineData.data) {
        const finishReason = response?.candidates?.[0]?.finishReason || "NO_IMAGE";
        const diagnostics = { finishReason, safetyRatings: response?.promptFeedback?.safetyRatings };
        throw new NormalizedProviderError("PROVIDER_INVALID_RESPONSE", `Gemini did not return an image. Reason: ${finishReason}`, false, 200, null, diagnostics);
      }

      return {
        provider: "gemini",
        model: this.#config.model,
        durationMs: Date.now() - started,
        image: {
          base64: imagePart.inlineData.data,
          mimeType: imagePart.inlineData.mimeType,
        },
        usage: response.usageMetadata,
        finishReason: mapFinishReason(response.candidates?.[0]?.finishReason),
        providerRequestId: response.headers?.['x-goog-request-id'],
        correlationId,
      };
    } catch (e) {
      const errorToThrow = (e instanceof NormalizedProviderError) ? e : mapError(e);
      this.#logger.error({
        event: "gemini.provider.error",
        correlationId,
        code: errorToThrow.code,
        message: errorToThrow.message,
        diagnostics: errorToThrow.diagnostics,
      });
      throw errorToThrow;
    }
  }
}

module.exports = { GeminiProvider };