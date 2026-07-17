// Supabase Edge Function: wallpaper-generate
//
// Thin Deno HTTP boundary ONLY. All Business Rules (validation, daily limit,
// points deduction, job/generation state machine, prompt registry, provider
// retry/error-normalization, storage upload) live in the reused CommonJS
// modules under `js/services/**` and `supabase/functions/_shared/wallpaper-generate-handler.js`.
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
import { requireGeminiProvider, requireSharedGenerateHandler } from "../_shared/node-require.ts";

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

  const { handleGenerateRequest } = requireSharedGenerateHandler();

  try {
    const providerConfig = loadGeminiProviderConfig();
    const supabaseClient = createServiceClient();

    const { GeminiProvider } = requireGeminiProvider();
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
