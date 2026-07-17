// ESM port of `js/services/prompt/fallback-templates.js`. Logic unchanged.

export const SUPPORTED_PROMPT_TYPES = Object.freeze([
  "daily_lucky_context",
  "wallpaper_generation"
]);

const FALLBACK_PROMPTS: Record<string, { version: string; template: string; metadata: Record<string, unknown> }> = Object.freeze({
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

export function getFallbackPrompt(promptType: string) {
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
