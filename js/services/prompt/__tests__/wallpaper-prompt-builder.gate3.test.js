"use strict";

/**
 * P2-AI-02 Gate 3 Verification — Wallpaper Prompt Builder.
 *
 * Formal acceptance tests (Test 1~5) per the Gate 3 verification checklist.
 * Uses the exact fixed Traditional Chinese content specified in the gate
 * document so this file can be read directly as the verification record.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildWallpaperPrompt } = require("../wallpaper-prompt-builder");
const { validateWallpaperPromptInput, PromptValidationError } = require("../prompt-validator");
const { resolveTaipeiDate } = require("../prompt-context-resolver");

function fixedInput(overrides = {}) {
  return {
    mascot: {
      id: "mascot-penguin-01",
      species: "轉運小企鵝",
      title: "",
      appearance: "圓滾滾的企鵝，穿著幸運紅圍巾。",
      colors: null
    },
    gift: {
      id: "gift-charm-01",
      name: "幸運乒乓守護吊飾",
      description: ""
    },
    wallpaperStyle: "Retro",
    luckyTheme: "穩穩接住今天的好運",
    blessing: "今天每一次努力都會更靠近成功。",
    date: "2026.07.21",
    contextVersion: "wallpaper-prompt-context-v1",
    ...overrides
  };
}

// --- Test 1: Deterministic Prompt ---------------------------------------

test("Gate 3 / Test 1: Deterministic Prompt — 100 runs produce byte-for-byte identical output", () => {
  const input = fixedInput();
  const outputs = [];

  for (let i = 0; i < 100; i += 1) {
    // Fresh, independent object each run — proves no shared mutable state
    // leaks between calls.
    const runInput = JSON.parse(JSON.stringify(input));
    outputs.push(buildWallpaperPrompt(runInput).promptText);
  }

  const distinct = new Set(outputs);
  assert.equal(distinct.size, 1, "all 100 runs must produce the exact same prompt text");
  assert.equal(outputs.length, 100);
});

// --- Test 2: Single Change ------------------------------------------------

test("Gate 3 / Test 2: Single Change — only the Gift section changes when Gift changes", () => {
  const resultA = buildWallpaperPrompt(fixedInput({
    gift: { id: "gift-a", name: "幸運乒乓守護吊飾", description: "" }
  }));
  const resultB = buildWallpaperPrompt(fixedInput({
    gift: { id: "gift-b", name: "招財貓掌吊飾", description: "" }
  }));

  const linesA = resultA.promptText.split("\n");
  const linesB = resultB.promptText.split("\n");

  assert.equal(linesA.length, linesB.length, "changing only the gift must not add/remove lines");

  const differingLines = [];
  for (let i = 0; i < linesA.length; i += 1) {
    if (linesA[i] !== linesB[i]) {
      differingLines.push({ index: i, a: linesA[i], b: linesB[i] });
    }
  }

  assert.equal(differingLines.length, 1, "exactly one line (the Gift line) must differ");
  assert.ok(differingLines[0].a.includes("幸運乒乓守護吊飾"));
  assert.ok(differingLines[0].b.includes("招財貓掌吊飾"));

  // Mascot / Theme / Blessing / Date sections are untouched.
  assert.ok(resultA.promptText.includes("轉運小企鵝"));
  assert.ok(resultB.promptText.includes("轉運小企鵝"));
  assert.ok(resultA.promptText.includes("穩穩接住今天的好運"));
  assert.ok(resultB.promptText.includes("穩穩接住今天的好運"));
  assert.ok(resultA.promptText.includes("今天每一次努力都會更靠近成功。"));
  assert.ok(resultB.promptText.includes("今天每一次努力都會更靠近成功。"));
  assert.ok(resultA.promptText.includes("2026.07.21"));
  assert.ok(resultB.promptText.includes("2026.07.21"));
});

// --- Test 3: Character Identity ------------------------------------------

test("Gate 3 / Test 3: Character Identity — prompt includes Species/Appearance/Character Consistency Rules, never a raw mascotId", () => {
  const result = buildWallpaperPrompt(fixedInput());

  assert.ok(result.promptText.includes("- Species: 轉運小企鵝"));
  assert.ok(result.promptText.includes("- Appearance: 圓滾滾的企鵝，穿著幸運紅圍巾。"));
  assert.ok(/Character Consistency Rules/.test(result.promptText));

  // Never leak the opaque mascot ID into the actual image prompt.
  assert.equal(result.promptText.includes("mascot-penguin-01"), false);
});

// --- Test 4: Date ----------------------------------------------------------

test("Gate 3 / Test 4: Date — resolved as Asia/Taipei, formatted 2026.07.21, and appears verbatim in the prompt", () => {
  // 2026-07-20T16:05:00Z is 2026-07-21 00:05 in Asia/Taipei (UTC+8) — a
  // deliberate UTC-day-boundary case to prove Asia/Taipei (not UTC) is used.
  const taipeiDate = resolveTaipeiDate(new Date("2026-07-20T16:05:00.000Z"));
  assert.equal(taipeiDate, "2026.07.21");

  const result = buildWallpaperPrompt(fixedInput({ date: taipeiDate }));
  assert.ok(result.promptText.includes("Date Watermark (small, tasteful, bottom corner, exactly this text): 2026.07.21"));
});

// --- Test 5: Validation -----------------------------------------------------

test("Gate 3 / Test 5: Validation — missing Gift throws PromptValidationError, never produces a partial prompt", () => {
  const input = fixedInput({ gift: null });

  assert.throws(
    () => validateWallpaperPromptInput(input),
    (error) => {
      assert.ok(error instanceof PromptValidationError);
      assert.equal(error.code, "PROMPT_VALIDATION_FAILED");
      assert.ok(error.details.errors.includes("gift.name is required"));
      return true;
    }
  );

  // The Builder itself is never even reached in the real pipeline once
  // validation throws (see generation-service.js: validate -> build, no
  // branch skips validation) — this is enforced structurally, not just by
  // convention, so there is no code path that could emit a half-formed prompt.
});
