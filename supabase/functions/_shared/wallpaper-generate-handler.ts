// Wallpaper Generate — Shared Request Handler (Deno ESM port).
//
// This is the ESM twin of `wallpaper-generate-handler.js` (which remains the
// Node.js-testable CommonJS source of truth, unit-tested under
// `supabase/functions/_shared/__tests__/`). Logic is IDENTICAL — same
// validation, same HTTP status mapping, same error contract, same
// orchestrator wiring shape — only the module syntax differs (`import`/
// `export` instead of `require`/`module.exports`), because the Supabase Edge
// Runtime requires ESM and does not support `.cjs` / CommonJS wrappers /
// `require()` (see the root-cause note in `index.ts`).
//
// If you change business logic here, mirror the change in
// `wallpaper-generate-handler.js` (and vice versa) — the two files are kept
// in lockstep by convention (same function names, same error codes, same
// HTTP status mapping), one for Deno/ESM, one for Node.js unit tests.

import { createGenerationOrchestrator } from "./lib/generation-orchestrator.ts";
import { createGenerationService } from "./lib/generation-service.ts";
import { createJobService } from "./lib/job-service.ts";
import { createUsageService } from "./lib/usage-service.ts";
import { createPointsService } from "./lib/points-service.ts";
import { createGenerationRepositoryFromSupabaseClient } from "./lib/generation-repository.ts";
import { createJobRepositoryFromSupabaseClient } from "./lib/job-repository.ts";
import { createUsageRepositoryFromSupabaseClient } from "./lib/usage-repository.ts";
import { createPointsRepositoryFromSupabaseClient } from "./lib/points-repository.ts";
import { createPromptRegistryLoader, createPromptRepositoryFromSupabaseClient } from "./lib/prompt-registry-loader.ts";
import { ProviderAdapter } from "./lib/provider-adapter.ts";
import { createWallpaperProviderAdapter } from "./lib/wallpaper-provider-adapter.ts";
import { createProviderResilienceAgent } from "./lib/provider-resilience-agent.ts";
import { createWallpaperStorageUploader } from "./lib/wallpaper-storage-uploader.ts";
import { createGenerationLogger } from "./lib/generation-logger.ts";
import { createGenerationTracing } from "./lib/generation-tracing.ts";

export const ERROR_HTTP_STATUS: Record<string, number> = Object.freeze({
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

// See `wallpaper-generate-handler.js` for the full rationale: the approved
// P1-BIZ-03 contract folds every provider failure other than
// TIMEOUT/INVALID_RESPONSE into the generic top-level `PROVIDER_FAILURE`
// code, preserving the specific failureCode in `error.details.failureCode`.
const PROVIDER_FAILURE_DETAIL_HTTP_STATUS: Record<string, number> = Object.freeze({
  PROVIDER_RATE_LIMIT: 429,
  PROVIDER_AUTH_FAILED: 502,
  PROVIDER_BAD_REQUEST: 502,
  PROVIDER_UNAVAILABLE: 503,
  STORAGE_UPLOAD_FAILED: 502
});

export function toHttpStatus(code: string, details?: { failureCode?: string } | null): number {
  if (code === "PROVIDER_FAILURE" && details?.failureCode) {
    const refined = PROVIDER_FAILURE_DETAIL_HTTP_STATUS[details.failureCode];
    if (refined) {
      return refined;
    }
  }

  return ERROR_HTTP_STATUS[code] || 500;
}

export const REQUIRED_FIELDS = ["mascotId", "giftId", "wallpaperStyle", "luckyTheme", "blessing", "promptType"];

export const FORBIDDEN_FIELDS = [
  "userId",
  "apiKey",
  "apiKeys",
  "serviceRoleKey",
  "service_role_key",
  "storagePath",
  "storageBucket",
  "promptTemplate"
];

// deno-lint-ignore no-explicit-any
export function validateRequestShape(body: any): string[] {
  const errors: string[] = [];

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

// deno-lint-ignore no-explicit-any
export function wrapLoggerForProvider(generationLogger: any) {
  return {
    // deno-lint-ignore no-explicit-any
    info(entry: any) {
      generationLogger.logInfo({
        event: entry?.event || "provider_event",
        correlationId: entry?.correlationId,
        payload: entry
      });
    },
    // deno-lint-ignore no-explicit-any
    error(entry: any) {
      generationLogger.logError({
        event: entry?.event || "provider_error",
        correlationId: entry?.correlationId,
        payload: entry
      });
    }
  };
}

export function buildOrchestrator({
  supabaseClient,
  geminiProvider,
  providerConfig,
  generationLogger,
  fallbackProvider,
  fallbackProviderConfig
}: {
  // deno-lint-ignore no-explicit-any
  supabaseClient: any;
  // deno-lint-ignore no-explicit-any
  geminiProvider: any;
  // deno-lint-ignore no-explicit-any
  providerConfig: any;
  // deno-lint-ignore no-explicit-any
  generationLogger?: any;
  // OPTIONAL pre-constructed fallback provider instance (e.g. a
  // ReplicateFluxProvider wired with a Deno-native Replicate client). When
  // omitted (the default — no fallback configured), the Provider Resilience
  // Agent behaves EXACTLY like a bare ProviderAdapter: any primary failure
  // is rethrown immediately, unchanged.
  // deno-lint-ignore no-explicit-any
  fallbackProvider?: any;
  // deno-lint-ignore no-explicit-any
  fallbackProviderConfig?: any;
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
  // _shared/lib/provider-resilience-agent.ts). This is the SMALLEST
  // integration point — it exposes the exact same `generateImage(input)`
  // contract a single ProviderAdapter exposes today, so it is a drop-in
  // replacement for `rawProviderAdapter` below. `generation-service.ts` /
  // `generation-orchestrator.ts` are UNCHANGED.
  let fallbackEntry: { name: string; adapter: ProviderAdapter } | null = null;
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
    // Same wrapping used for primaryAdapter/fallbackAdapter above: the
    // Provider Resilience Agent expects a plain { info(entry), error(entry) }
    // logger (like GeminiProvider/ReplicateFluxProvider), NOT the raw
    // generationLogger (logInfo/logWarn/logError). Passing the raw logger
    // here caused `safeLogger.info(...)` to throw a TypeError on the very
    // first line of generateImage() — before Gemini was ever called and
    // before isFallbackEligible() could run.
    logger: wrapLoggerForProvider(logger)
  });

  const storageUploader = createWallpaperStorageUploader({ supabaseClient });

  const providerAdapter = createWallpaperProviderAdapter({
    providerAdapter: rawProviderAdapter,
    storageUploader,
    // Same wrapping used for the Resilience Agent / GeminiProvider /
    // ReplicateFluxProvider above: this adapter's own safeLogger calls
    // `.info(entry)`/`.error(entry)`, NOT the raw generationLogger's
    // `.logInfo(entry)`/`.logError(entry)`. Passing the raw logger here
    // caused `safeLogger.info is not a function` on the success path (and
    // `safeLogger.error is not a function` on a storage-upload failure).
    logger: wrapLoggerForProvider(logger)
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

export interface GenerateHandlerResult {
  statusCode: number;
  correlationId: string;
  // deno-lint-ignore no-explicit-any
  body: any;
}

export async function handleGenerateRequest({
  body,
  userId,
  correlationId,
  deps = {}
}: {
  // deno-lint-ignore no-explicit-any
  body: any;
  userId: string | null;
  correlationId: string;
  // deno-lint-ignore no-explicit-any
  deps?: any;
}): Promise<GenerateHandlerResult> {
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

  // deno-lint-ignore no-explicit-any
  let result: any;
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
  } catch (_error) {
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
