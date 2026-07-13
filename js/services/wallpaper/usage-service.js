"use strict";

const { createGenerationErrorDto } = require("./response-dto");

function createUsageService({
  usageRepository,
  dailyLimit = 3,
  now = () => new Date()
}) {
  if (!usageRepository || typeof usageRepository.fetchUsage !== "function" || typeof usageRepository.saveUsage !== "function") {
    throw new Error("createUsageService requires usageRepository.fetchUsage and usageRepository.saveUsage.");
  }

  const normalizedDailyLimit = Number.isFinite(Number(dailyLimit)) ? Math.max(1, Number(dailyLimit)) : 3;

  function resolveUsageDate() {
    return now().toISOString().slice(0, 10);
  }

  async function checkDailyLimit(userId) {
    const usageDate = resolveUsageDate();
    let row;

    try {
      row = await usageRepository.fetchUsage(userId, usageDate);
    } catch (error) {
      return createGenerationErrorDto({
        code: "PERSISTENCE_FAILURE",
        message: "Failed to read daily usage.",
        retryable: true,
        details: { reason: error?.message || "unknown" }
      });
    }

    const successCount = Number(row?.successCount || 0);
    const allowed = successCount < normalizedDailyLimit;

    if (!allowed) {
      return createGenerationErrorDto({
        code: "DAILY_LIMIT_EXCEEDED",
        message: "Daily generation limit exceeded.",
        retryable: false,
        details: {
          dailyLimit: normalizedDailyLimit,
          successCount
        }
      });
    }

    return {
      ok: true,
      data: {
        usageDate,
        successCount,
        dailyLimit: normalizedDailyLimit
      }
    };
  }

  async function recordSuccess(userId) {
    const usageDate = resolveUsageDate();
    let current;

    try {
      current = await usageRepository.fetchUsage(userId, usageDate);
    } catch (error) {
      return createGenerationErrorDto({
        code: "PERSISTENCE_FAILURE",
        message: "Failed to read daily usage before update.",
        retryable: true,
        details: { reason: error?.message || "unknown" }
      });
    }

    const nextSuccessCount = Number(current?.successCount || 0) + 1;

    try {
      const saved = await usageRepository.saveUsage({
        userId,
        usageDate,
        successCount: nextSuccessCount
      });

      return {
        ok: true,
        data: saved || {
          userId,
          usageDate,
          successCount: nextSuccessCount
        }
      };
    } catch (error) {
      return createGenerationErrorDto({
        code: "PERSISTENCE_FAILURE",
        message: "Failed to persist daily usage.",
        retryable: true,
        details: { reason: error?.message || "unknown" }
      });
    }
  }

  return {
    checkDailyLimit,
    recordSuccess
  };
}

module.exports = {
  createUsageService
};
