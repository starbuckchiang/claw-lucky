"use strict";

/**
 * Shopkeeper Context Validator.
 *
 * Validates the AI-generated Shopkeeper Context (parsed from the model's
 * Structured Output JSON) before it is trusted. Required per this task's
 * Product Decisions: luckyTheme, blessing, story, version. `oneLiner` and
 * `shopkeeperMessage` are optional. Missing any required field is treated
 * as a failure by the Shopkeeper Context Agent, which falls back to the
 * deterministic Fallback Context — this validator never returns a
 * half-formed context; it only ever signals valid/invalid.
 */

class ShopkeeperContextValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ShopkeeperContextValidationError";
    this.code = "SHOPKEEPER_CONTEXT_VALIDATION_FAILED";
    this.details = details || null;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {object} context - candidate ShopkeeperContext (parsed AI output)
 * @throws {ShopkeeperContextValidationError} if any required field is missing.
 */
function validateShopkeeperContext(context) {
  const errors = [];

  if (!isNonEmptyString(context?.luckyTheme)) {
    errors.push("luckyTheme is required");
  }
  if (!isNonEmptyString(context?.blessing)) {
    errors.push("blessing is required");
  }
  if (!isNonEmptyString(context?.story)) {
    errors.push("story is required");
  }
  if (!isNonEmptyString(context?.version)) {
    errors.push("version is required");
  }

  if (errors.length > 0) {
    throw new ShopkeeperContextValidationError("Shopkeeper context is incomplete.", { errors });
  }
}

module.exports = {
  ShopkeeperContextValidationError,
  validateShopkeeperContext
};
