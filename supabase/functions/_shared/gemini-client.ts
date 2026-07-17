// Deno-native Gemini client wrapper.
//
// This is the ONLY file in the Edge Function runtime that imports the
// `@google/genai` SDK. It exists purely so `js/services/ai/gemini-provider.js`
// (plain CommonJS, zero npm deps at module scope) can be reused unmodified:
// the SDK client is constructed here (Deno-native `npm:` specifier import)
// and then *injected* into `GeminiProvider` as its `client` constructor
// argument. `GeminiProvider` itself never calls `require("@google/genai")`.
//
// This mirrors ADR-005 ("只有 server-side GeminiProvider 可以知道 Gemini SDK")
// while keeping the Edge Function's Deno/npm boundary explicit and isolated.

// deno-lint-ignore no-explicit-any
import { GoogleGenAI } from "npm:@google/genai@^1.0.0";

export interface GeminiProviderConfig {
  model: string;
  timeoutMs: number;
  maxRetry: number;
  imageSize: string;
  safetyLevel: string;
  apiKey: string;
  debugRawResponse: boolean;
}

export function loadGeminiProviderConfig(): GeminiProviderConfig {
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY secret is not configured for this Edge Function.");
  }

  return {
    model: Deno.env.get("AI_PROVIDER_MODEL") ?? "gemini-2.5-flash-image",
    timeoutMs: Number(Deno.env.get("AI_PROVIDER_TIMEOUT_MS") ?? "20000"),
    maxRetry: Number(Deno.env.get("AI_PROVIDER_MAX_RETRY") ?? "2"),
    imageSize: Deno.env.get("AI_PROVIDER_IMAGE_SIZE") ?? "1024x1792",
    safetyLevel: Deno.env.get("AI_PROVIDER_SAFETY_LEVEL") ?? "BLOCK_MEDIUM_AND_ABOVE",
    apiKey,
    debugRawResponse: false,
  };
}

/**
 * Constructs a Deno-native GoogleGenAI client. The returned object satisfies
 * the same shape `GeminiProvider` expects: `client.models.generateContent(...)`.
 */
export function createDenoGeminiClient(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}
