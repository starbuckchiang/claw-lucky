"use strict";

function createPointsRepository({
  getUserById,
  deductPoints,
  getActiveGenerationCost
}) {
  if (typeof getUserById !== "function") {
    throw new Error("createPointsRepository requires getUserById(userId).");
  }

  if (typeof deductPoints !== "function") {
    throw new Error("createPointsRepository requires deductPoints(userId, points).");
  }

  if (typeof getActiveGenerationCost !== "function") {
    throw new Error("createPointsRepository requires getActiveGenerationCost().");
  }

  return {
    findUser(userId) {
      return getUserById(userId);
    },
    applyPointsDeduction(userId, points) {
      return deductPoints(userId, points);
    },
    fetchActiveGenerationCost() {
      return getActiveGenerationCost();
    }
  };
}

module.exports = {
  createPointsRepository
};
