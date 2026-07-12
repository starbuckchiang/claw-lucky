"use strict";

const SUPPORTED_PROMPT_TYPES = Object.freeze([
  "daily_lucky_context",
  "wallpaper_generation"
]);

const FALLBACK_PROMPTS = Object.freeze({
  daily_lucky_context: Object.freeze({
    version: "fallback-daily-lucky-context-v1",
    template:
      "Generate one positive daily lucky context in Traditional Chinese with fields: lucky_theme, blessing, one_liner.",
    metadata: Object.freeze({
      fallback: true,
      safetyLevel: "strict"
    })
  }),
  wallpaper_generation: Object.freeze({
    version: "fallback-wallpaper-generation-v1",
    template:
      "Generate a 1080x1920 wallpaper prompt that includes mascot, gift, lucky_theme, blessing, date watermark, and safe content constraints.",
    metadata: Object.freeze({
      fallback: true,
      safetyLevel: "strict"
    })
  })
});

function getFallbackPrompt(promptType) {
  const fallback = FALLBACK_PROMPTS[promptType];

  if (!fallback) {
    throw new Error(`No fallback template configured for promptType: ${promptType}`);
  }

  return {
    promptType,
    version: fallback.version,
    template: fallback.template,
    metadata: { ...fallback.metadata },
    source: "fallback"
  };
}

module.exports = {
  SUPPORTED_PROMPT_TYPES,
  getFallbackPrompt
};
