// Loads the shared CommonJS request handlers (and, transitively, all of
// `js/services/wallpaper/*`, `js/services/prompt/*`, `js/services/logging/*`,
// `js/services/ai/gemini-provider.js`, `js/services/ai/provider-types.js`,
// `js/services/ai/provider-adapter.js`, `js/services/ai/wallpaper-provider-adapter.js`
// and `js/services/storage/wallpaper-storage-uploader.js`) into the Deno
// runtime via Node's `createRequire`, WITHOUT converting any of those files
// to ESM.
//
// This is the explicit "server adapter / runtime boundary" required by
// P2-AI-02 instead of rewriting the project as ESM.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function requireSharedGenerateHandler() {
  return require("./wallpaper-generate-handler.js");
}

export function requireSharedStatusHandler() {
  return require("./wallpaper-status-handler.js");
}

/**
 * `gemini-provider.js` only `require()`s `./provider-types.js` (also
 * dependency-free) at module scope — it never touches `@google/genai`
 * directly. The SDK client is always injected by the caller. Safe to load
 * via createRequire in Deno.
 */
export function requireGeminiProvider() {
  return require("../../../js/services/ai/gemini-provider.js");
}
