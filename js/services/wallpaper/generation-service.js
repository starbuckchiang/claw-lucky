"use strict";

const { validateCreateGenerationRequest } = require("./generation-validator");
const {
  createGenerationSuccessDto,
  createGenerationErrorDto
} = require("./response-dto");
const { createGenerationTracing } = require("../logging/generation-tracing");
const { createGenerationLogger } = require("../logging/generation-logger");
const { validateWallpaperPromptInput, PromptValidationError } = require("../prompt/prompt-validator");
const { buildWallpaperPrompt } = require("../prompt/wallpaper-prompt-builder");
const { buildPromptSnapshot } = require("../prompt/prompt-snapshot");

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

// Extracts ONLY safe, non-secret diagnostic fields from a raw
// Supabase/Postgres error (never JWTs/API keys/service-role keys/full
// request headers). `table`/`operation` are attached by the repository
// layer (see generation-repository.js's withDiagnosticContext) so the real
// failure point is visible even though the public-facing error code stays
// normalized as IMAGE_GENERATION_FAILURE. Mirrors job-service.js's precedent.
function extractSafeErrorDiagnostics(error) {
  return {
    reason: error?.message || "unknown",
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
    table: error?.table || null,
    operation: error?.operation || null
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
  promptContextResolver,
  mascotRepository,
  giftRepository,
  shopkeeperContextAgent,
  providerAdapter,
  generationRepository,
  now = defaultNow,
  generationTracing = createGenerationTracing(),
  generationLogger = createGenerationLogger()
}) {
  if (!promptRegistryLoader || typeof promptRegistryLoader.loadActivePrompt !== "function") {
    throw new Error("createGenerationService requires promptRegistryLoader.loadActivePrompt(promptType).");
  }

  if (!promptContextResolver || typeof promptContextResolver.resolve !== "function") {
    throw new Error("createGenerationService requires promptContextResolver.resolve(request).");
  }

  if (!mascotRepository || typeof mascotRepository.findMascotById !== "function") {
    throw new Error("createGenerationService requires mascotRepository.findMascotById(mascotId).");
  }

  if (!giftRepository || typeof giftRepository.findGiftById !== "function") {
    throw new Error("createGenerationService requires giftRepository.findGiftById(giftId).");
  }

  if (!shopkeeperContextAgent || typeof shopkeeperContextAgent.generate !== "function") {
    throw new Error("createGenerationService requires shopkeeperContextAgent.generate(input).");
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

    // AI Constitution-compliant pipeline (P2-AI-03 Shopkeeper Context Agent):
    // Generation Service -> [query Mascot/Gift ONCE, shared below] ->
    // Shopkeeper Context Agent -> Prompt Context Resolver -> Prompt
    // Validator -> Wallpaper Prompt Builder -> Prompt Snapshot -> Provider
    // Adapter. The Prompt Registry's `prompt.template` field is loaded
    // above (kept for backward-compatible promptType/version/source
    // tracking) but is no longer used to assemble the actual image prompt
    // text — the Wallpaper Prompt Builder is the ONLY module allowed to do
    // that (Principle 5).
    let promptContext;
    let shopkeeperContext;
    try {
      // Mascot/Gift are queried EXACTLY ONCE here and shared with both the
      // Shopkeeper Context Agent and the Prompt Context Resolver below —
      // per P2-AI-03 Product Decision, neither of those two components may
      // query the repositories themselves.
      const [mascot, gift] = await Promise.all([
        mascotRepository.findMascotById(validated.mascotId),
        giftRepository.findGiftById(validated.giftId)
      ]);

      // Shopkeeper Context Agent NEVER throws — any AI failure (timeout,
      // rate limit, provider failure, invalid/incomplete JSON) resolves
      // internally to the deterministic Fallback Context, so a Shopkeeper
      // failure can never block wallpaper generation.
      shopkeeperContext = await shopkeeperContextAgent.generate({
        mascot,
        gift,
        wallpaperStyle: validated.wallpaperStyle,
        correlationId: trace.correlationId
      });

      const context = await promptContextResolver.resolve({
        mascot,
        gift,
        wallpaperStyle: validated.wallpaperStyle,
        luckyTheme: shopkeeperContext.luckyTheme,
        blessing: shopkeeperContext.blessing
      });

      validateWallpaperPromptInput(context);

      const promptResult = buildWallpaperPrompt(context);
      const promptSnapshot = buildPromptSnapshot({
        promptResult,
        contextVersion: context.contextVersion
      });

      promptContext = {
        promptText: promptResult.promptText,
        promptType: prompt.promptType,
        promptVersion: prompt.version,
        promptSource: prompt.source,
        variables: { userId: validated.userId },
        ...promptSnapshot
      };
    } catch (error) {
      if (error instanceof PromptValidationError) {
        generationLogger.logWarn({
          event: "generation_service_prompt_validation_failed",
          correlationId: trace.correlationId,
          payload: {
            error: generationTracing.buildErrorTrace(trace, "PROMPT_VALIDATION_FAILED"),
            details: error.details || null,
            status: "failed"
          }
        });
        return createGenerationErrorDto({
          code: "PROMPT_VALIDATION_FAILED",
          message: error.message,
          retryable: false,
          details: error.details || null
        });
      }

      generationLogger.logWarn({
        event: "generation_service_prompt_context_failed",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, "PROMPT_CONTEXT_FAILURE"),
          status: "failed"
        }
      });
      return createGenerationErrorDto({
        code: "PROMPT_CONTEXT_FAILURE",
        message: "Failed to resolve mascot/gift context for prompt generation.",
        retryable: true,
        details: { reason: error?.message || "unknown" }
      });
    }

    let providerResult;

    try {
      providerResult = await providerAdapter.generateWallpaper({
        ...promptContext,
        correlationId: trace.correlationId
      });
    } catch (error) {
      // TEMPORARY diagnostic (P2-AI-03 error-tracing investigation): logs
      // the RAW error's type/name/message/stack/cause BEFORE
      // normalizeProviderError() runs, so this is the last point the
      // original exception can still be inspected before it becomes a
      // normalized DTO. Never logs API keys, tokens, prompt text, or image
      // data. Logged via console.error directly (not generationLogger), so
      // it always emits regardless of logger wiring.
      console.error(JSON.stringify({
        level: "error",
        event: "generation_service_provider_failure_raw",
        correlationId: trace.correlationId,
        errorType: error?.constructor?.name || null,
        errorName: error?.name || null,
        errorMessage: error?.message || null,
        firstProjectStackLine: (() => {
          if (typeof error?.stack !== "string") return null;
          const lines = error.stack.split("\n").slice(1);
          const projectLine = lines.find((line) => line.includes("services") || line.includes("supabase")) || lines[0];
          return projectLine ? projectLine.trim() : null;
        })(),
        causeName: error?.cause?.name || null,
        causeMessage: error?.cause?.message || null
      }));

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
        // Persist the SHOPKEEPER's authoritative luckyTheme/blessing (what
        // was actually used to build the image prompt), not the raw
        // request fields — those are superseded once the Shopkeeper
        // Context Agent runs (P2-AI-03).
        luckyTheme: shopkeeperContext.luckyTheme,
        blessing: shopkeeperContext.blessing,
        promptType: promptContext.promptType,
        promptVersion: promptContext.promptVersion,
        promptSource: promptContext.promptSource,
        // Prompt Snapshot fields (P2-AI-02): what was actually sent to the
        // image provider, plus which context/builder version produced it.
        promptSnapshot: promptContext.promptSnapshot,
        contextVersion: promptContext.contextVersion,
        builderVersion: promptContext.builderVersion,
        // Shopkeeper Snapshot fields (P2-AI-03): full Lucky Context +
        // which version/source (ai|fallback) produced it, for observability.
        shopkeeperVersion: shopkeeperContext.version,
        shopkeeperSnapshot: shopkeeperContext,
        source: shopkeeperContext.source,
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
      const diagnostics = extractSafeErrorDiagnostics(error);
      generationLogger.logError({
        event: "generation_service_persistence_failure",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, "IMAGE_GENERATION_FAILURE"),
          // Safe diagnostics only (reason/code/details/hint/table/operation)
          // surfaced from generation-repository.js so the real underlying
          // Supabase/Postgres error is visible instead of being fully
          // swallowed behind IMAGE_GENERATION_FAILURE.
          diagnostics,
          status: "failed"
        }
      });
      return createGenerationErrorDto({
        code: "IMAGE_GENERATION_FAILURE",
        message: "Image was generated but persistence failed.",
        retryable: true,
        details: diagnostics
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
