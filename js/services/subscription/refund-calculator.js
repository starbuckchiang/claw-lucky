"use strict";

/**
 * PROD-RELEASE-DAY3C refund policy: pure date/amount math only (no I/O).
 * Rules (confirmed by the business, do not alter without new instruction):
 *   - Subscription-level 7-day cooling-off window is measured from the
 *     subscription's ORIGINAL activation instant (paypal_subscriptions.start_time),
 *     NOT the current billing period's start — it only ever opens once per
 *     subscription, not on every renewal. Boundary is defined in Asia/Taipei
 *     calendar days: activation date + 7 calendar days, end of day inclusive.
 *   - Within the window: refund the CURRENT period's full paid amount.
 *   - Beyond the window: prorate by UNUSED days of the CURRENT billing period
 *     (real period start/end — never an assumed 30-day month).
 *   - usedDays = whole elapsed 24-hour days from period start to the request
 *     instant, floored (a partial/incomplete day is never counted as used),
 *     clamped to [0, totalDays]. unusedDays = totalDays - usedDays.
 *   - refundAmount = paidAmount * unusedDays / totalDays, rounded ONLY at
 *     the very end to the currency's smallest unit.
 *   - Shipping fee is never prorated: full refund only if not yet shipped;
 *     zero refund once shipped (the shipping service was already rendered),
 *     regardless of the 7-day window.
 */

const ASIA_TAIPEI_OFFSET_MINUTES = 8 * 60; // fixed UTC+8, no DST in Taiwan.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error("REFUND_CALC_INVALID_DATE");
  }
  return d;
}

/**
 * Returns {year, month, day} for the given instant, as seen in Asia/Taipei.
 */
function taipeiCalendarDate(date) {
  const shifted = new Date(date.getTime() + ASIA_TAIPEI_OFFSET_MINUTES * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate()
  };
}

/**
 * End-of-day (23:59:59.999) instant in Asia/Taipei for a given calendar date,
 * expressed back as a real UTC Date.
 */
function taipeiEndOfDayUtc({ year, month, day }) {
  // UTC midnight of (year, month, day) MINUS the +08:00 offset = Taipei midnight in UTC.
  // End of day = next midnight minus 1ms.
  const taipeiMidnightUtcMs = Date.UTC(year, month, day) - ASIA_TAIPEI_OFFSET_MINUTES * 60 * 1000;
  return new Date(taipeiMidnightUtcMs + MS_PER_DAY - 1);
}

function addCalendarDays({ year, month, day }, deltaDays) {
  const d = new Date(Date.UTC(year, month, day));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/**
 * Within the cooling-off window iff requestedAt <= (activatedAt's Taipei date + 7 days, 23:59:59.999 Taipei).
 */
function isWithinCoolingOffWindow({ activatedAt, requestedAt }) {
  const activated = toDate(activatedAt);
  const requested = toDate(requestedAt);
  const activatedTaipeiDate = taipeiCalendarDate(activated);
  const boundaryDate = addCalendarDays(activatedTaipeiDate, 7);
  const boundaryInstant = taipeiEndOfDayUtc(boundaryDate);
  return requested.getTime() <= boundaryInstant.getTime();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Round to the currency's smallest unit. USD/TWD both use 2 vs 0 decimal
 * conventions respectively in this app (TWD amounts here are always whole
 * numbers, e.g. NT$44) — only round at the very end of a calculation.
 */
function roundToCurrencyMinorUnit(amount, currency) {
  const zeroDecimalCurrencies = new Set(["TWD", "JPY", "KRW"]);
  const decimals = zeroDecimalCurrencies.has(String(currency || "").toUpperCase()) ? 0 : 2;
  const factor = 10 ** decimals;
  return Math.round((Number(amount) + Number.EPSILON) * factor) / factor;
}

/**
 * Whole elapsed 24-hour days between two instants, floored, never negative.
 */
function wholeElapsedDays(fromDate, toDateValue) {
  const ms = toDateValue.getTime() - fromDate.getTime();
  return Math.max(0, Math.floor(ms / MS_PER_DAY));
}

/**
 * Days spanned by the period, rounded to the nearest whole day (PayPal's
 * billing-cycle advancement lands on exact calendar boundaries; rounding
 * absorbs sub-second timestamp jitter without ever assuming 30 days).
 */
function totalPeriodDays(periodStart, periodEnd) {
  const ms = periodEnd.getTime() - periodStart.getTime();
  const days = Math.round(ms / MS_PER_DAY);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("REFUND_CALC_INVALID_PERIOD");
  }
  return days;
}

const CALCULATION_RULE_VERSION = "2026-10-11-day3c-v1";

/**
 * @param {object} input
 * @param {string|Date} input.subscriptionActivatedAt - paypal_subscriptions.start_time
 * @param {string|Date} input.periodStart - current period's start (last_payment_time / start_time)
 * @param {string|Date} input.periodEnd - current period's end (next_billing_time)
 * @param {string|Date} input.requestedAt - when the refund request first reached the backend
 * @param {number|string} input.paidAmount - the amount actually charged for the current period
 * @param {string} input.currency - the subscription's charge currency (e.g. "USD")
 * @param {number|string} input.shippingFeeAmount - amount actually paid for shipping (0 if none)
 * @param {string} input.shippingFeeCurrency - e.g. "TWD"
 * @param {boolean} input.giftShipped - whether the physical gift has already been shipped
 * @param {boolean} input.giftEverGranted - whether a gift entitlement exists at all for this user
 */
function calculateSubscriptionRefund(input) {
  const activatedAt = toDate(input.subscriptionActivatedAt);
  const periodStart = toDate(input.periodStart);
  const periodEnd = toDate(input.periodEnd);
  const requestedAt = toDate(input.requestedAt);

  if (periodEnd.getTime() <= periodStart.getTime()) {
    throw new Error("REFUND_CALC_INVALID_PERIOD");
  }

  const paidAmount = Number(input.paidAmount);
  if (!Number.isFinite(paidAmount) || paidAmount < 0) {
    throw new Error("REFUND_CALC_INVALID_AMOUNT");
  }
  const currency = String(input.currency || "").toUpperCase();

  const withinCoolingOff = isWithinCoolingOffWindow({
    activatedAt,
    requestedAt
  });

  const totalDays = totalPeriodDays(periodStart, periodEnd);

  let usedDays;
  let unusedDays;
  let subscriptionRefundAmount;

  if (withinCoolingOff) {
    usedDays = 0;
    unusedDays = totalDays;
    subscriptionRefundAmount = roundToCurrencyMinorUnit(paidAmount, currency);
  } else {
    usedDays = clamp(wholeElapsedDays(periodStart, requestedAt), 0, totalDays);
    unusedDays = totalDays - usedDays;
    subscriptionRefundAmount = roundToCurrencyMinorUnit(
      (paidAmount * unusedDays) / totalDays,
      currency
    );
  }

  const giftShipped = Boolean(input.giftShipped);
  const giftEverGranted = Boolean(input.giftEverGranted);
  const shippingFeeAmount = Number(input.shippingFeeAmount || 0);
  const shippingFeeCurrency = String(input.shippingFeeCurrency || "TWD").toUpperCase();

  // Shipping fee is never prorated: full refund only if not yet shipped.
  const shippingRefundAmount = giftEverGranted && !giftShipped
    ? roundToCurrencyMinorUnit(shippingFeeAmount, shippingFeeCurrency)
    : 0;

  // Gift must be physically returned only when it already shipped AND the
  // request landed inside the 7-day window (legal/contractual withdrawal).
  const giftReturnRequired = giftEverGranted && giftShipped && withinCoolingOff;

  return {
    withinCoolingOff,
    totalDays,
    usedDays,
    unusedDays,
    subscriptionRefundAmount,
    subscriptionRefundCurrency: currency,
    shippingRefundAmount,
    shippingRefundCurrency: shippingFeeCurrency,
    giftReturnRequired,
    calculationRuleVersion: CALCULATION_RULE_VERSION,
    snapshot: {
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      requested_at: requestedAt.toISOString(),
      total_days: totalDays,
      used_days: usedDays,
      unused_days: unusedDays,
      within_cooling_off: withinCoolingOff,
      subscription_refund_amount: subscriptionRefundAmount,
      subscription_refund_currency: currency,
      shipping_refund_amount: shippingRefundAmount,
      shipping_refund_currency: shippingFeeCurrency,
      gift_return_required: giftReturnRequired,
      calculation_rule_version: CALCULATION_RULE_VERSION
    }
  };
}

module.exports = {
  calculateSubscriptionRefund,
  isWithinCoolingOffWindow,
  roundToCurrencyMinorUnit,
  CALCULATION_RULE_VERSION
};
