"use strict";

/**
 * Wallpaper Generate — Shared Request Handler
 *
 * This module contains the ENTIRE request-handling logic for the
 * `wallpaper-generate` Supabase Edge Function, expressed as plain CommonJS
 * with no Deno-specific or HTTP-framework-specific code.
 *
 * Why this exists (P2-AI-02 runtime boundary):
 * - Supabase Edge Functions run on Deno. This file itself stays plain
 *   CommonJS and only `require()`s other local, dependency-free CommonJS
 *   files (all of `js/services/wallpaper/*`, `js/services/logging/*`,
 *   `js/services/prompt/*`, `js/services/ai/gemini-provider.js`,
 *   `js/services/ai/provider-types.js`, `js/services/ai/wallpaper-provider-adapter.js`,
 *   and `js/services/storage/wallpaper-storage-uploader.js` qualify — none of
 *   them `require()` an npm package at module scope). Deno's Node
 *   compatibility layer resolves these ordinary `require()` calls at runtime
 *   without issue.
 * - This file is reached from Deno via a literal, static `import` of
 *   `wallpaper-generate-handler-loader.cjs` in `node-require.ts` (NOT a
 *   dynamic `createRequire(...)` call) — the static import is what lets
 *   Supabase's Edge Function deploy bundler discover and include this file
 *   (and this file's own require graph) in the deployed artifact. See the
 *   comment at the top of `node-require.ts` for the full root-cause writeup.
 * - `js/services/ai/provider-adapter.js` only pulls in `@google/genai`
 *   (via `provider-factory.js`) when no provider is injected (see that file's
 *   constructor). The Deno entrypoint (`supabase/functions/wallpaper-generate/index.ts`)
 *   ALWAYS injects a `GeminiProvider` wired with a Deno-native
 *   `GoogleGenAI` client (imported via the `npm:@google/genai` specifier),
 *   so the Node-only `require("@google/genai")` path is never executed.
 * - This keeps 100% of the actual Business Rules (Orchestrator, Generation
 *   Service, Job/Usage/Points Services, Prompt Registry, error normalization)
 *   running as the SAME reviewed CommonJS modules used by Node.js unit tests
 *   and (future) other backends. No business logic is duplicated in Deno.
 * - The only Deno-side "thin wrapper" code is: CORS handling, JWT/user
 *   extraction, constructing the Deno-native Supabase clients + Gemini
 *   client, and translating this module's `{ statusCode, body }` result into
 *   a `Response`. See `supabase/functions/wallpaper-generate/index.ts`.
 *
 * This module is directly `require()`-able (and unit-testable) from Node.js.
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
 */
function buildOrchestrator({ supabaseClient, geminiProvider, providerConfig, generationLogger }) {
  const logger = generationLogger || createGenerationLogger();
  const generationTracing = createGenerationTracing();

  const promptRegistryLoader = createPromptRegistryLoader({
    repository: createPromptRepositoryFromSupabaseClient({ supabaseClient })
  });

  const rawProviderAdapter = new ProviderAdapter(
    wrapLoggerForProvider(logger),
    providerConfig,
    geminiProvider
  );

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
