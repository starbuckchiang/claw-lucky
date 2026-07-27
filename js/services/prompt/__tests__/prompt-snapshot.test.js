"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPromptSnapshot } = require("../prompt-snapshot");
const { buildWallpaperPrompt } = require("../wallpaper-prompt-builder");

test("captures the exact prompt text, context version, and builder version", () => {
  const promptResult = buildWallpaperPrompt({
    mascot: { species: "Penguin", title: "Lucky Penguin", appearance: "A small round penguin.", colors: null },
    gift: { name: "Lucky Charm", description: "A small guardian charm." },
    wallpaperStyle: "Retro",
    luckyTheme: "Golden Day",
    blessing: "Fortune follows you.",
    date: "2026.07.21"
  });

  const snapshot = buildPromptSnapshot({
    promptResult,
    contextVersion: "wallpaper-prompt-context-v1"
  });

  assert.equal(snapshot.promptSnapshot, promptResult.promptText);
  assert.equal(snapshot.contextVersion, "wallpaper-prompt-context-v1");
  assert.equal(snapshot.builderVersion, promptResult.builderVersion);
});

test("never throws on missing fields — defaults to empty strings", () => {
  const snapshot = buildPromptSnapshot({ promptResult: null, contextVersion: undefined });

  assert.equal(snapshot.promptSnapshot, "");
  assert.equal(snapshot.contextVersion, "");
  assert.equal(snapshot.builderVersion, "");
});
