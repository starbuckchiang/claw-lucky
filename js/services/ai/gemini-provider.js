const { NormalizedProviderError } = require("./provider-types.js");

// Best-effort extraction of a Google API-style error body
// (`{"error":{"code":400,"message":"...","status":"INVALID_ARGUMENT"}}`)
// that some SDK errors embed as plain text inside `Error.message` instead of
// exposing as a structured `.response`/`.data` property. Never throws; never
// returns anything beyond message/status/code text.
function extractEmbeddedErrorBody(message) {
  if (typeof message !== "string") return null;
  const match = message.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]);
    const body = parsed?.error || parsed;
    if (!body || typeof body !== "object") return null;

    return {
      message: body.message ?? null,
      status: body.status ?? null,
      code: body.code ?? null
    };
  } catch (_parseError) {
    return null;
  }
}

function sanitizeErrorForDiagnostics(e) {
  if (!e) return null;
  const get = (obj, path) => path.split('.').reduce((acc, part) => acc && acc[part], obj);
  const safePaths = [
    'name', 'message', 'code', 'status', 'statusText',
    'cause.name', 'cause.message', 'cause.code', 'cause.status',
    'error.code', 'error.status', 'error.message',
    'response.status', 'response.statusText',
    'response.error.code', 'response.error.status', 'response.error.message',
    'response.data.error.code', 'response.data.error.status', 'response.data.error.message'
  ];
  const diagnostics = {};
  for (const path of safePaths) {
    const value = get(e, path);
    if (value !== undefined) diagnostics[path.replace(/\./g, '_')] = value;
  }

  // Some @google/genai / googleapis errors stringify the response body into
  // `Error.message` (e.g. "[400 Bad Request] {\"error\":{...}}") instead of
  // exposing it as a structured property. Recover it when present.
  const embedded = extractEmbeddedErrorBody(e?.message);
  if (embedded) {
    if (diagnostics.responseBody_error_message === undefined) diagnostics.responseBody_error_message = embedded.message;
    if (diagnostics.responseBody_error_status === undefined) diagnostics.responseBody_error_status = embedded.status;
    if (diagnostics.responseBody_error_code === undefined) diagnostics.responseBody_error_code = embedded.code;
  }

  return diagnostics;
}

// Extracts ONLY the specific, explicit, top-level diagnostic fields requested
// for the pre-`generation_service_provider_failure` log line, read directly
// from the ORIGINAL exception (before any normalization/wrapping). Never
// touches API keys, Authorization headers, or the request body/prompt.
function buildRawGeminiErrorFields(e) {
  if (!e) {
    return { httpStatus: null, geminiErrorMessage: null, geminiErrorStatus: null, geminiErrorCode: null };
  }

  const embedded = extractEmbeddedErrorBody(e?.message);

  const httpStatus = e?.status ?? e?.response?.status ?? e?.statusCode ?? null;

  const geminiErrorMessage =
    e?.error?.message ??
    e?.response?.error?.message ??
    e?.response?.data?.error?.message ??
    embedded?.message ??
    e?.message ??
    null;

  const geminiErrorStatus =
    e?.error?.status ??
    e?.response?.error?.status ??
    e?.response?.data?.error?.status ??
    embedded?.status ??
    null;

  const geminiErrorCode =
    e?.error?.code ??
    e?.response?.error?.code ??
    e?.response?.data?.error?.code ??
    embedded?.code ??
    e?.code ??
    null;

  return { httpStatus, geminiErrorMessage, geminiErrorStatus, geminiErrorCode };
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
      // Attach the model used for THIS call as safe, non-secret metadata so
      // downstream normalization (wallpaper-provider-adapter.js) no longer
      // has to report `model: null` when it only has the error to go on.
      errorToThrow.model = this.#config.model;

      // Read the explicit diagnostic fields directly from the ORIGINAL
      // exception `e` (before normalization) so the real Gemini/HTTP error
      // is visible in logs prior to `generation_service_provider_failure`.
      // Never includes the API key, Authorization header, or request body.
      const rawFields = buildRawGeminiErrorFields(e);

      this.#logger.error({
        event: "gemini.provider.error",
        correlationId,
        code: errorToThrow.code,
        httpStatus: rawFields.httpStatus,
        geminiErrorMessage: rawFields.geminiErrorMessage,
        geminiErrorStatus: rawFields.geminiErrorStatus,
        geminiErrorCode: rawFields.geminiErrorCode,
        model: this.#config.model,
        endpoint: "models.generateContent",
        message: errorToThrow.message,
        diagnostics: errorToThrow.diagnostics,
      });
      throw errorToThrow;
    }
  }
}

module.exports = { GeminiProvider };