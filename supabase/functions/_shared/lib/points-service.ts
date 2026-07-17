// ESM port of `js/services/wallpaper/points-service.js`. Logic unchanged.

import { createGenerationErrorDto } from "./response-dto.ts";

export function createPointsService({
  pointsRepository,
  defaultGenerationCost = 10
}: {
  pointsRepository: {
    // deno-lint-ignore no-explicit-any
    findUser(userId: string): Promise<any>;
    applyPointsDeduction(userId: string, points: number): Promise<boolean>;
    // deno-lint-ignore no-explicit-any
    fetchActiveGenerationCost(): Promise<any>;
  };
  defaultGenerationCost?: number;
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

  async function validateUser(userId: string) {
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
        details: { reason: (error as Error)?.message || "unknown" }
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
    } catch (_error) {
      return {
        ok: true,
        data: {
          costPoints: normalizedDefaultCost
        }
      };
    }
  }

  async function deductOnSuccess({ userId, costPoints }: { userId: string; costPoints: number }) {
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
        details: { reason: (error as Error)?.message || "unknown" }
      });
    }
  }

  return {
    validateUser,
    getGenerationCost,
    deductOnSuccess
  };
}
