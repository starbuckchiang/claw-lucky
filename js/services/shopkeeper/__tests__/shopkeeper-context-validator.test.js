"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateShopkeeperContext,
  ShopkeeperContextValidationError
} = require("../shopkeeper-context-validator");

function completeContext(overrides = {}) {
  return {
    luckyTheme: "Golden Day",
    blessing: "Fortune follows you.",
    story: "A tiny lucky story.",
    oneLiner: "Shine on.",
    shopkeeperMessage: "Hi there!",
    version: "v1",
    ...overrides
  };
}

test("accepts a complete context without throwing", () => {
  assert.doesNotThrow(() => validateShopkeeperContext(completeContext()));
});

test("accepts a context missing the optional oneLiner/shopkeeperMessage fields", () => {
  const context = completeContext();
  delete context.oneLiner;
  delete context.shopkeeperMessage;

  assert.doesNotThrow(() => validateShopkeeperContext(context));
});

test("missing luckyTheme -> throws ShopkeeperContextValidationError", () => {
  const context = completeContext({ luckyTheme: "" });

  assert.throws(() => validateShopkeeperContext(context), ShopkeeperContextValidationError);
});

test("missing blessing -> throws ShopkeeperContextValidationError", () => {
  const context = completeContext({ blessing: undefined });

  assert.throws(() => validateShopkeeperContext(context), ShopkeeperContextValidationError);
});

test("missing story -> throws ShopkeeperContextValidationError", () => {
  const context = completeContext({ story: null });

  assert.throws(() => validateShopkeeperContext(context), ShopkeeperContextValidationError);
});

test("missing version -> throws ShopkeeperContextValidationError", () => {
  const context = completeContext({ version: "   " });

  assert.throws(() => validateShopkeeperContext(context), ShopkeeperContextValidationError);
});

test("error.details.errors lists every missing required field", () => {
  try {
    validateShopkeeperContext({});
    assert.fail("expected validateShopkeeperContext to throw");
  } catch (error) {
    assert.ok(error instanceof ShopkeeperContextValidationError);
    assert.equal(error.code, "SHOPKEEPER_CONTEXT_VALIDATION_FAILED");
    assert.ok(error.details.errors.includes("luckyTheme is required"));
    assert.ok(error.details.errors.includes("blessing is required"));
    assert.ok(error.details.errors.includes("story is required"));
    assert.ok(error.details.errors.includes("version is required"));
  }
});
