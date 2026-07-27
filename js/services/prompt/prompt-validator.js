"use strict";

/**
 * Prompt Validator.
 *
 * Responsibility (AI Constitution Principle 8: "Validation Before
 * Generation"): validates a resolved `WallpaperPromptInput` (produced by
 * the Prompt Context Resolver) has every field the Wallpaper Prompt Builder
 * requires. Missing data is an error — generating an incomplete prompt is
 * prohibited. This is checked BEFORE the (pure) Builder ever runs.
 */

class PromptValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "PromptValidationError";
    this.code = "PROMPT_VALIDATION_FAILED";
    this.retryable = false;
    this.details = details || null;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {object} input - WallpaperPromptInput (see prompt-context-resolver.js)
 * @throws {PromptValidationError} if any required field is missing.
 */
function validateWallpaperPromptInput(input) {
  const errors = [];

  if (!input?.mascot || !isNonEmptyString(input.mascot.species)) {
    errors.push("mascot.species is required");
  }
  if (!input?.mascot || !isNonEmptyString(input.mascot.appearance)) {
    errors.push("mascot.appearance is required");
  }
  if (!input?.gift || !isNonEmptyString(input.gift.name)) {
    errors.push("gift.name is required");
  }
  if (!isNonEmptyString(input?.wallpaperStyle)) {
    errors.push("wallpaperStyle is required");
  }
  if (!isNonEmptyString(input?.luckyTheme)) {
    errors.push("luckyTheme is required");
  }
  if (!isNonEmptyString(input?.blessing)) {
    errors.push("blessing is required");
  }
  if (!isNonEmptyString(input?.date)) {
    errors.push("date is required");
  }

  if (errors.length > 0) {
    throw new PromptValidationError("Wallpaper prompt input is incomplete.", { errors });
  }
}

module.exports = {
  PromptValidationError,
  validateWallpaperPromptInput
};
