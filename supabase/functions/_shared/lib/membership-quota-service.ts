// ESM port of `js/services/wallpaper/membership-quota-service.js`. Logic unchanged.
import { createGenerationErrorDto } from "./response-dto.ts";

const PAID_MONTHLY_LIMIT = 10;
const FREE_LIFETIME_LIMIT = 3;
const FREE_TRIAL_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const RESERVATION_TTL_SECONDS = 120;

const ASIA_TAIPEI_OFFSET_MINUTES = 8 * 60;

export function resolveTaipeiMonthKey(date: Date) {
  const shifted = new Date(date.getTime() + ASIA_TAIPEI_OFFSET_MINUTES * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// deno-lint-ignore no-explicit-any
export function createMembershipQuotaService({
  subscriptionRepository,
  quotaRepository,
  now = () => new Date(),
}: {
  // deno-lint-ignore no-explicit-any
  subscriptionRepository: any;
  // deno-lint-ignore no-explicit-any
  quotaRepository: any;
  now?: () => Date;
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
      "createMembershipQuotaService requires quotaRepository.reserveQuota/confirmUsage/releaseReservation.",
    );
  }

  async function resolveContext(userId: string) {
    const sub = await subscriptionRepository.findActiveSubscription(userId);
    const nowMs = now().getTime();
    const isPaid = Boolean(
      sub
        && String(sub.status || "").toUpperCase() === "ACTIVE"
        && sub.paid_through
        && new Date(sub.paid_through).getTime() > nowMs,
    );

    if (isPaid) {
      return {
        isPaid: true,
        periodKey: `paid:${resolveTaipeiMonthKey(now())}`,
        limit: PAID_MONTHLY_LIMIT,
        trialWindowSeconds: null as number | null,
      };
    }

    return {
      isPaid: false,
      periodKey: "free:lifetime",
      limit: FREE_LIFETIME_LIMIT,
      trialWindowSeconds: FREE_TRIAL_WINDOW_SECONDS as number | null,
    };
  }

  async function checkDailyLimit(userId: string) {
    const ctx = await resolveContext(userId);

    // deno-lint-ignore no-explicit-any
    let reserveResult: any;
    try {
      reserveResult = await quotaRepository.reserveQuota({
        userId,
        periodKey: ctx.periodKey,
        limit: ctx.limit,
        ttlSeconds: RESERVATION_TTL_SECONDS,
        trialWindowSeconds: ctx.trialWindowSeconds,
      });
    } catch (error) {
      return createGenerationErrorDto({
        code: "PERSISTENCE_FAILURE",
        message: "Failed to check generation quota.",
        retryable: true,
        details: { reason: (error as Error)?.message || "unknown" },
      });
    }

    if (!reserveResult.allowed) {
      return createGenerationErrorDto({
        code: "DAILY_LIMIT_EXCEEDED",
        message: ctx.isPaid
          ? "本月桌布生成額度已用完，請於下個月重新使用。"
          : "免費體驗次數已用完，升級會員方案可取得每月生成額度。",
        retryable: false,
        details: { isPaid: ctx.isPaid, periodKey: ctx.periodKey, limit: ctx.limit },
      });
    }

    return {
      ok: true,
      data: {
        periodKey: ctx.periodKey,
        isPaid: ctx.isPaid,
        limit: ctx.limit,
        remaining: reserveResult.remaining,
      },
    };
  }

  async function recordSuccess(userId: string) {
    const ctx = await resolveContext(userId);
    try {
      await quotaRepository.confirmUsage({ userId, periodKey: ctx.periodKey });
    } catch (error) {
      return createGenerationErrorDto({
        code: "PERSISTENCE_FAILURE",
        message: "Failed to record generation quota usage.",
        retryable: true,
        details: { reason: (error as Error)?.message || "unknown" },
      });
    }
    return { ok: true, data: { periodKey: ctx.periodKey } };
  }

  async function releaseReservation(userId: string) {
    const ctx = await resolveContext(userId);
    try {
      await quotaRepository.releaseReservation({ userId, periodKey: ctx.periodKey });
    } catch (_error) {
      // Best-effort: a leaked reservation self-expires via the TTL sweep.
    }
  }

  return { checkDailyLimit, recordSuccess, releaseReservation };
}

export { FREE_LIFETIME_LIMIT, FREE_TRIAL_WINDOW_SECONDS, PAID_MONTHLY_LIMIT };
