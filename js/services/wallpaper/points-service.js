"use strict";

const { createGenerationErrorDto } = require("./response-dto");

function createPointsService({
  pointsRepository,
  defaultGenerationCost = 10
}) {
  if (
    !pointsRepository ||
    typeof pointsRepository.findUser !== "function" ||
    typeof pointsRepository.applyPointsDeduction !== "function" ||
    typeof pointsRepository.fetchActiveGenerationCost !== "function"
  ) {
    throw new Error(
      "createPointsService requires pointsRepository.findUser/applyPointsDeduction/fetchActiveGenerationCost."
    );
  }

  const normalizedDefaultCost = Number.isFinite(Number(defaultGenerationCost))
    ? Math.max(0, Number(defaultGenerationCost))
    : 10;

  async function validateUser(userId) {
    try {
      const user = await pointsRepository.findUser(userId);

      if (!user) {
        return createGenerationErrorDto({
          code: "INVALID_REQUEST",
          message: "User not found.",
          retryable: false
        });
      }

      return {
        ok: true,
        data: user
      };
    } catch (error) {
      return createGenerationErrorDto({
        code: "PERSISTENCE_FAILURE",
        message: "Failed to validate user.",
        retryable: true,
        details: { reason: error?.message || "unknown" }
      });
    }
  }

  async function getGenerationCost() {
    try {
      const active = await pointsRepository.fetchActiveGenerationCost();
      const costPoints = Number(active?.costPoints);

      return {
        ok: true,
        data: {
          costPoints: Number.isFinite(costPoints) && costPoints >= 0 ? costPoints : normalizedDefaultCost
        }
      };
    } catch (error) {
      return {
        ok: true,
        data: {
          costPoints: normalizedDefaultCost
        }
      };
    }
  }

  async function deductOnSuccess({ userId, costPoints }) {
    try {
      const applied = await pointsRepository.applyPointsDeduction(userId, costPoints);

      if (!applied) {
        return createGenerationErrorDto({
          code: "POINTS_DEDUCTION_FAILURE",
          message: "Failed to deduct points.",
          retryable: true
        });
      }

      return {
        ok: true,
        data: {
          deductedPoints: costPoints
        }
      };
    } catch (error) {
      return createGenerationErrorDto({
        code: "POINTS_DEDUCTION_FAILURE",
        message: "Failed to deduct points.",
        retryable: true,
        details: { reason: error?.message || "unknown" }
      });
    }
  }

  return {
    validateUser,
    getGenerationCost,
    deductOnSuccess
  };
}

module.exports = {
  createPointsService
};
