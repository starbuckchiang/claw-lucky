"use strict";

/**
 * Shopkeeper Context Agent.
 *
 * Responsibility (AI Constitution Principle 4): produces today's Lucky
 * Context (luckyTheme/blessing/story/oneLiner/shopkeeperMessage) — the
 * Chameleon Shopkeeper's voice. This is a "Lucky Context Producer", NOT a
 * Prompt Builder and NOT an Image Provider:
 *
 * MUST NOT:
 * - assemble the image prompt (Wallpaper Prompt Builder is the ONLY module
 *   allowed to do that — Principle 5)
 * - call an image provider
 *
 * Structured Output ONLY: the injected `textProvider` is asked for JSON
 * (never markdown, never free-form text) so the result can be parsed
 * deterministically (Principle 7).
 *
 * Failure handling (timeout / rate limit / provider failure / invalid or
 * incomplete JSON) NEVER propagates — this Agent ALWAYS resolves to a
 * complete `ShopkeeperContext`, falling back to
 * `shopkeeper-fallback-context.js`'s deterministic content so a failure
 * here can never block wallpaper generation.
 */

const { validateShopkeeperContext } = require("./shopkeeper-context-validator.js");
const { createFallbackShopkeeperContext } = require("./shopkeeper-fallback-context.js");

const PROMPT_TYPE = "daily_lucky_context";

/**
 * Substitutes the (Prompt Registry-loaded) internal Shopkeeper prompt
 * template with the already-resolved mascot/gift identity. This is
 * Shopkeeper's OWN internal prompt (asking a text model for JSON) — it is
 * NEVER the image prompt (that boundary belongs exclusively to
 * wallpaper-prompt-builder.js).
 */
function buildShopkeeperPromptText(template, { mascot, gift }) {
  const variables = {
    mascotSpecies: mascot?.species || "",
    mascotTitle: mascot?.title || "",
    giftName: gift?.name || ""
  };

  let output = String(template || "");
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    output = output.replace(placeholder, String(value));
  }
  return output.trim();
}

function parseShopkeeperContextJson(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (_error) {
    return null;
  }
}

function createShopkeeperContextAgent({ textProvider, promptRegistryLoader, logger }) {
  if (!textProvider || typeof textProvider.generateContext !== "function") {
    throw new Error("createShopkeeperContextAgent requires textProvider.generateContext(input).");
  }
  if (!promptRegistryLoader || typeof promptRegistryLoader.loadActivePrompt !== "function") {
    throw new Error("createShopkeeperContextAgent requires promptRegistryLoader.loadActivePrompt(promptType).");
  }

  const safeLogger = {
    info: typeof logger?.info === "function" ? logger.info.bind(logger) : () => {},
    error: typeof logger?.error === "function" ? logger.error.bind(logger) : () => {}
  };

  /**
   * @param {object} input
   * @param {object|null} input.mascot - already-resolved Mascot DTO
   * @param {object|null} input.gift - already-resolved Gift DTO
   * @param {string} input.wallpaperStyle
   * @param {string} input.correlationId
   * @returns {Promise<{luckyTheme:string,blessing:string,story:string,oneLiner:string,shopkeeperMessage:string,version:string,source:"ai"|"fallback"}>}
   */
  async function generate({ mascot, gift, wallpaperStyle, correlationId }) {
    const started = Date.now();

    try {
      const prompt = await promptRegistryLoader.loadActivePrompt(PROMPT_TYPE);
      const promptText = buildShopkeeperPromptText(prompt.template, { mascot, gift, wallpaperStyle });

      const response = await textProvider.generateContext({ promptText, correlationId });

      const parsed = parseShopkeeperContextJson(response.text);
      if (!parsed) {
        throw new Error("Shopkeeper AI output was not valid JSON.");
      }

      validateShopkeeperContext(parsed);

      const context = {
        luckyTheme: String(parsed.luckyTheme),
        blessing: String(parsed.blessing),
        story: String(parsed.story),
        oneLiner: parsed.oneLiner ? String(parsed.oneLiner) : "",
        shopkeeperMessage: parsed.shopkeeperMessage ? String(parsed.shopkeeperMessage) : "",
        version: String(parsed.version),
        source: "ai"
      };

      safeLogger.info({
        event: "shopkeeper_context_agent_succeeded",
        correlationId,
        payload: {
          source: context.source,
          shopkeeperVersion: context.version,
          durationMs: Date.now() - started
        }
      });

      return context;
    } catch (error) {
      // Never logs prompt text / API keys / raw provider responses — only
      // the safe error name/message, consistent with the rest of this
      // codebase's diagnostic conventions.
      safeLogger.error({
        event: "shopkeeper_context_agent_failed",
        correlationId,
        payload: {
          errorName: error?.name || null,
          errorMessage: error?.message || null,
          durationMs: Date.now() - started
        }
      });

      const fallback = createFallbackShopkeeperContext();

      safeLogger.info({
        event: "shopkeeper_context_agent_fallback_used",
        correlationId,
        payload: {
          source: fallback.source,
          shopkeeperVersion: fallback.version,
          durationMs: Date.now() - started
        }
      });

      return fallback;
    }
  }

  return { generate };
}

module.exports = {
  PROMPT_TYPE,
  createShopkeeperContextAgent
};
