// ESM port of `js/services/subscription/refund-calculator.js`. Logic unchanged.
//
// PROD-RELEASE-DAY3C refund policy: pure date/amount math only (no I/O).
// See the Node twin's header comment for the full confirmed business rules.

const ASIA_TAIPEI_OFFSET_MINUTES = 8 * 60; // fixed UTC+8, no DST in Taiwan.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const CALCULATION_RULE_VERSION = "2026-10-11-day3c-v1";

function toDate(value: string | number | Date): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error("REFUND_CALC_INVALID_DATE");
  }
  return d;
}

function taipeiCalendarDate(date: Date) {
  const shifted = new Date(date.getTime() + ASIA_TAIPEI_OFFSET_MINUTES * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function taipeiEndOfDayUtc({ year, month, day }: { year: number; month: number; day: number }) {
  const taipeiMidnightUtcMs = Date.UTC(year, month, day) - ASIA_TAIPEI_OFFSET_MINUTES * 60 * 1000;
  return new Date(taipeiMidnightUtcMs + MS_PER_DAY - 1);
}

function addCalendarDays(
  { year, month, day }: { year: number; month: number; day: number },
  deltaDays: number,
) {
  const d = new Date(Date.UTC(year, month, day));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

export function isWithinCoolingOffWindow(
  { activatedAt, requestedAt }: { activatedAt: string | number | Date; requestedAt: string | number | Date },
) {
  const activated = toDate(activatedAt);
  const requested = toDate(requestedAt);
  const activatedTaipeiDate = taipeiCalendarDate(activated);
  const boundaryDate = addCalendarDays(activatedTaipeiDate, 7);
  const boundaryInstant = taipeiEndOfDayUtc(boundaryDate);
  return requested.getTime() <= boundaryInstant.getTime();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function roundToCurrencyMinorUnit(amount: number, currency: string) {
  const zeroDecimalCurrencies = new Set(["TWD", "JPY", "KRW"]);
  const decimals = zeroDecimalCurrencies.has(String(currency || "").toUpperCase()) ? 0 : 2;
  const factor = 10 ** decimals;
  return Math.round((Number(amount) + Number.EPSILON) * factor) / factor;
}

function wholeElapsedDays(fromDate: Date, toDateValue: Date) {
  const ms = toDateValue.getTime() - fromDate.getTime();
  return Math.max(0, Math.floor(ms / MS_PER_DAY));
}

function totalPeriodDays(periodStart: Date, periodEnd: Date) {
  const ms = periodEnd.getTime() - periodStart.getTime();
  const days = Math.round(ms / MS_PER_DAY);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("REFUND_CALC_INVALID_PERIOD");
  }
  return days;
}

// deno-lint-ignore no-explicit-any
export function calculateSubscriptionRefund(input: any) {
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

  const withinCoolingOff = isWithinCoolingOffWindow({ activatedAt, requestedAt });

  const totalDays = totalPeriodDays(periodStart, periodEnd);

  let usedDays: number;
  let unusedDays: number;
  let subscriptionRefundAmount: number;

  if (withinCoolingOff) {
    usedDays = 0;
    unusedDays = totalDays;
    subscriptionRefundAmount = roundToCurrencyMinorUnit(paidAmount, currency);
  } else {
    usedDays = clamp(wholeElapsedDays(periodStart, requestedAt), 0, totalDays);
    unusedDays = totalDays - usedDays;
    subscriptionRefundAmount = roundToCurrencyMinorUnit((paidAmount * unusedDays) / totalDays, currency);
  }

  const giftShipped = Boolean(input.giftShipped);
  const giftEverGranted = Boolean(input.giftEverGranted);
  const shippingFeeAmount = Number(input.shippingFeeAmount || 0);
  const shippingFeeCurrency = String(input.shippingFeeCurrency || "TWD").toUpperCase();

  // Shipping fee is never prorated. This is the DEFAULT (ordinary/
  // contractual) outcome only — full refund if not yet shipped, zero once
  // shipped. It is NOT the final word: a statutory withdrawal claim can
  // override it (see shippingRefundLegalReviewRecommended below).
  const shippingRefundAmount = giftEverGranted && !giftShipped
    ? roundToCurrencyMinorUnit(shippingFeeAmount, shippingFeeCurrency)
    : 0;

  const giftReturnRequired = giftEverGranted && giftShipped && withinCoolingOff;

  // Whenever the gift already shipped, the DEFAULT shipping-fee outcome
  // (no refund) is only correct for an ordinary change-of-mind refund — a
  // statutory withdrawal right can require refunding the fee AND having the
  // business bear the necessary return-shipping cost. Never auto-resolve
  // this; always route it to manual review.
  const shippingRefundLegalReviewRecommended = giftEverGranted && giftShipped;
  const returnShippingCostBorneByBusinessIfLegalWithdrawal = shippingRefundLegalReviewRecommended;

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
    shippingRefundLegalReviewRecommended,
    returnShippingCostBorneByBusinessIfLegalWithdrawal,
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
      shipping_refund_legal_review_recommended: shippingRefundLegalReviewRecommended,
      return_shipping_cost_borne_by_business_if_legal_withdrawal: returnShippingCostBorneByBusinessIfLegalWithdrawal,
      calculation_rule_version: CALCULATION_RULE_VERSION,
    },
  };
}
