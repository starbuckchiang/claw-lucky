// ESM port of `js/services/prompt/prompt-validator.js`. Logic unchanged.

import type { WallpaperPromptInput } from "./prompt-context-resolver.ts";

export class PromptValidationError extends Error {
  code: string;
  retryable: boolean;
  details: unknown;

  constructor(message: string, details: unknown) {
    super(message);
    this.name = "PromptValidationError";
    this.code = "PROMPT_VALIDATION_FAILED";
    this.retryable = false;
    this.details = details || null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateWallpaperPromptInput(input: WallpaperPromptInput): void {
  const errors: string[] = [];

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
