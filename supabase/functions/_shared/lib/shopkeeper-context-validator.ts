// ESM port of `js/services/shopkeeper/shopkeeper-context-validator.js`.
// Logic unchanged.

export class ShopkeeperContextValidationError extends Error {
  code: string;
  details: unknown;

  constructor(message: string, details: unknown) {
    super(message);
    this.name = "ShopkeeperContextValidationError";
    this.code = "SHOPKEEPER_CONTEXT_VALIDATION_FAILED";
    this.details = details || null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// deno-lint-ignore no-explicit-any
export function validateShopkeeperContext(context: any): void {
  const errors: string[] = [];

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
