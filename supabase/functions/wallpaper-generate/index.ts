// Supabase Edge Function: wallpaper-generate
//
// Thin Deno HTTP boundary ONLY. All Business Rules (validation, daily limit,
// points deduction, job/generation state machine, prompt registry, provider
// retry/error-normalization, storage upload) live in
// `supabase/functions/_shared/wallpaper-generate-handler.ts` and its
// `_shared/lib/*.ts` ESM ports — line-for-line equivalents of the reviewed
// CommonJS modules under `js/services/**`, kept in sync with the
// Node.js-testable `wallpaper-generate-handler.js`.
//
// --- Why ESM ports instead of reusing the CommonJS files directly ---
// The Supabase Edge Runtime is strict ESM/Deno: it does not support loading
// local CommonJS files via `require()`/`createRequire()` (invisible to the
// deploy bundler's static module graph — the original
// "Cannot find module" failure), NOR does it accept `.cjs` re-export shims
// (deploy-time "unsupported media type Cjs" rejection). Every module
// reached from this entrypoint is therefore a genuine `.ts` ESM file,
// statically `import`-ed, with zero `require()` calls anywhere in the
// runtime path.
//
// This file is responsible for, and ONLY for:
// - CORS
// - Extracting + verifying the authenticated user from the Authorization header
// - Parsing the JSON request body
// - Constructing a single correlationId for the whole flow
// - Constructing the Deno-native Supabase (service-role) client and Gemini client
// - Delegating to the shared handler
// - Translating the handler's `{ statusCode, body }` result into a `Response`
//   (including the `X-Correlation-Id` header)

import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, resolveAuthenticatedUserId } from "../_shared/supabase-clients.ts";
import { createDenoGeminiClient, loadGeminiProviderConfig } from "../_shared/gemini-client.ts";
import { createDenoReplicateClient, loadReplicateProviderConfig } from "../_shared/replicate-client.ts";
import { handleGenerateRequest } from "../_shared/wallpaper-generate-handler.ts";
import { GeminiProvider } from "../_shared/lib/gemini-provider.ts";
import { ReplicateFluxProvider } from "../_shared/lib/replicate-flux-provider.ts";

/**
 * Builds the OPTIONAL Replicate fallback provider dependencies for
 * `handleGenerateRequest`'s `deps`. Returns `{}` (no fallback fields) when
 * `REPLICATE_API_TOKEN` is not configured — the Provider Resilience Agent
 * then behaves exactly as a bare primary-only ProviderAdapter.
 */
function buildFallbackProviderDeps(correlationId: string) {
  const replicateConfig = loadReplicateProviderConfig();
  if (!replicateConfig) {
    return {};
  }

  const replicateClient = createDenoReplicateClient(replicateConfig.apiToken, replicateConfig.model);
  const fallbackProvider = new ReplicateFluxProvider({
    config: replicateConfig,
    client: replicateClient,
    logger: {
      info: (entry: unknown) => console.log(JSON.stringify({ level: "info", correlationId, entry })),
      error: (entry: unknown) => console.error(JSON.stringify({ level: "error", correlationId, entry })),
    },
  });

  return { fallbackProvider, fallbackProviderConfig: replicateConfig };
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  const correlationId = crypto.randomUUID();

  if (req.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Only POST is supported.", retryable: false },
    }, correlationId);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (_error) {
    return jsonResponse(400, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON.", retryable: false },
    }, correlationId);
  }

  const userId = await resolveAuthenticatedUserId(req);

  try {
    const providerConfig = loadGeminiProviderConfig();
    const supabaseClient = createServiceClient();

    const geminiClient = createDenoGeminiClient(providerConfig.apiKey);
    const geminiProvider = new GeminiProvider({
      config: providerConfig,
      client: geminiClient,
      // Minimal structured logger; the shared handler wraps generationLogger
      // around ProviderAdapter, but GeminiProvider itself is constructed
      // directly here so it needs its own no-secret logger too.
      logger: {
        info: (entry: unknown) => console.log(JSON.stringify({ level: "info", correlationId, entry })),
        error: (entry: unknown) => console.error(JSON.stringify({ level: "error", correlationId, entry })),
      },
    });

    const result = await handleGenerateRequest({
      body,
      userId,
      correlationId,
      deps: {
        supabaseClient,
        geminiProvider,
        providerConfig,
        // Fallback is entirely OPTIONAL and config-driven (Provider
        // Resilience Agent, P2-AI-03). If REPLICATE_API_TOKEN /
        // REPLICATE_MODEL are not set, `fallbackProvider` stays
        // undefined and `buildOrchestrator()` falls back to its pre-existing
        // primary-only behavior — zero change for deployments that haven't
        // provisioned Replicate yet.
        ...buildFallbackProviderDeps(correlationId),
      },
    });

    return jsonResponse(result.statusCode, result.body, correlationId);
  } catch (error) {
    // Last-resort safety net: never leak a raw exception / stack trace / secret.
    console.error(JSON.stringify({
      level: "error",
      event: "wallpaper_generate_unhandled_error",
      correlationId,
      message: error instanceof Error ? error.message : "unknown",
    }));

    return jsonResponse(500, {
      ok: false,
      error: { code: "GENERATION_FAILURE", message: "Unexpected server error.", retryable: true },
    }, correlationId);
  }
});
