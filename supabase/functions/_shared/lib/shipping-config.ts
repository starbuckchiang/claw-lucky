// ESM port of `js/services/subscription/shipping-config.js`. Logic unchanged.
export const SHIPPING_CONFIG = Object.freeze({
  shipToCountry: "TW",
  shipToCountryLabel: "台灣",
  carrier: "中華郵政普通掛號小包",
  packageWeightGrams: Object.freeze({ min: 101, max: 200 }),
  feeAmount: 44,
  feeCurrency: "TWD",
  shipWithinBusinessDays: 3,
});
