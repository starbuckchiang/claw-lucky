"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PromptRegistryError,
  createPromptRegistryLoader
} = require("../prompt-registry-loader");

function createRepositoryFake({ rows = [], throwError = null, onCall = null } = {}) {
  return {
    async fetchActivePromptsByType(promptType) {
      if (typeof onCall === "function") {
        onCall(promptType);
      }

      if (throwError) {
        throw throwError;
      }

      return rows;
    }
  };
}

test("active prompt load success", async () => {
  const loader = createPromptRegistryLoader({
    repository: createRepositoryFake({
      rows: [
        {
          prompt_type: "daily_lucky_context",
          version: "v2026.07.12",
          template: "  generate lucky context  ",
          metadata_json: { locale: "zh-TW" }
        }
      ]
    }),
    cache: { enabled: false }
  });

  const prompt = await loader.loadActivePrompt("daily_lucky_context");

  assert.equal(prompt.source, "database");
  assert.equal(prompt.promptType, "daily_lucky_context");
  assert.equal(prompt.version, "v2026.07.12");
  assert.equal(prompt.template, "generate lucky context");
  assert.deepEqual(prompt.metadata, { locale: "zh-TW" });
});

test("missing prompt type throws unsupported error", async () => {
  const loader = createPromptRegistryLoader({
    repository: createRepositoryFake({ rows: [] }),
    cache: { enabled: false }
  });

  await assert.rejects(
    () => loader.loadActivePrompt("not-supported-type"),
    (error) => error instanceof PromptRegistryError && error.code === "UNSUPPORTED_PROMPT_TYPE"
  );
});

test("no active prompt fallback", async () => {
  const loader = createPromptRegistryLoader({
    repository: createRepositoryFake({ rows: [] }),
    cache: { enabled: false }
  });

  const prompt = await loader.loadActivePrompt("wallpaper_generation");

  assert.equal(prompt.source, "fallback");
  assert.equal(prompt.promptType, "wallpaper_generation");
  assert.ok(prompt.version.startsWith("fallback-"));
  assert.ok(prompt.template.length > 0);
});

test("multiple active prompt defensive handling", async () => {
  const loader = createPromptRegistryLoader({
    repository: createRepositoryFake({
      rows: [
        { prompt_type: "daily_lucky_context", version: "v1", template: "x" },
        { prompt_type: "daily_lucky_context", version: "v2", template: "y" }
      ]
    }),
    cache: { enabled: false }
  });

  await assert.rejects(
    () => loader.loadActivePrompt("daily_lucky_context"),
    (error) => error instanceof PromptRegistryError && error.code === "MULTIPLE_ACTIVE_PROMPTS"
  );
});

test("invalid empty template", async () => {
  const loader = createPromptRegistryLoader({
    repository: createRepositoryFake({
      rows: [{ prompt_type: "daily_lucky_context", version: "v1", template: "   " }]
    }),
    cache: { enabled: false }
  });

  await assert.rejects(
    () => loader.loadActivePrompt("daily_lucky_context"),
    (error) => error instanceof PromptRegistryError && error.code === "INVALID_TEMPLATE"
  );
});

test("database query failure", async () => {
  const loader = createPromptRegistryLoader({
    repository: createRepositoryFake({
      throwError: new Error("db down")
    }),
    cache: { enabled: false }
  });

  const prompt = await loader.loadActivePrompt("daily_lucky_context");

  assert.equal(prompt.source, "fallback");
  assert.equal(prompt.promptType, "daily_lucky_context");
});

test("version returned correctly", async () => {
  const loader = createPromptRegistryLoader({
    repository: createRepositoryFake({
      rows: [
        {
          prompt_type: "wallpaper_generation",
          version: "release-2026-07-12.1",
          template: "wallpaper template",
          metadata_json: {}
        }
      ]
    }),
    cache: { enabled: false }
  });

  const prompt = await loader.loadActivePrompt("wallpaper_generation");

  assert.equal(prompt.version, "release-2026-07-12.1");
});
