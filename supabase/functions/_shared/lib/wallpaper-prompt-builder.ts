// ESM port of `js/services/prompt/wallpaper-prompt-builder.js`. Logic
// unchanged: PURE function — no DB, no repository, no fetch, no env reads,
// no date guessing. Same WallpaperPromptInput -> always the exact same
// WallpaperPromptResult.

import type { WallpaperPromptInput } from "./prompt-context-resolver.ts";

export const BUILDER_VERSION = "wallpaper-prompt-builder-v1";

export interface WallpaperPromptResult {
  promptText: string;
  builderVersion: string;
}

export function buildWallpaperPrompt(input: WallpaperPromptInput): WallpaperPromptResult {
  const mascot = input?.mascot || ({} as WallpaperPromptInput["mascot"]);
  const gift = input?.gift || ({} as WallpaperPromptInput["gift"]);

  const lines = [
    "Create a vertical 9:16 mobile lucky wallpaper.",
    "",
    "Main Character (MUST be preserved exactly — never replaced with a different animal or character):",
    `- Species: ${mascot?.species || ""}`,
    mascot?.title ? `- Title: ${mascot.title}` : null,
    `- Appearance: ${mascot?.appearance || ""}`,
    mascot?.colors ? `- Colors: ${mascot.colors}` : null,
    "",
    "Gift / Accessory (include naturally in the composition):",
    `- ${gift?.name || ""}${gift?.description ? `: ${gift.description}` : ""}`,
    "",
    `Wallpaper Style: ${input?.wallpaperStyle || ""}`,
    `Today's Lucky Theme: ${input?.luckyTheme || ""}`,
    `Today's Blessing: ${input?.blessing || ""}`,
    `Date Watermark (small, tasteful, bottom corner, exactly this text): ${input?.date || ""}`,
    "",
    "Character Consistency Rules:",
    "- Do not substitute the mascot species with a different animal or character.",
    "- Preserve the mascot's species, title, and appearance exactly as described above.",
    "- The mascot is the primary visual identity of this wallpaper.",
    "",
    "Composition: clean background, no extra on-image text besides the date watermark, no logos, no copyrighted characters."
  ].filter((line): line is string => line !== null);

  return {
    promptText: lines.join("\n"),
    builderVersion: BUILDER_VERSION
  };
}
