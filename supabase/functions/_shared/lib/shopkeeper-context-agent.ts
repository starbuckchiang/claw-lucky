// ESM port of `js/services/shopkeeper/shopkeeper-context-agent.js`. Logic
// unchanged.

import { validateShopkeeperContext } from "./shopkeeper-context-validator.ts";
import { createFallbackShopkeeperContext, type ShopkeeperContext } from "./shopkeeper-fallback-context.ts";
import type { MascotDto } from "./mascot-repository.ts";
import type { GiftDto } from "./gift-repository.ts";

export const PROMPT_TYPE = "daily_lucky_context";

function buildShopkeeperPromptText(
  template: string,
  { mascot, gift }: { mascot: MascotDto | null; gift: GiftDto | null }
): string {
  const variables: Record<string, string> = {
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

// deno-lint-ignore no-explicit-any
function parseShopkeeperContextJson(rawText: string): any {
  try {
    return JSON.parse(rawText);
  } catch (_error) {
    return null;
  }
}

export function createShopkeeperContextAgent({
  textProvider,
  promptRegistryLoader,
  logger
}: {
  textProvider: {
    generateContext(input: { promptText: string; correlationId: string }): Promise<{ text: string; durationMs: number }>;
  };
  promptRegistryLoader: {
    // deno-lint-ignore no-explicit-any
    loadActivePrompt(promptType: string): Promise<any>;
  };
  // deno-lint-ignore no-explicit-any
  logger?: any;
}) {
  if (!textProvider || typeof textProvider.generateContext !== "function") {
    throw new Error("createShopkeeperContextAgent requires textProvider.generateContext(input).");
  }
  if (!promptRegistryLoader || typeof promptRegistryLoader.loadActivePrompt !== "function") {
    throw new Error("createShopkeeperContextAgent requires promptRegistryLoader.loadActivePrompt(promptType).");
  }

  const safeLogger = {
    // deno-lint-ignore no-explicit-any
    info: typeof logger?.info === "function" ? logger.info.bind(logger) : (_e: any) => {},
    // deno-lint-ignore no-explicit-any
    error: typeof logger?.error === "function" ? logger.error.bind(logger) : (_e: any) => {}
  };

  async function generate(
    { mascot, gift, wallpaperStyle, correlationId }: {
      mascot: MascotDto | null;
      gift: GiftDto | null;
      wallpaperStyle: string;
      correlationId: string;
    }
  ): Promise<ShopkeeperContext> {
    const started = Date.now();

    try {
      const prompt = await promptRegistryLoader.loadActivePrompt(PROMPT_TYPE);
      const promptText = buildShopkeeperPromptText(prompt.template, { mascot, gift });

      const response = await textProvider.generateContext({ promptText, correlationId });

      const parsed = parseShopkeeperContextJson(response.text);
      if (!parsed) {
        throw new Error("Shopkeeper AI output was not valid JSON.");
      }

      validateShopkeeperContext(parsed);

      const context: ShopkeeperContext = {
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
      // deno-lint-ignore no-explicit-any
      const err = error as any;
      safeLogger.error({
        event: "shopkeeper_context_agent_failed",
        correlationId,
        payload: {
          errorName: err?.name || null,
          errorMessage: err?.message || null,
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
