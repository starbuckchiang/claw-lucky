"use strict";

const { createGenerationErrorDto } = require("./response-dto");

/**
 * PROD-RELEASE-DAY3C: membership-aware wallpaper generation quota.
 * Exposes the SAME interface as the older daily-count usage-service
 * (`checkDailyLimit`/`recordSuccess`) so it drops into
 * generation-orchestrator.js with zero orchestrator changes — plus one
 * additive, optional `releaseReservation` the orchestrator calls on a
 * generation failure (backward compatible: skipped if absent).
 *
 * Rules (confirmed, do not alter without new instruction):
 *   - Paid (ACTIVE subscription, now < paid_through): 10 / calendar month
 *     (Asia/Taipei), reset monthly — yearly billing still only grants
 *     10/month, never a lump sum.
 *   - Free (not currently paid): 3 TOTAL, ever, usable only within 30 days
 *     of the first time this gate is evaluated for that user (lazily
 *     anchored — see migration header for why no `users.created_at` is used).
 *     Once spent or the window closes, free quota is permanently 0 — never
 *     refilled by cancel/resubscribe without ever actually paying.
 */

const PAID_MONTHLY_LIMIT = 10;
const FREE_LIFETIME_LIMIT = 3;
const FREE_TRIAL_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const RESERVATION_TTL_SECONDS = 120;

const ASIA_TAIPEI_OFFSET_MINUTES = 8 * 60;

function resolveTaipeiMonthKey(date) {
  const shifted = new Date(date.getTime() + ASIA_TAIPEI_OFFSET_MINUTES * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function createMembershipQuotaService({
  subscriptionRepository,
  quotaRepository,
  now = () => new Date()
}) {
  if (!subscriptionRepository || typeof subscriptionRepository.findActiveSubscription !== "function") {
    throw new Error("createMembershipQuotaService requires subscriptionRepository.findActiveSubscription(userId).");
  }
  if (
    !quotaRepository
    || typeof quotaRepository.reserveQuota !== "function"
    || typeof quotaRepository.confirmUsage !== "function"
    || typeof quotaRepository.releaseReservation !== "function"
  ) {
    throw new Error(
      "createMembershipQuotaService requires quotaRepository.reserveQuota/confirmUsage/releaseReservation."
    );
  }

  async function resolveContext(userId) {
    const sub = await subscriptionRepository.findActiveSubscription(userId);
    const nowMs = now().getTime();
    const isPaid = Boolean(
      sub
      && String(sub.status || "").toUpperCase() === "ACTIVE"
      && sub.paid_through
      && new Date(sub.paid_through).getTime() > nowMs
    );

    if (isPaid) {
      return {
        isPaid: true,
        periodKey: `paid:${resolveTaipeiMonthKey(now())}`,
        limit: PAID_MONTHLY_LIMIT,
        trialWindowSeconds: null
      };
    }

    return {
      isPaid: false,
      periodKey: "free:lifetime",
      limit: FREE_LIFETIME_LIMIT,
      trialWindowSeconds: FREE_TRIAL_WINDOW_SECONDS
    };
  }

  async function checkDailyLimit(userId) {
    const ctx = await resolveContext(userId);

    let reserveResult;
    try {
      reserveResult = await quotaRepository.reserveQuota({
        userId,
        periodKey: ctx.periodKey,
        limit: ctx.limit,
        ttlSeconds: RESERVATION_TTL_SECONDS,
        trialWindowSeconds: ctx.trialWindowSeconds
      });
    } catch (error) {
      return createGenerationErrorDto({
        code: "PERSISTENCE_FAILURE",
        message: "Failed to check generation quota.",
        retryable: true,
        details: { reason: error?.message || "unknown" }
      });
    }

    if (!reserveResult.allowed) {
      return createGenerationErrorDto({
        code: "DAILY_LIMIT_EXCEEDED",
        message: ctx.isPaid
          ? "本月桌布生成額度已用完，請於下個月重新使用。"
          : "免費體驗次數已用完，升級會員方案可取得每月生成額度。",
        retryable: false,
        details: { isPaid: ctx.isPaid, periodKey: ctx.periodKey, limit: ctx.limit }
      });
    }

    return {
      ok: true,
      data: {
        periodKey: ctx.periodKey,
        isPaid: ctx.isPaid,
        limit: ctx.limit,
        remaining: reserveResult.remaining
      }
    };
  }

  async function recordSuccess(userId) {
    const ctx = await resolveContext(userId);
    try {
      await quotaRepository.confirmUsage({ userId, periodKey: ctx.periodKey });
    } catch (error) {
      return createGenerationErrorDto({
        code: "PERSISTENCE_FAILURE",
        message: "Failed to record generation quota usage.",
        retryable: true,
        details: { reason: error?.message || "unknown" }
      });
    }
    return { ok: true, data: { periodKey: ctx.periodKey } };
  }

  async function releaseReservation(userId) {
    const ctx = await resolveContext(userId);
    try {
      await quotaRepository.releaseReservation({ userId, periodKey: ctx.periodKey });
    } catch (_error) {
      // Best-effort: a leaked reservation self-expires via the TTL sweep
      // inside reserve_wallpaper_quota on the user's next attempt.
    }
  }

  return { checkDailyLimit, recordSuccess, releaseReservation };
}

module.exports = {
  createMembershipQuotaService,
  PAID_MONTHLY_LIMIT,
  FREE_LIFETIME_LIMIT,
  FREE_TRIAL_WINDOW_SECONDS,
  resolveTaipeiMonthKey
};
