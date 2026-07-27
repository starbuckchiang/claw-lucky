"use strict";

const SUPPORTED_PROMPT_TYPES = Object.freeze([
  "daily_lucky_context",
  "wallpaper_generation"
]);

const FALLBACK_PROMPTS = Object.freeze({
  // P2-AI-03 Gate Review fix: this template's JSON schema MUST match
  // `shopkeeper-context-validator.js`'s `validateShopkeeperContext()`
  // exactly (camelCase luckyTheme/blessing/story/oneLiner/
  // shopkeeperMessage/version, all non-empty strings) — otherwise every
  // real AI call fails validation and silently degrades to
  // `shopkeeper-fallback-context.js` forever. `version` is a FIXED literal
  // the model must echo back verbatim (never AI-invented — AI Constitution
  // Principle 6: version/schema metadata is system-known, not AI-guessed).
  daily_lucky_context: Object.freeze({
    version: "fallback-daily-lucky-context-v1",
    template:
      "你是「幸運雜貨店」的老闆娘，請為今天生成一份專屬的幸運內容。\n\n" +
      "規則：\n" +
      "1. 只能輸出一個合法的 JSON 物件，不得包含任何 Markdown 標記（例如 ```json 或 ```），不得包含 JSON 以外的任何說明文字。\n" +
      "2. JSON 物件必須完整包含下列 6 個欄位，欄位名稱必須完全一致（camelCase）：\n" +
      "   - luckyTheme：今天的幸運主題（繁體中文，非空字串）\n" +
      "   - blessing：給使用者的祝福語（繁體中文，非空字串）\n" +
      "   - story：今天的幸運小故事（繁體中文，非空字串）\n" +
      "   - oneLiner：一句話祝福（繁體中文，非空字串）\n" +
      "   - shopkeeperMessage：老闆娘想說的話（繁體中文，非空字串）\n" +
      "   - version：固定填入字串 \"shopkeeper-context-v1\"（非空字串，不需要自行產生）\n" +
      "3. 除了 version 之外，所有欄位內容都必須以繁體中文撰寫，且不得為空字串。\n" +
      "4. 吉祥物：{{mascotSpecies}}（{{mascotTitle}}）。禮物：{{giftName}}。請讓內容自然融入吉祥物與禮物的特色。\n\n" +
      "請直接輸出 JSON，不要有任何其他文字。",
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
