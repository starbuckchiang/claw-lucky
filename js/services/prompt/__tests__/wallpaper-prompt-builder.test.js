"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildWallpaperPrompt, BUILDER_VERSION } = require("../wallpaper-prompt-builder");

function baseInput(overrides = {}) {
  return {
    mascot: {
      id: "mascot-1",
      species: "Penguin",
      title: "Lucky Penguin",
      appearance: "A small round penguin with a red scarf and orange beak.",
      colors: null
    },
    gift: {
      id: "gift-1",
      name: "Lucky Table-Tennis Charm",
      description: "A small guardian charm shaped like a table-tennis paddle."
    },
    wallpaperStyle: "Retro",
    luckyTheme: "Golden Day",
    blessing: "Fortune follows you wherever you go.",
    date: "2026.07.21",
    contextVersion: "wallpaper-prompt-context-v1",
    ...overrides
  };
}

test("same input always produces the exact same prompt (deterministic, pure function)", () => {
  const input = baseInput();
  const first = buildWallpaperPrompt(input);
  const second = buildWallpaperPrompt(JSON.parse(JSON.stringify(input)));

  assert.equal(first.promptText, second.promptText);
  assert.equal(first.builderVersion, BUILDER_VERSION);
});

test("prompt always includes species, appearance, gift, and the mood/theme reference — new policy: image contains no rendered text", () => {
  const result = buildWallpaperPrompt(baseInput());

  assert.ok(result.promptText.includes("Penguin"));
  assert.ok(result.promptText.includes("A small round penguin with a red scarf and orange beak."));
  assert.ok(result.promptText.includes("Lucky Table-Tennis Charm"));
  assert.ok(result.promptText.includes("Golden Day"));

  // P2-AI-04 Lite-4: blessing text and the date are NEVER sent to Gemini as
  // literal on-image text anymore — Gemini only produces a text-free
  // background; the blessing/date/oneLiner are composited by the frontend
  // Canvas layer instead (see wallpaper-canvas-composer.js).
  assert.equal(result.promptText.includes("Fortune follows you wherever you go."), false);
  assert.equal(result.promptText.includes("2026.07.21"), false);
  assert.ok(/STRICTLY NO TEXT/.test(result.promptText));
  assert.ok(/Text-Safe Zone/.test(result.promptText));
});

test("prompt includes an explicit character consistency rule (mascot must not be replaced)", () => {
  const result = buildWallpaperPrompt(baseInput());

  assert.ok(/Character Consistency Rules/i.test(result.promptText));
  assert.ok(/never replaced with a different animal|Do not substitute the mascot species/i.test(result.promptText));
});

test("does not touch the database, repositories, fetch, or environment (pure function contract)", () => {
  // A pure function invoked synchronously must not return a Promise and
  // must not throw when given a plain, fully-resolved object with no
  // injected client/repository/fetch dependency of any kind.
  const result = buildWallpaperPrompt(baseInput());
  assert.equal(result instanceof Promise, false);
  assert.equal(typeof result.promptText, "string");
});

test("colors line only appears when provided (no fabricated data)", () => {
  const withoutColors = buildWallpaperPrompt(baseInput({ mascot: { ...baseInput().mascot, colors: null } }));
  assert.equal(withoutColors.promptText.includes("- Colors:"), false);

  const withColors = buildWallpaperPrompt(baseInput({ mascot: { ...baseInput().mascot, colors: "orange and white" } }));
  assert.ok(withColors.promptText.includes("- Colors: orange and white"));
});
