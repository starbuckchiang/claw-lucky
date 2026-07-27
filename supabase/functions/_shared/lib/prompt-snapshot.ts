// ESM port of `js/services/prompt/prompt-snapshot.js`. Logic unchanged.

import type { WallpaperPromptResult } from "./wallpaper-prompt-builder.ts";

export function buildPromptSnapshot({
  promptResult,
  contextVersion
}: {
  promptResult: WallpaperPromptResult;
  contextVersion: string;
}) {
  return {
    promptSnapshot: String(promptResult?.promptText || ""),
    contextVersion: String(contextVersion || ""),
    builderVersion: String(promptResult?.builderVersion || "")
  };
}
