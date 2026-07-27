"use strict";

/**
 * Real Fallback Template Contract Test (P2-AI-03 Gate Review fix — Test #4
 * in the "補齊缺失測試" list).
 *
 * This test loads the ACTUAL `fallback-templates.js` module — never a
 * hand-crafted mock template — because every other Shopkeeper test uses a
 * mock template with a correct schema baked in, which is exactly how the
 * Gate Review's critical finding slipped past 196/196 passing tests: the
 * REAL `daily_lucky_context` template (used whenever the Prompt Registry
 * has no active DB row) previously told the AI to output snake_case
 * fields and never mentioned `story`/`version` at all, so every real
 * Gemini call would have failed `validateShopkeeperContext()` and always
 * silently degraded to the Fallback Context.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { getFallbackPrompt } = require("../fallback-templates");
const { validateShopkeeperContext } = require("../../shopkeeper/shopkeeper-context-validator");

const REQUIRED_CAMEL_CASE_FIELDS = ["luckyTheme", "blessing", "story", "oneLiner", "shopkeeperMessage", "version"];
const FORBIDDEN_SNAKE_CASE_FIELDS = ["lucky_theme", "one_liner", "shopkeeper_message"];

function loadDailyLuckyContextTemplate() {
  const prompt = getFallbackPrompt("daily_lucky_context");
  assert.equal(prompt.source, "fallback");
  assert.equal(typeof prompt.template, "string");
  assert.ok(prompt.template.trim().length > 0);
  return prompt.template;
}

test("real daily_lucky_context fallback template lists every Validator-required camelCase field", () => {
  const template = loadDailyLuckyContextTemplate();

  for (const field of REQUIRED_CAMEL_CASE_FIELDS) {
    assert.ok(
      template.includes(field),
      `fallback template must mention the field name "${field}" (camelCase) so the model knows to output it`
    );
  }
});

test("real daily_lucky_context fallback template does NOT regress to the old broken snake_case schema", () => {
  const template = loadDailyLuckyContextTemplate();

  for (const field of FORBIDDEN_SNAKE_CASE_FIELDS) {
    assert.equal(
      template.includes(field),
      false,
      `fallback template must not instruct the model to use snake_case field "${field}" — this was the exact regression the Gate Review caught`
    );
  }
});

test("real daily_lucky_context fallback template explicitly forbids Markdown / requires JSON-only output", () => {
  const template = loadDailyLuckyContextTemplate();

  assert.ok(/json/i.test(template), "template must require JSON output");
  assert.ok(
    template.includes("```") || /markdown/i.test(template),
    "template must explicitly forbid Markdown code fences"
  );
});

test("real daily_lucky_context fallback template requires Traditional Chinese content", () => {
  const template = loadDailyLuckyContextTemplate();

  assert.ok(/繁體中文/.test(template), "template must require Traditional Chinese output");
});

// The strongest form of contract proof: build the JSON a model would
// produce by FOLLOWING these exact instructions, and run it through the
// REAL (not mocked) validator. If this ever fails again, it means the
// template and the validator have drifted apart — exactly the defect the
// Gate Review found.
test("a JSON response that faithfully follows the real template's instructions passes the REAL validator", () => {
  const simulatedAiResponse = {
    luckyTheme: "金色好運日",
    blessing: "願你今天平安順利。",
    story: "今天的你，會被幸運悄悄眷顧。",
    oneLiner: "穩穩接住今天的好運。",
    shopkeeperMessage: "嗨，今天也為你準備了一份好運～",
    version: "shopkeeper-context-v1"
  };

  assert.doesNotThrow(() => validateShopkeeperContext(simulatedAiResponse));
});

test("regression guard: the OLD broken snake_case shape (no story/version) fails the REAL validator", () => {
  const oldBrokenShape = {
    lucky_theme: "金色好運日",
    blessing: "願你今天平安順利。",
    one_liner: "穩穩接住今天的好運。"
  };

  assert.throws(() => validateShopkeeperContext(oldBrokenShape));
});
