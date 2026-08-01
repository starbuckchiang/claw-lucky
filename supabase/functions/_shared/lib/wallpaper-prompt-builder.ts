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
    `Mood / Theme Reference (for color palette and atmosphere ONLY — never render this phrase as visible text): ${input?.luckyTheme || ""}`,
    "",
    "Character Consistency Rules:",
    "- Do not substitute the mascot species with a different animal or character.",
    "- Preserve the mascot's species, title, and appearance exactly as described above.",
    "- The mascot is the primary visual identity of this wallpaper.",
    "",
    "STRICTLY NO TEXT — this image must contain absolutely no rendered text or writing-like marks of any kind:",
    "- No text, no letters, no numbers, no Chinese characters, no Japanese characters.",
    "- No calligraphy, no captions, no signatures, no logos, no watermarks.",
    "- No stamps, no seals, no labels, no plaques, no writing-like symbols or glyphs.",
    "- Do not render the Mood/Theme phrase above (or any other words) as visible text anywhere in the image.",
    "",
    "Text-Safe Zone: keep the bottom area of the composition calm, clean, and low-detail (soft gradient or simple background only — no objects, patterns, or marks there) — this space is reserved for text to be added afterward outside of this image.",
    "",
    "Composition: clean background, no on-image text of any kind, no logos, no copyrighted characters."
  ].filter((line): line is string => line !== null);

  return {
    promptText: lines.join("\n"),
    builderVersion: BUILDER_VERSION
  };
}
