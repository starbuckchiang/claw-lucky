"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateWallpaperPromptInput, PromptValidationError } = require("../prompt-validator");

function completeInput(overrides = {}) {
  return {
    mascot: { id: "mascot-1", species: "Penguin", title: "Lucky Penguin", appearance: "A small round penguin.", colors: null },
    gift: { id: "gift-1", name: "Lucky Charm", description: "A small guardian charm." },
    wallpaperStyle: "Retro",
    luckyTheme: "Golden Day",
    blessing: "Fortune follows you.",
    date: "2026.07.21",
    contextVersion: "wallpaper-prompt-context-v1",
    ...overrides
  };
}

test("complete input passes validation without throwing", () => {
  assert.doesNotThrow(() => validateWallpaperPromptInput(completeInput()));
});

test("missing mascot -> PromptValidationError", () => {
  assert.throws(
    () => validateWallpaperPromptInput(completeInput({ mascot: null })),
    (error) => {
      assert.ok(error instanceof PromptValidationError);
      assert.equal(error.code, "PROMPT_VALIDATION_FAILED");
      assert.ok(error.details.errors.some((message) => message.includes("mascot.species")));
      return true;
    }
  );
});

test("missing gift -> PromptValidationError", () => {
  assert.throws(
    () => validateWallpaperPromptInput(completeInput({ gift: null })),
    (error) => {
      assert.ok(error instanceof PromptValidationError);
      assert.ok(error.details.errors.some((message) => message.includes("gift.name")));
      return true;
    }
  );
});

test("missing blessing -> PromptValidationError", () => {
  assert.throws(
    () => validateWallpaperPromptInput(completeInput({ blessing: "" })),
    (error) => {
      assert.ok(error instanceof PromptValidationError);
      assert.ok(error.details.errors.includes("blessing is required"));
      return true;
    }
  );
});

test("missing luckyTheme -> PromptValidationError", () => {
  assert.throws(
    () => validateWallpaperPromptInput(completeInput({ luckyTheme: "   " })),
    (error) => {
      assert.ok(error instanceof PromptValidationError);
      assert.ok(error.details.errors.includes("luckyTheme is required"));
      return true;
    }
  );
});

test("missing date -> PromptValidationError", () => {
  assert.throws(
    () => validateWallpaperPromptInput(completeInput({ date: "" })),
    (error) => {
      assert.ok(error instanceof PromptValidationError);
      assert.ok(error.details.errors.includes("date is required"));
      return true;
    }
  );
});

test("missing wallpaperStyle -> PromptValidationError", () => {
  assert.throws(
    () => validateWallpaperPromptInput(completeInput({ wallpaperStyle: "" })),
    (error) => {
      assert.ok(error instanceof PromptValidationError);
      assert.ok(error.details.errors.includes("wallpaperStyle is required"));
      return true;
    }
  );
});

test("mascot missing appearance (species present) -> PromptValidationError", () => {
  assert.throws(
    () => validateWallpaperPromptInput(completeInput({ mascot: { species: "Penguin", appearance: "" } })),
    (error) => {
      assert.ok(error instanceof PromptValidationError);
      assert.ok(error.details.errors.includes("mascot.appearance is required"));
      return true;
    }
  );
});

test("does not generate an incomplete prompt — throws instead of returning a partial result", () => {
  assert.throws(() => validateWallpaperPromptInput({}));
});
