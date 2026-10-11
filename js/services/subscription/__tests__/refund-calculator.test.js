"use strict";

/**
 * PROD-RELEASE-DAY3C refund policy calculator tests.
 * Covers the confirmed verification matrix (section 六):
 *   - within 7 days / exact boundary / just over 7 days
 *   - gift not shipped vs already shipped
 *   - 30/31/28/29-day months + yearly periods
 *   - used 15 days -> 15/30 refund (30-day period), 16/31 (31-day period)
 *   - original-currency-only amounts (never mixed/converted)
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateSubscriptionRefund,
  isWithinCoolingOffWindow,
  roundToCurrencyMinorUnit,
  CALCULATION_RULE_VERSION
} = require("../refund-calculator");

function taipei(isoLocal) {
  // isoLocal like "2026-10-01T10:00:00" is interpreted as Asia/Taipei (+08:00).
  return new Date(`${isoLocal}+08:00`);
}

test("isWithinCoolingOffWindow: exactly on day 7 (Taipei) is still within", () => {
  const activatedAt = taipei("2026-10-01T03:00:00");
  const requestedAt = taipei("2026-10-08T23:59:00"); // still day 7 in Taipei
  assert.equal(isWithinCoolingOffWindow({ activatedAt, requestedAt }), true);
});

test("isWithinCoolingOffWindow: just past day 7 (Taipei) is over the window", () => {
  const activatedAt = taipei("2026-10-01T03:00:00");
  const requestedAt = taipei("2026-10-09T00:00:01"); // day 8 begins
  assert.equal(isWithinCoolingOffWindow({ activatedAt, requestedAt }), false);
});

test("isWithinCoolingOffWindow: well within the window (day 1)", () => {
  const activatedAt = taipei("2026-10-01T03:00:00");
  const requestedAt = taipei("2026-10-02T03:00:00");
  assert.equal(isWithinCoolingOffWindow({ activatedAt, requestedAt }), true);
});

test("calculateSubscriptionRefund: within cooling-off refunds the FULL current-period amount, no proration", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-10-01T03:00:00"),
    periodStart: taipei("2026-10-01T03:00:00"),
    periodEnd: taipei("2026-11-01T03:00:00"),
    requestedAt: taipei("2026-10-03T03:00:00"),
    paidAmount: 5,
    currency: "USD",
    shippingFeeAmount: 44,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: true
  });
  assert.equal(result.withinCoolingOff, true);
  assert.equal(result.subscriptionRefundAmount, 5);
  assert.equal(result.unusedDays, result.totalDays);
});

test("calculateSubscriptionRefund: 30-day period, used 15 days (over window) -> refund 15/30", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-01-01T00:00:00"), // long-ago activation, well past 7 days
    periodStart: taipei("2026-09-01T00:00:00"),
    periodEnd: taipei("2026-10-01T00:00:00"), // September = 30 days
    requestedAt: taipei("2026-09-16T00:00:00"), // exactly 15 whole days elapsed
    paidAmount: 10,
    currency: "USD",
    shippingFeeAmount: 0,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: false
  });
  assert.equal(result.withinCoolingOff, false);
  assert.equal(result.totalDays, 30);
  assert.equal(result.usedDays, 15);
  assert.equal(result.unusedDays, 15);
  assert.equal(result.subscriptionRefundAmount, roundToCurrencyMinorUnit(10 * 15 / 30, "USD"));
  assert.equal(result.subscriptionRefundAmount, 5);
});

test("calculateSubscriptionRefund: 31-day period, used 15 days -> refund 16/31", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-01-01T00:00:00"),
    periodStart: taipei("2026-10-01T00:00:00"),
    periodEnd: taipei("2026-11-01T00:00:00"), // October = 31 days
    requestedAt: taipei("2026-10-16T00:00:00"),
    paidAmount: 10,
    currency: "USD",
    shippingFeeAmount: 0,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: false
  });
  assert.equal(result.totalDays, 31);
  assert.equal(result.usedDays, 15);
  assert.equal(result.unusedDays, 16);
  const expected = roundToCurrencyMinorUnit(10 * 16 / 31, "USD");
  assert.equal(result.subscriptionRefundAmount, expected);
});

test("calculateSubscriptionRefund: February (28 days, non-leap) period length is exact", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2025-01-01T00:00:00"),
    periodStart: taipei("2026-02-01T00:00:00"),
    periodEnd: taipei("2026-03-01T00:00:00"), // 2026 is not a leap year -> Feb = 28 days
    requestedAt: taipei("2026-02-15T00:00:00"),
    paidAmount: 10,
    currency: "USD",
    shippingFeeAmount: 0,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: false
  });
  assert.equal(result.totalDays, 28);
});

test("calculateSubscriptionRefund: February (29 days, leap year) period length is exact", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2027-01-01T00:00:00"),
    periodStart: taipei("2028-02-01T00:00:00"),
    periodEnd: taipei("2028-03-01T00:00:00"), // 2028 IS a leap year -> Feb = 29 days
    requestedAt: taipei("2028-02-15T00:00:00"),
    paidAmount: 10,
    currency: "USD",
    shippingFeeAmount: 0,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: false
  });
  assert.equal(result.totalDays, 29);
});

test("calculateSubscriptionRefund: yearly plan uses the real 365/366-day period, never 30-day assumption", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2025-01-01T00:00:00"),
    periodStart: taipei("2026-03-01T00:00:00"),
    periodEnd: taipei("2027-03-01T00:00:00"), // spans one leap day (2028 is leap, this one doesn't) -> 365
    requestedAt: taipei("2026-09-01T00:00:00"),
    paidAmount: 48,
    currency: "USD",
    shippingFeeAmount: 0,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: false
  });
  assert.equal(result.totalDays, 365);
  assert.ok(result.usedDays > 0 && result.usedDays < result.totalDays);
});

test("calculateSubscriptionRefund: an incomplete day of usage never counts as used", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-01-01T00:00:00"),
    periodStart: taipei("2026-09-01T00:00:00"),
    periodEnd: taipei("2026-10-01T00:00:00"),
    requestedAt: taipei("2026-09-15T23:59:59"), // 14 days + 23h59m59s elapsed, NOT a full 15th day
    paidAmount: 10,
    currency: "USD",
    shippingFeeAmount: 0,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: false
  });
  assert.equal(result.usedDays, 14);
});

test("calculateSubscriptionRefund: usedDays is clamped and never exceeds totalDays", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-01-01T00:00:00"),
    periodStart: taipei("2026-09-01T00:00:00"),
    periodEnd: taipei("2026-10-01T00:00:00"),
    requestedAt: taipei("2026-12-01T00:00:00"), // way past period end (e.g. delayed review)
    paidAmount: 10,
    currency: "USD",
    shippingFeeAmount: 0,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: false
  });
  assert.equal(result.usedDays, result.totalDays);
  assert.equal(result.unusedDays, 0);
  assert.equal(result.subscriptionRefundAmount, 0);
});

test("calculateSubscriptionRefund: shipping fee refunded in full when not yet shipped", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-01-01T00:00:00"),
    periodStart: taipei("2026-09-01T00:00:00"),
    periodEnd: taipei("2026-10-01T00:00:00"),
    requestedAt: taipei("2026-09-10T00:00:00"),
    paidAmount: 10,
    currency: "USD",
    shippingFeeAmount: 44,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: true
  });
  assert.equal(result.shippingRefundAmount, 44);
  assert.equal(result.shippingRefundCurrency, "TWD");
  assert.equal(result.giftReturnRequired, false);
});

test("calculateSubscriptionRefund: shipping fee is NEVER refunded once shipped, even within the cooling-off window", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-10-01T00:00:00"),
    periodStart: taipei("2026-10-01T00:00:00"),
    periodEnd: taipei("2026-11-01T00:00:00"),
    requestedAt: taipei("2026-10-05T00:00:00"), // within 7 days
    paidAmount: 5,
    currency: "USD",
    shippingFeeAmount: 44,
    shippingFeeCurrency: "TWD",
    giftShipped: true,
    giftEverGranted: true
  });
  assert.equal(result.shippingRefundAmount, 0);
  assert.equal(result.withinCoolingOff, true);
});

test("calculateSubscriptionRefund: gift return required only when shipped AND within the 7-day window", () => {
  const withinAndShipped = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-10-01T00:00:00"),
    periodStart: taipei("2026-10-01T00:00:00"),
    periodEnd: taipei("2026-11-01T00:00:00"),
    requestedAt: taipei("2026-10-05T00:00:00"),
    paidAmount: 5,
    currency: "USD",
    shippingFeeAmount: 44,
    shippingFeeCurrency: "TWD",
    giftShipped: true,
    giftEverGranted: true
  });
  assert.equal(withinAndShipped.giftReturnRequired, true);

  const overAndShipped = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-01-01T00:00:00"),
    periodStart: taipei("2026-09-01T00:00:00"),
    periodEnd: taipei("2026-10-01T00:00:00"),
    requestedAt: taipei("2026-09-20T00:00:00"), // well past 7 days from an old activation
    paidAmount: 10,
    currency: "USD",
    shippingFeeAmount: 44,
    shippingFeeCurrency: "TWD",
    giftShipped: true,
    giftEverGranted: true
  });
  assert.equal(overAndShipped.giftReturnRequired, false);
  assert.equal(overAndShipped.shippingRefundAmount, 0, "already-rendered shipping fee is never refunded");
});

test("calculateSubscriptionRefund: subscription and shipping amounts stay in their OWN original currencies, never mixed", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-10-01T00:00:00"),
    periodStart: taipei("2026-10-01T00:00:00"),
    periodEnd: taipei("2026-11-01T00:00:00"),
    requestedAt: taipei("2026-10-03T00:00:00"),
    paidAmount: 5,
    currency: "USD",
    shippingFeeAmount: 44,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: true
  });
  assert.equal(result.subscriptionRefundCurrency, "USD");
  assert.equal(result.shippingRefundCurrency, "TWD");
  assert.notEqual(result.subscriptionRefundCurrency, result.shippingRefundCurrency);
});

test("calculateSubscriptionRefund: rounds only at the very end, to the currency's minor unit", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-01-01T00:00:00"),
    periodStart: taipei("2026-10-01T00:00:00"),
    periodEnd: taipei("2026-11-01T00:00:00"), // 31 days
    requestedAt: taipei("2026-10-08T00:00:00"), // 7 whole days elapsed, past cooling-off (old activation)
    paidAmount: 5,
    currency: "USD",
    shippingFeeAmount: 0,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: false
  });
  // unusedDays = 31 - 7 = 24; 5 * 24 / 31 = 3.870967... -> rounds to 3.87
  assert.equal(result.unusedDays, 24);
  assert.equal(result.subscriptionRefundAmount, 3.87);
});

test("calculateSubscriptionRefund: rejects an invalid period (end <= start)", () => {
  assert.throws(() => calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-10-01T00:00:00"),
    periodStart: taipei("2026-10-10T00:00:00"),
    periodEnd: taipei("2026-10-01T00:00:00"),
    requestedAt: taipei("2026-10-05T00:00:00"),
    paidAmount: 5,
    currency: "USD",
    shippingFeeAmount: 0,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: false
  }), /REFUND_CALC_INVALID_PERIOD/);
});

test("calculateSubscriptionRefund: snapshot carries a fixed, recorded rule version", () => {
  const result = calculateSubscriptionRefund({
    subscriptionActivatedAt: taipei("2026-01-01T00:00:00"),
    periodStart: taipei("2026-09-01T00:00:00"),
    periodEnd: taipei("2026-10-01T00:00:00"),
    requestedAt: taipei("2026-09-10T00:00:00"),
    paidAmount: 10,
    currency: "USD",
    shippingFeeAmount: 0,
    shippingFeeCurrency: "TWD",
    giftShipped: false,
    giftEverGranted: false
  });
  assert.equal(result.calculationRuleVersion, CALCULATION_RULE_VERSION);
  assert.equal(result.snapshot.calculation_rule_version, CALCULATION_RULE_VERSION);
  assert.equal(result.snapshot.total_days, result.totalDays);
  assert.equal(result.snapshot.used_days, result.usedDays);
});
