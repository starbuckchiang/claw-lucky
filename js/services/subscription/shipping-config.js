"use strict";

/**
 * PROD-RELEASE-DAY3C confirmed logistics configuration (business-confirmed,
 * do not alter without a new explicit instruction). Mirrors the
 * `js/services/subscription/paypal-plans.js`-style "known-good static
 * config" pattern — not an admin-editable table, since these are fixed,
 * confirmed business facts, not operational data.
 */

const SHIPPING_CONFIG = Object.freeze({
  shipToCountry: "TW",
  shipToCountryLabel: "台灣",
  carrier: "中華郵政普通掛號小包",
  packageWeightGrams: Object.freeze({ min: 101, max: 200 }),
  // Always NT$44 regardless of the subscription's own charge currency (USD)
  // — never converted/derived from an exchange rate.
  feeAmount: 44,
  feeCurrency: "TWD",
  shipWithinBusinessDays: 3
});

module.exports = { SHIPPING_CONFIG };
