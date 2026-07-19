"use strict";

const { validateCreateGenerationRequest } = require("./generation-validator");
const {
  createGenerationSuccessDto,
  createGenerationErrorDto
} = require("./response-dto");
const { createGenerationTracing } = require("../logging/generation-tracing");
const { createGenerationLogger } = require("../logging/generation-logger");

function defaultNow() {
  return new Date();
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function plusDays(baseDate, days) {
  const next = new Date(baseDate.getTime());
  next.setUTCDate(next.getUTCDate() + Number(days));
  return next;
}

function renderPrompt(template, variables) {
  let output = String(template || "");

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    output = output.replace(placeholder, String(value ?? ""));
  }

  return output.trim();
}

function buildPromptContext(validated, prompt) {
  const variables = {
    userId: validated.userId,
    mascotId: validated.mascotId,
    giftId: validated.giftId,
    wallpaperStyle: validated.wallpaperStyle,
    luckyTheme: validated.luckyTheme,
    blessing: validated.blessing
  };

  return {
    promptType: prompt.promptType,
    promptVersion: prompt.version,
    promptSource: prompt.source,
    promptTemplate: prompt.template,
    promptMetadata: prompt.metadata || {},
    promptText: renderPrompt(prompt.template, variables),
    variables
  };
}

function normalizePromptError(error) {
  return createGenerationErrorDto({
    code: "PROMPT_NOT_FOUND",
    message: "Active prompt is unavailable.",
    retryable: false,
    details: {
      promptErrorCode: error?.code || null
    }
  });
}

function normalizeProviderError(providerResult) {
  const failureCode = String(providerResult?.failureCode || "PROVIDER_FAILURE");

  if (failureCode === "TIMEOUT" || failureCode === "PROVIDER_TIMEOUT") {
    return createGenerationErrorDto({
      code: "PROVIDER_TIMEOUT",
      message: String(providerResult?.failureMessage || "Provider request timed out."),
      retryable: true,
      details: {
        provider: providerResult?.provider || "unknown",
        model: providerResult?.model || null,
        providerRequestId: providerResult?.providerRequestId || null
      }
    });
  }

  if (failureCode === "INVALID_RESPONSE") {
    return createGenerationErrorDto({
      code: "INVALID_RESPONSE",
      message: String(providerResult?.failureMessage || "Provider returned invalid response."),
      retryable: false,
      details: {
        provider: providerResult?.provider || "unknown",
        model: providerResult?.model || null,
        providerRequestId: providerResult?.providerRequestId || null
      }
    });
  }

  // Gemini (P2-AI-01) raises PROVIDER_INVALID_RESPONSE specifically; kept as a
  // distinct, additive normalized code (does not replace the legacy
  // INVALID_RESPONSE contract approved in P1-BIZ-03).
  if (failureCode === "PROVIDER_INVALID_RESPONSE") {
    return createGenerationErrorDto({
      code: "PROVIDER_INVALID_RESPONSE",
      message: String(providerResult?.failureMessage || "Provider returned invalid response."),
      retryable: false,
      details: {
        provider: providerResult?.provider || "unknown",
        model: providerResult?.model || null,
        providerRequestId: providerResult?.providerRequestId || null
      }
    });
  }

  // Pass-through provider/storage failure codes are intentionally NOT
  // introduced as new top-level DTO codes here: the approved P1-BIZ-03
  // contract folds all other provider failures into the generic
  // `PROVIDER_FAILURE` code (see test "Provider Failure" — a raw
  // `PROVIDER_UNAVAILABLE` failureCode must still surface as `PROVIDER_FAILURE`).
  // The specific failureCode (PROVIDER_RATE_LIMIT / PROVIDER_AUTH_FAILED /
  // PROVIDER_BAD_REQUEST / PROVIDER_UNAVAILABLE / STORAGE_UPLOAD_FAILED / ...)
  // is preserved in `details.failureCode` below so the Edge Function can still
  // map it to a precise HTTP status without changing this approved contract.
  return createGenerationErrorDto({
    code: "PROVIDER_FAILURE",
    message: String(providerResult?.failureMessage || "Provider failed to generate image."),
    retryable: Boolean(providerResult?.retryable),
    details: {
      provider: providerResult?.provider || "unknown",
      model: providerResult?.model || null,
      providerRequestId: providerResult?.providerRequestId || null,
      failureCode
    }
  });
}

function createGenerationService({
  promptRegistryLoader,
  providerAdapter,
  generationRepository,
  now = defaultNow,
  generationTracing = createGenerationTracing(),
  generationLogger = createGenerationLogger()
}) {
  if (!promptRegistryLoader || typeof promptRegistryLoader.loadActivePrompt !== "function") {
    throw new Error("createGenerationService requires promptRegistryLoader.loadActivePrompt(promptType).");
  }

  if (!providerAdapter || typeof providerAdapter.generateWallpaper !== "function") {
    throw new Error("createGenerationService requires providerAdapter.generateWallpaper(input).");
  }

  if (!generationRepository || typeof generationRepository.createGenerationRecord !== "function") {
    throw new Error("createGenerationService requires generationRepository.createGenerationRecord(payload).");
  }

  async function createWallpaperGeneration(request) {
    const trace = generationTracing.startTrace({
      correlationId: request?.correlationId
    });

    generationLogger.logInfo({
      event: "generation_service_started",
      correlationId: trace.correlationId,
      payload: {
        status: "started",
        createdAt: trace.createdAt
      }
    });

    const validation = validateCreateGenerationRequest(request);
    if (!validation.ok) {
      generationLogger.logWarn({
        event: "generation_service_validation_failed",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, validation.error.code),
          status: "failed"
        }
      });
      return createGenerationErrorDto({
        code: validation.error.code,
        message: validation.error.message,
        retryable: false,
        details: validation.error.details || null
      });
    }

    const validated = validation.value;
    let prompt;
    try {
      prompt = await promptRegistryLoader.loadActivePrompt(validated.promptType);
    } catch (error) {
      generationLogger.logWarn({
        event: "generation_service_prompt_unavailable",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, "PROMPT_NOT_FOUND"),
          status: "failed"
        }
      });
      return normalizePromptError(error);
    }

    if (!prompt || typeof prompt.template !== "string" || prompt.template.trim().length === 0) {
      generationLogger.logWarn({
        event: "generation_service_prompt_missing",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, "PROMPT_NOT_FOUND"),
          status: "failed"
        }
      });
      return createGenerationErrorDto({
        code: "PROMPT_NOT_FOUND",
        message: "Prompt template is missing or empty.",
        retryable: false
      });
    }

    const promptContext = buildPromptContext(validated, prompt);
    let providerResult;

    try {
      providerResult = await providerAdapter.generateWallpaper({
        ...promptContext,
        correlationId: trace.correlationId
      });
    } catch (error) {
      const normalized =
        typeof providerAdapter.normalizeProviderError === "function"
          ? providerAdapter.normalizeProviderError(error)
          : {
              provider: "unknown",
              model: null,
              providerRequestId: null,
              durationMs: 0,
              retryable: false,
              failureCode: "PROVIDER_FAILURE",
              failureMessage: "Provider call failed."
            };

      providerResult = {
        ...normalized,
        imageUrl: null
      };
    }

    if (providerResult?.failureCode) {
      generationLogger.logError({
        event: "generation_service_provider_failure",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, providerResult.failureCode),
          provider: providerResult?.provider || null,
          model: providerResult?.model || null,
          // Preserved from the original exception via GeminiProvider ->
          // ProviderAdapter -> wallpaper-provider-adapter.normalizeProviderError
          // (see gemini-provider.js). Reveals the real Gemini/HTTP failure
          // instead of only the normalized failureCode.
          httpStatus: providerResult?.httpStatus ?? null,
          providerStatus: providerResult?.providerStatus ?? null,
          providerMessage: providerResult?.providerMessage ?? null,
          providerCode: providerResult?.providerCode ?? null,
          status: "failed"
        }
      });
      return normalizeProviderError(providerResult);
    }

    const imageUrl = String(providerResult?.imageUrl || "").trim();
    if (!imageUrl) {
      generationLogger.logError({
        event: "generation_service_invalid_response",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, "INVALID_RESPONSE"),
          provider: providerResult?.provider || null,
          model: providerResult?.model || null,
          status: "failed"
        }
      });
      return createGenerationErrorDto({
        code: "INVALID_RESPONSE",
        message: "Image generation response does not include imageUrl.",
        retryable: false,
        details: {
          provider: providerResult?.provider || "unknown",
          model: providerResult?.model || null,
          providerRequestId: providerResult?.providerRequestId || null
        }
      });
    }

    let persistedRecord;
    const nowAt = now();
    const expiresAt = plusDays(nowAt, 30);

    try {
      persistedRecord = await generationRepository.createGenerationRecord({
        userId: validated.userId,
        mascotId: validated.mascotId,
        giftId: validated.giftId,
        wallpaperStyle: validated.wallpaperStyle,
        luckyTheme: validated.luckyTheme,
        blessing: validated.blessing,
        promptType: promptContext.promptType,
        promptVersion: promptContext.promptVersion,
        promptSource: promptContext.promptSource,
        provider: providerResult?.provider || "unknown",
        model: providerResult?.model || null,
        providerRequestId: providerResult?.providerRequestId || null,
        imageUrl,
        storageBucket: providerResult?.storageBucket || null,
        storagePath: providerResult?.storagePath || null,
        mimeType: providerResult?.mimeType || null,
        fileSize: Number.isFinite(Number(providerResult?.fileSize)) ? Number(providerResult.fileSize) : null,
        durationMs: Number(providerResult?.durationMs || 0),
        status: "succeeded",
        failureCode: null,
        failureMessage: null,
        expiresAt: toIsoString(expiresAt)
      });
    } catch (error) {
      generationLogger.logError({
        event: "generation_service_persistence_failure",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, "IMAGE_GENERATION_FAILURE"),
          status: "failed"
        }
      });
      return createGenerationErrorDto({
        code: "IMAGE_GENERATION_FAILURE",
        message: "Image was generated but persistence failed.",
        retryable: true,
        details: {
          reason: error?.message || "unknown"
        }
      });
    }

    if (!persistedRecord?.generationId || !persistedRecord?.createdAt) {
      generationLogger.logError({
        event: "generation_service_incomplete_record",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, "IMAGE_GENERATION_FAILURE"),
          status: "failed"
        }
      });
      return createGenerationErrorDto({
        code: "IMAGE_GENERATION_FAILURE",
        message: "Persisted generation result is incomplete.",
        retryable: false
      });
    }

    const result = createGenerationSuccessDto({
      generationId: persistedRecord.generationId,
      provider: persistedRecord.provider || providerResult?.provider || "unknown",
      model: persistedRecord.model || providerResult?.model || null,
      imageUrl: persistedRecord.imageUrl || imageUrl,
      promptVersion: persistedRecord.promptVersion || promptContext.promptVersion,
      durationMs:
        Number.isFinite(Number(persistedRecord.durationMs))
          ? Number(persistedRecord.durationMs)
          : Number(providerResult?.durationMs || 0),
      status: persistedRecord.status || "succeeded",
      createdAt: persistedRecord.createdAt || toIsoString(nowAt)
    });

    generationLogger.logInfo({
      event: "generation_service_succeeded",
      correlationId: trace.correlationId,
      payload: generationTracing.buildGenerationTrace(trace, result.data)
    });

    return result;
  }

  return {
    createWallpaperGeneration
  };
}

module.exports = {
  createGenerationService
};
