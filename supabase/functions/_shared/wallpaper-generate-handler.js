"use strict";

/**
 * Wallpaper Generate — Shared Request Handler (Node.js / CommonJS)
 *
 * IMPORTANT: The Supabase Edge Runtime (Deno) does NOT actually load this
 * file. It is strict ESM and rejects both dynamic `require()`/
 * `createRequire()` loading (invisible to the deploy bundler's static
 * module graph) and `.cjs` re-export shims (deploy-time "unsupported media
 * type Cjs" rejection). The Deno runtime instead uses
 * `wallpaper-generate-handler.ts` — a line-for-line ESM twin of this file —
 * together with the ESM ports under `_shared/lib/*.ts`.
 *
 * This `.js` CommonJS file remains as the Node.js-testable source of truth:
 * it is `require()`-able from `node --test` (see
 * `supabase/functions/_shared/__tests__/wallpaper-generate-handler.test.js`)
 * without needing a TypeScript toolchain. Whenever business logic changes
 * here, mirror the change in `wallpaper-generate-handler.ts` (and vice
 * versa) — same function names, same error codes, same HTTP status mapping.
 *
 * Responsibilities (both files): validation, daily limit, points
 * deduction, job/generation state machine, prompt registry, provider
 * retry/error-normalization, storage upload — reusing the SAME reviewed
 * business modules under `js/services/**` (this file, via ordinary
 * `require()`) or their ESM ports under `_shared/lib/*.ts` (the `.ts` twin,
 * via ordinary `import`). No business logic is duplicated between the two —
 * they are kept behaviorally identical by convention/mirroring.
 */

const { createGenerationOrchestrator } = require("../../../js/services/wallpaper/generation-orchestrator.js");
const { createGenerationService } = require("../../../js/services/wallpaper/generation-service.js");
const { createJobService } = require("../../../js/services/wallpaper/job-service.js");
const { createUsageService } = require("../../../js/services/wallpaper/usage-service.js");
const { createPointsService } = require("../../../js/services/wallpaper/points-service.js");
const { createGenerationRepositoryFromSupabaseClient } = require("../../../js/services/wallpaper/generation-repository.js");
const { createJobRepositoryFromSupabaseClient } = require("../../../js/services/wallpaper/job-repository.js");
const { createUsageRepositoryFromSupabaseClient } = require("../../../js/services/wallpaper/usage-repository.js");
const { createPointsRepositoryFromSupabaseClient } = require("../../../js/services/wallpaper/points-repository.js");
const {
  createPromptRegistryLoader,
  createPromptRepositoryFromSupabaseClient
} = require("../../../js/services/prompt/prompt-registry-loader.js");
const { ProviderAdapter } = require("../../../js/services/ai/provider-adapter.js");
const { createWallpaperProviderAdapter } = require("../../../js/services/ai/wallpaper-provider-adapter.js");
const { createProviderResilienceAgent } = require("../../../js/services/ai/agents/provider-resilience-agent.js");
const { createWallpaperStorageUploader } = require("../../../js/services/storage/wallpaper-storage-uploader.js");
const { createGenerationLogger } = require("../../../js/services/logging/generation-logger.js");
const { createGenerationTracing } = require("../../../js/services/logging/generation-tracing.js");

const ERROR_HTTP_STATUS = Object.freeze({
  UNAUTHORIZED: 401,
  INVALID_REQUEST: 400,
  UNSUPPORTED_WALLPAPER_STYLE: 400,
  UNSUPPORTED_PROMPT_TYPE: 400,
  DAILY_LIMIT_EXCEEDED: 429,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_INVALID_RESPONSE: 502,
  INVALID_RESPONSE: 502,
  PERSISTENCE_FAILURE: 503,
  IMAGE_GENERATION_FAILURE: 502,
  PROVIDER_FAILURE: 502,
  GENERATION_FAILURE: 502,
  JOB_CREATION_FAILURE: 503,
  POINTS_DEDUCTION_FAILURE: 502,
  PROMPT_NOT_FOUND: 500
});

// `generation-service.js` (approved P1-BIZ-03 contract) folds every provider
// failure OTHER than TIMEOUT/INVALID_RESPONSE into the generic top-level
// `PROVIDER_FAILURE` DTO code, while preserving the specific normalized
// failure code (PROVIDER_RATE_LIMIT / PROVIDER_AUTH_FAILED /
// PROVIDER_BAD_REQUEST / PROVIDER_UNAVAILABLE / STORAGE_UPLOAD_FAILED / ...)
// in `error.details.failureCode`. This map lets the Edge Function still
// return a precise HTTP status WITHOUT changing that approved DTO contract.
const PROVIDER_FAILURE_DETAIL_HTTP_STATUS = Object.freeze({
  PROVIDER_RATE_LIMIT: 429,
  PROVIDER_AUTH_FAILED: 502,
  PROVIDER_BAD_REQUEST: 502,
  PROVIDER_UNAVAILABLE: 503,
  STORAGE_UPLOAD_FAILED: 502
});

function toHttpStatus(code, details) {
  if (code === "PROVIDER_FAILURE" && details?.failureCode) {
    const refined = PROVIDER_FAILURE_DETAIL_HTTP_STATUS[details.failureCode];
    if (refined) {
      return refined;
    }
  }

  return ERROR_HTTP_STATUS[code] || 500;
}

const REQUIRED_FIELDS = ["mascotId", "giftId", "wallpaperStyle", "luckyTheme", "blessing", "promptType"];

// Client MUST NOT be able to control identity, secrets, storage location or
// the prompt template. Reject the request outright if present.
const FORBIDDEN_FIELDS = [
  "userId",
  "apiKey",
  "apiKeys",
  "serviceRoleKey",
  "service_role_key",
  "storagePath",
  "storageBucket",
  "promptTemplate"
];

function validateRequestShape(body) {
  const errors = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ["Request body must be a JSON object."];
  }

  for (const field of REQUIRED_FIELDS) {
    if (typeof body[field] !== "string" || !body[field].trim()) {
      errors.push(`${field} is required`);
    }
  }

  for (const field of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      errors.push(`${field} is not allowed in the request body`);
    }
  }

  return errors;
}

function wrapLoggerForProvider(generationLogger) {
  return {
    info(entry) {
      generationLogger.logInfo({
        event: entry?.event || "provider_event",
        correlationId: entry?.correlationId,
        payload: entry
      });
    },
    error(entry) {
      generationLogger.logError({
        event: entry?.event || "provider_error",
        correlationId: entry?.correlationId,
        payload: entry
      });
    }
  };
}

/**
 * Builds the Generation Orchestrator by wiring the SAME reviewed CommonJS
 * business modules together with Supabase-backed repositories and a
 * pre-constructed Gemini provider (injected — never built here).
 *
 * @param {object} params
 * @param {object} params.supabaseClient - service-role Supabase client (writes)
 * @param {object} params.geminiProvider - a pre-constructed GeminiProvider
 *   instance (constructed by the Deno entrypoint with a Deno-native
 *   GoogleGenAI client). MUST already implement `generateWallpaper(input)`.
 * @param {object} params.providerConfig - { maxRetry, ... } passed to ProviderAdapter
 * @param {object} [params.generationLogger]
 * @param {object} [params.fallbackProvider] - OPTIONAL pre-constructed
 *   fallback provider instance (e.g. a ReplicateFluxProvider wired with a
 *   Deno-native Replicate client). When omitted (the default — no fallback
 *   configured), the Provider Resilience Agent behaves EXACTLY like a bare
 *   ProviderAdapter: any primary failure is rethrown immediately, unchanged.
 * @param {object} [params.fallbackProviderConfig] - config passed to the
 *   fallback's own ProviderAdapter retry wrapper (defaults to providerConfig).
 */
function buildOrchestrator({
  supabaseClient,
  geminiProvider,
  providerConfig,
  generationLogger,
  fallbackProvider,
  fallbackProviderConfig
}) {
  const logger = generationLogger || createGenerationLogger();
  const generationTracing = createGenerationTracing();

  const promptRegistryLoader = createPromptRegistryLoader({
    repository: createPromptRepositoryFromSupabaseClient({ supabaseClient })
  });

  const primaryAdapter = new ProviderAdapter(
    wrapLoggerForProvider(logger),
    providerConfig,
    geminiProvider
  );

  // Provider Resilience Agent: unifies primary execution + deterministic
  // fallback decision behind ONE agent workflow (see
  // js/services/ai/agents/provider-resilience-agent.js). This is the
  // SMALLEST integration point — it exposes the exact same
  // `generateImage(input)` contract a single ProviderAdapter exposes today,
  // so it is a drop-in replacement for `rawProviderAdapter` below.
  // `generation-service.js` / `generation-orchestrator.js` are UNCHANGED.
  let fallbackEntry = null;
  if (fallbackProvider) {
    const fallbackAdapter = new ProviderAdapter(
      wrapLoggerForProvider(logger),
      fallbackProviderConfig || providerConfig,
      fallbackProvider
    );
    fallbackEntry = { name: "replicate-flux", adapter: fallbackAdapter };
  }

  const rawProviderAdapter = createProviderResilienceAgent({
    registry: {
      primary: { name: "gemini", adapter: primaryAdapter },
      fallback: fallbackEntry
    },
    logger
  });

  const storageUploader = createWallpaperStorageUploader({ supabaseClient });

  const providerAdapter = createWallpaperProviderAdapter({
    providerAdapter: rawProviderAdapter,
    storageUploader,
    logger
  });

  const generationRepository = createGenerationRepositoryFromSupabaseClient({ supabaseClient });
  const jobRepository = createJobRepositoryFromSupabaseClient({ supabaseClient });
  const usageRepository = createUsageRepositoryFromSupabaseClient({ supabaseClient });
  const pointsRepository = createPointsRepositoryFromSupabaseClient({ supabaseClient });

  const generationService = createGenerationService({
    promptRegistryLoader,
    providerAdapter,
    generationRepository,
    generationTracing,
    generationLogger: logger
  });

  const jobService = createJobService({ jobRepository });
  const usageService = createUsageService({ usageRepository });
  const pointsService = createPointsService({ pointsRepository });

  return createGenerationOrchestrator({
    generationService,
    usageService,
    jobService,
    pointsService,
    generationTracing,
    generationLogger: logger
  });
}

/**
 * @param {object} params
 * @param {object} params.body - parsed JSON request body
 * @param {string|null} params.userId - authenticated user id (from verified JWT). NEVER from body.
 * @param {string} params.correlationId - single correlation id for the whole flow
 * @param {object} params.deps - either `{ orchestrator }` (tests) or the raw
 *   dependencies accepted by `buildOrchestrator` (real wiring).
 */
async function handleGenerateRequest({ body, userId, correlationId, deps = {} }) {
  if (!userId) {
    return {
      statusCode: 401,
      correlationId,
      body: {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required.", retryable: false, details: null }
      }
    };
  }

  const validationErrors = validateRequestShape(body);
  if (validationErrors.length > 0) {
    return {
      statusCode: 400,
      correlationId,
      body: {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Request validation failed.",
          retryable: false,
          details: { errors: validationErrors }
        }
      }
    };
  }

  const orchestrator = deps.orchestrator || buildOrchestrator(deps);

  let result;
  try {
    result = await orchestrator.createWallpaperGenerationWorkflow({
      userId,
      mascotId: body.mascotId,
      giftId: body.giftId,
      wallpaperStyle: body.wallpaperStyle,
      luckyTheme: body.luckyTheme,
      blessing: body.blessing,
      promptType: body.promptType,
      correlationId
    });
  } catch (error) {
    // Defensive: orchestrator/services are designed to always return a
    // normalized `{ ok: false, error }` result rather than throw, but Edge
    // Function boundaries must never leak a raw exception either way.
    return {
      statusCode: 500,
      correlationId,
      body: {
        ok: false,
        error: {
          code: "GENERATION_FAILURE",
          message: "Unexpected generation failure.",
          retryable: true,
          details: null
        }
      }
    };
  }

  if (!result.ok) {
    return {
      statusCode: toHttpStatus(result.error.code, result.error.details),
      correlationId,
      body: result
    };
  }

  return {
    statusCode: 200,
    correlationId,
    body: result
  };
}

module.exports = {
  handleGenerateRequest,
  buildOrchestrator,
  validateRequestShape,
  toHttpStatus,
  ERROR_HTTP_STATUS,
  REQUIRED_FIELDS,
  FORBIDDEN_FIELDS
};
