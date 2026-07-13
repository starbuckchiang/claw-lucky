"use strict";

const { validateCreateGenerationRequest } = require("./generation-validator");
const {
  createGenerationSuccessDto,
  createGenerationErrorDto
} = require("./response-dto");

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
  now = defaultNow
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
    const validation = validateCreateGenerationRequest(request);
    if (!validation.ok) {
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
      return normalizePromptError(error);
    }

    if (!prompt || typeof prompt.template !== "string" || prompt.template.trim().length === 0) {
      return createGenerationErrorDto({
        code: "PROMPT_NOT_FOUND",
        message: "Prompt template is missing or empty.",
        retryable: false
      });
    }

    const promptContext = buildPromptContext(validated, prompt);
    let providerResult;

    try {
      providerResult = await providerAdapter.generateWallpaper(promptContext);
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
      return normalizeProviderError(providerResult);
    }

    const imageUrl = String(providerResult?.imageUrl || "").trim();
    if (!imageUrl) {
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
        durationMs: Number(providerResult?.durationMs || 0),
        status: "succeeded",
        failureCode: null,
        failureMessage: null,
        expiresAt: toIsoString(expiresAt)
      });
    } catch (error) {
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
      return createGenerationErrorDto({
        code: "IMAGE_GENERATION_FAILURE",
        message: "Persisted generation result is incomplete.",
        retryable: false
      });
    }

    return createGenerationSuccessDto({
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
  }

  return {
    createWallpaperGeneration
  };
}

module.exports = {
  createGenerationService
};
