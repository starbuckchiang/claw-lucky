"use strict";

/**
 * Wallpaper Prompt Builder.
 *
 * THE ONLY module allowed to assemble the final image-generation prompt
 * text (AI Constitution Principle 5). This is a PURE function:
 *
 *   - no database access
 *   - no repository calls
 *   - no fetch / network access
 *   - no environment variable reads
 *   - no date guessing (the date is ALREADY resolved and passed in)
 *
 * Same `WallpaperPromptInput` -> always the exact same `WallpaperPromptResult`
 * (Principle 10: "AI Should Be Predictable" — this module behaves like
 * software, not creative writing).
 *
 * Callers MUST run `validateWallpaperPromptInput(input)` (see
 * prompt-validator.js) before calling `buildWallpaperPrompt` — this module
 * does not validate; it assumes a complete input and will produce a
 * malformed prompt (rather than throw) if given incomplete data, since
 * "never generate incomplete prompts" is the Validator's job, not the
 * Builder's.
 */

const BUILDER_VERSION = "wallpaper-prompt-builder-v1";

/**
 * @param {object} input - WallpaperPromptInput
 * @param {{id:string,species:string,title:string,appearance:string,colors:?string}} input.mascot
 * @param {{id:string,name:string,description:string}} input.gift
 * @param {string} input.wallpaperStyle
 * @param {string} input.luckyTheme
 * @param {string} input.blessing
 * @param {string} input.date - "YYYY.MM.DD", Asia/Taipei
 * @returns {{ promptText: string, builderVersion: string }} WallpaperPromptResult
 */
function buildWallpaperPrompt(input) {
  const mascot = input?.mascot || {};
  const gift = input?.gift || {};

  const lines = [
    "Create a vertical 9:16 mobile lucky wallpaper.",
    "",
    "Main Character (MUST be preserved exactly — never replaced with a different animal or character):",
    `- Species: ${mascot.species || ""}`,
    mascot.title ? `- Title: ${mascot.title}` : null,
    `- Appearance: ${mascot.appearance || ""}`,
    mascot.colors ? `- Colors: ${mascot.colors}` : null,
    "",
    "Gift / Accessory (include naturally in the composition):",
    `- ${gift.name || ""}${gift.description ? `: ${gift.description}` : ""}`,
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
  ].filter((line) => line !== null);

  return {
    promptText: lines.join("\n"),
    builderVersion: BUILDER_VERSION
  };
}

module.exports = {
  BUILDER_VERSION,
  buildWallpaperPrompt
};
