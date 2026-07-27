"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createShopkeeperContextAgent, PROMPT_TYPE } = require("../shopkeeper-context-agent");
const { FALLBACK_VERSION } = require("../shopkeeper-fallback-context");
const { NormalizedProviderError } = require("../../ai/provider-types");

function createPromptRegistryLoaderMock(template = "Write about {{mascotSpecies}} and {{giftName}}.") {
  return {
    async loadActivePrompt(promptType) {
      assert.equal(promptType, PROMPT_TYPE);
      return { promptType, version: "daily-lucky-context-v1", template, source: "database" };
    }
  };
}

function createTextProviderMock({ text, error } = {}) {
  return {
    async generateContext() {
      if (error) {
        throw error;
      }
      return { text, durationMs: 42 };
    }
  };
}

function capturingLogger() {
  const info = [];
  const errorEntries = [];
  return {
    info: (entry) => info.push(entry),
    error: (entry) => errorEntries.push(entry),
    entries: { info, errorEntries }
  };
}

const VALID_AI_JSON = JSON.stringify({
  luckyTheme: "Golden Day",
  blessing: "Fortune follows you.",
  story: "A tiny lucky story unfolds today.",
  oneLiner: "Shine on.",
  shopkeeperMessage: "Hi there, lucky friend!",
  version: "daily-lucky-context-v1"
});

const mascot = { id: "mascot-1", species: "Penguin", title: "Lucky Penguin", appearance: "...", colors: null };
const gift = { id: "gift-1", name: "Lucky Charm", description: "..." };

test("JSON Parse Success -> returns AI-sourced context", async () => {
  const agent = createShopkeeperContextAgent({
    textProvider: createTextProviderMock({ text: VALID_AI_JSON }),
    promptRegistryLoader: createPromptRegistryLoaderMock(),
    logger: capturingLogger()
  });

  const context = await agent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-1" });

  assert.equal(context.source, "ai");
  assert.equal(context.luckyTheme, "Golden Day");
  assert.equal(context.blessing, "Fortune follows you.");
  assert.equal(context.story, "A tiny lucky story unfolds today.");
  assert.equal(context.oneLiner, "Shine on.");
  assert.equal(context.shopkeeperMessage, "Hi there, lucky friend!");
  assert.equal(context.version, "daily-lucky-context-v1");
});

test("AI output is not valid JSON -> Fallback", async () => {
  const agent = createShopkeeperContextAgent({
    textProvider: createTextProviderMock({ text: "not json at all" }),
    promptRegistryLoader: createPromptRegistryLoaderMock(),
    logger: capturingLogger()
  });

  const context = await agent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-2" });

  assert.equal(context.source, "fallback");
  assert.equal(context.version, FALLBACK_VERSION);
});

test("Missing Story -> Fallback", async () => {
  const incomplete = JSON.parse(VALID_AI_JSON);
  delete incomplete.story;

  const agent = createShopkeeperContextAgent({
    textProvider: createTextProviderMock({ text: JSON.stringify(incomplete) }),
    promptRegistryLoader: createPromptRegistryLoaderMock(),
    logger: capturingLogger()
  });

  const context = await agent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-3" });

  assert.equal(context.source, "fallback");
  assert.ok(context.story.length > 0);
});

test("Missing Blessing -> Fallback", async () => {
  const incomplete = JSON.parse(VALID_AI_JSON);
  incomplete.blessing = "";

  const agent = createShopkeeperContextAgent({
    textProvider: createTextProviderMock({ text: JSON.stringify(incomplete) }),
    promptRegistryLoader: createPromptRegistryLoaderMock(),
    logger: capturingLogger()
  });

  const context = await agent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-4" });

  assert.equal(context.source, "fallback");
  assert.ok(context.blessing.length > 0);
});

test("AI Timeout -> Fallback", async () => {
  const timeoutError = new NormalizedProviderError("PROVIDER_TIMEOUT", "timed out", true, 408, null, null);

  const agent = createShopkeeperContextAgent({
    textProvider: createTextProviderMock({ error: timeoutError }),
    promptRegistryLoader: createPromptRegistryLoaderMock(),
    logger: capturingLogger()
  });

  const context = await agent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-5" });

  assert.equal(context.source, "fallback");
  assert.equal(context.version, FALLBACK_VERSION);
});

test("Provider Failure -> Fallback", async () => {
  const providerError = new NormalizedProviderError("PROVIDER_UNAVAILABLE", "service unavailable", true, 503, null, null);

  const agent = createShopkeeperContextAgent({
    textProvider: createTextProviderMock({ error: providerError }),
    promptRegistryLoader: createPromptRegistryLoaderMock(),
    logger: capturingLogger()
  });

  const context = await agent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-6" });

  assert.equal(context.source, "fallback");
  assert.equal(context.version, FALLBACK_VERSION);
});

test("fallback is never empty (luckyTheme/blessing/story all non-empty)", async () => {
  const agent = createShopkeeperContextAgent({
    textProvider: createTextProviderMock({ error: new Error("boom") }),
    promptRegistryLoader: createPromptRegistryLoaderMock(),
    logger: capturingLogger()
  });

  const context = await agent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-7" });

  assert.ok(context.luckyTheme.length > 0);
  assert.ok(context.blessing.length > 0);
  assert.ok(context.story.length > 0);
});

test("observability: logs correlationId/durationMs/shopkeeperVersion/source, distinguishing AI vs Fallback", async () => {
  const aiLogger = capturingLogger();
  const aiAgent = createShopkeeperContextAgent({
    textProvider: createTextProviderMock({ text: VALID_AI_JSON }),
    promptRegistryLoader: createPromptRegistryLoaderMock(),
    logger: aiLogger
  });
  await aiAgent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-obs-ai" });

  const aiSuccessEntry = aiLogger.entries.info.find((entry) => entry.event === "shopkeeper_context_agent_succeeded");
  assert.ok(aiSuccessEntry);
  assert.equal(aiSuccessEntry.correlationId, "corr-obs-ai");
  assert.equal(aiSuccessEntry.payload.source, "ai");
  assert.equal(typeof aiSuccessEntry.payload.shopkeeperVersion, "string");
  assert.equal(typeof aiSuccessEntry.payload.durationMs, "number");

  const fallbackLogger = capturingLogger();
  const fallbackAgent = createShopkeeperContextAgent({
    textProvider: createTextProviderMock({ error: new Error("boom") }),
    promptRegistryLoader: createPromptRegistryLoaderMock(),
    logger: fallbackLogger
  });
  await fallbackAgent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-obs-fallback" });

  const fallbackEntry = fallbackLogger.entries.info.find((entry) => entry.event === "shopkeeper_context_agent_fallback_used");
  assert.ok(fallbackEntry);
  assert.equal(fallbackEntry.correlationId, "corr-obs-fallback");
  assert.equal(fallbackEntry.payload.source, "fallback");
  assert.equal(fallbackEntry.payload.shopkeeperVersion, FALLBACK_VERSION);

  const errorEntry = fallbackLogger.entries.errorEntries.find((entry) => entry.event === "shopkeeper_context_agent_failed");
  assert.ok(errorEntry);
  assert.equal(errorEntry.correlationId, "corr-obs-fallback");
});

test("builds its own internal prompt text from mascot/gift, never the image prompt", async () => {
  let capturedPromptText = null;
  const textProvider = {
    async generateContext({ promptText }) {
      capturedPromptText = promptText;
      return { text: VALID_AI_JSON, durationMs: 10 };
    }
  };

  const agent = createShopkeeperContextAgent({
    textProvider,
    promptRegistryLoader: createPromptRegistryLoaderMock(),
    logger: capturingLogger()
  });

  await agent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-prompt" });

  assert.ok(capturedPromptText.includes("Penguin"));
  assert.ok(capturedPromptText.includes("Lucky Charm"));
});

// Required Test #6 (P2-AI-03 working prompt "Tests" list / Gate Review gap):
// "Same Mascot DTO -> produces consistent Lucky Context Structure". This
// intentionally does NOT assert the AI's wording is identical (a real
// model may phrase things differently call-to-call) — it asserts the
// *shape* is always the same complete ShopkeeperContext, for both AI and
// Fallback sources, given the SAME mascot/gift DTO input.
test("Same Mascot DTO -> every call produces a consistently-shaped ShopkeeperContext (AI source)", async () => {
  const SHAPE_KEYS = ["luckyTheme", "blessing", "story", "oneLiner", "shopkeeperMessage", "version", "source"];

  const agent = createShopkeeperContextAgent({
    textProvider: createTextProviderMock({ text: VALID_AI_JSON }),
    promptRegistryLoader: createPromptRegistryLoaderMock(),
    logger: capturingLogger()
  });

  const first = await agent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-shape-1" });
  const second = await agent.generate({ mascot, gift, wallpaperStyle: "Cute", correlationId: "corr-shape-2" });

  for (const context of [first, second]) {
    assert.deepEqual(Object.keys(context).sort(), [...SHAPE_KEYS].sort());
    for (const key of SHAPE_KEYS) {
      assert.equal(typeof context[key], "string");
      assert.ok(context[key].length > 0, `${key} must be a non-empty string`);
    }
    assert.equal(context.source, "ai");
  }
});

test("Same Mascot DTO -> Fallback source is ALSO consistently shaped with the same mascot/gift input", async () => {
  const SHAPE_KEYS = ["luckyTheme", "blessing", "story", "oneLiner", "shopkeeperMessage", "version", "source"];

  const agent = createShopkeeperContextAgent({
    textProvider: createTextProviderMock({ error: new Error("boom") }),
    promptRegistryLoader: createPromptRegistryLoaderMock(),
    logger: capturingLogger()
  });

  const first = await agent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-shape-3" });
  const second = await agent.generate({ mascot, gift, wallpaperStyle: "Retro", correlationId: "corr-shape-4" });

  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), [...SHAPE_KEYS].sort());
  assert.equal(first.source, "fallback");
});

