// Loads the shared CommonJS request handlers (and, transitively, all of
// `js/services/wallpaper/*`, `js/services/prompt/*`, `js/services/logging/*`,
// `js/services/ai/gemini-provider.js`, `js/services/ai/provider-types.js`,
// `js/services/ai/provider-adapter.js`, `js/services/ai/wallpaper-provider-adapter.js`
// and `js/services/storage/wallpaper-storage-uploader.js`) into the Deno
// runtime, WITHOUT converting any of those files to ESM.
//
// This is the explicit "server adapter / runtime boundary" required by
// P2-AI-02 instead of rewriting the project as ESM.
//
// --- Root cause of "Cannot find module './wallpaper-generate-handler.js'" ---
// This file previously used `node:module`'s `createRequire(import.meta.url)`
// to obtain a `require` FUNCTION VALUE, then called it dynamically:
// `require("./wallpaper-generate-handler.js")`. That call target is just a
// regular function invocation from the bundler's point of view — it is not
// the literal, statically-recognized `import`/`require` syntax that
// Supabase's Edge Function deploy step (esbuild/eszip module-graph bundling)
// looks for when deciding which files to include in the deployed artifact.
// As a result, `wallpaper-generate-handler.js` (and `wallpaper-status-handler.js`
// / `gemini-provider.js`) were never bundled/uploaded, even though they exist
// on disk in this repo. `supabase functions serve` (local dev) reads directly
// from the filesystem and therefore never surfaced this — the failure only
// appears after a real `supabase functions deploy`, which ships the bundled
// artifact rather than the raw source tree.
//
// Fix: replace the dynamic `createRequire(...)` call with plain, literal,
// static `import` statements of `.cjs` re-export shims (see the three
// `*-loader.cjs` files in this directory). `.cjs` makes the module kind
// (CommonJS) unambiguous to Deno, and a static `import` IS part of the
// module graph the deploy bundler traces — so these files are now correctly
// included in the deployed artifact. None of the actual handler/business
// logic files were renamed or modified.
import wallpaperGenerateHandlerModule from "./wallpaper-generate-handler-loader.cjs";
import wallpaperStatusHandlerModule from "./wallpaper-status-handler-loader.cjs";
import geminiProviderModule from "./gemini-provider-loader.cjs";

export function requireSharedGenerateHandler() {
  return wallpaperGenerateHandlerModule;
}

export function requireSharedStatusHandler() {
  return wallpaperStatusHandlerModule;
}

/**
 * `gemini-provider.js` only `require()`s `./provider-types.js` (also
 * dependency-free) at module scope — it never touches `@google/genai`
 * directly. The SDK client is always injected by the caller. Safe to load
 * statically in Deno via the `.cjs` shim above.
 */
export function requireGeminiProvider() {
  return geminiProviderModule;
}

