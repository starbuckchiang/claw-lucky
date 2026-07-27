"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPromptContextResolver,
  resolveTaipeiDate,
  CONTEXT_VERSION
} = require("../prompt-context-resolver");

test("resolves an already-provided mascot/gift DTO into a complete WallpaperPromptInput (no repository deps)", async () => {
  const resolver = createPromptContextResolver({
    now: () => new Date("2026-07-21T03:00:00.000Z")
  });

  const context = await resolver.resolve({
    mascot: {
      id: "mascot-1",
      species: "Penguin",
      title: "Lucky Penguin",
      appearance: "A small round penguin.",
      colors: null
    },
    gift: {
      id: "gift-1",
      name: "Lucky Charm",
      description: "A small guardian charm."
    },
    wallpaperStyle: "Retro",
    luckyTheme: "Golden Day",
    blessing: "Fortune follows you."
  });

  assert.equal(context.mascot.species, "Penguin");
  assert.equal(context.gift.name, "Lucky Charm");
  assert.equal(context.wallpaperStyle, "Retro");
  assert.equal(context.luckyTheme, "Golden Day");
  assert.equal(context.blessing, "Fortune follows you.");
  assert.equal(context.contextVersion, CONTEXT_VERSION);
});

test("mascot omitted -> context.mascot is null (Validator catches it, Resolver never guesses)", async () => {
  const resolver = createPromptContextResolver();

  const context = await resolver.resolve({ mascot: null, gift: { id: "gift-1", name: "Lucky Charm", description: "..." } });

  assert.equal(context.mascot, null);
});

test("gift omitted -> context.gift is null", async () => {
  const resolver = createPromptContextResolver();

  const context = await resolver.resolve({
    mascot: { id: "mascot-1", species: "Penguin", appearance: "...", title: "", colors: null },
    gift: null
  });

  assert.equal(context.gift, null);
});

test("date is always Asia/Taipei, formatted YYYY.MM.DD, never UTC", () => {
  // 2026-07-20T16:30:00Z is 2026-07-21 00:30 in Asia/Taipei (UTC+8) — this
  // is the exact boundary case where using UTC instead of Asia/Taipei would
  // produce the WRONG (previous) day/month.
  const utcBoundary = new Date("2026-07-20T16:30:00.000Z");

  assert.equal(resolveTaipeiDate(utcBoundary), "2026.07.21");

  // Sanity check against naive UTC formatting to prove the difference is real.
  const naiveUtc = `${utcBoundary.getUTCFullYear()}.${String(utcBoundary.getUTCMonth() + 1).padStart(2, "0")}.${String(utcBoundary.getUTCDate()).padStart(2, "0")}`;
  assert.equal(naiveUtc, "2026.07.20");
  assert.notEqual(resolveTaipeiDate(utcBoundary), naiveUtc);
});

test("date is never hardcoded — changes deterministically with the injected `now`", async () => {
  const resolver = createPromptContextResolver({
    now: () => new Date("2026-01-05T01:00:00.000Z")
  });

  const context = await resolver.resolve({
    mascot: { id: "m", species: "s", appearance: "a", title: "", colors: null },
    gift: { id: "g", name: "n", description: "d" }
  });
  assert.equal(context.date, "2026.01.05");
});

