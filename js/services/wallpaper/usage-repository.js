"use strict";

function createUsageRepository({
  getUsageByUserAndDate,
  saveUsageByUserAndDate
}) {
  if (typeof getUsageByUserAndDate !== "function") {
    throw new Error("createUsageRepository requires getUsageByUserAndDate(userId, usageDate).");
  }

  if (typeof saveUsageByUserAndDate !== "function") {
    throw new Error("createUsageRepository requires saveUsageByUserAndDate(payload).");
  }

  return {
    fetchUsage(userId, usageDate) {
      return getUsageByUserAndDate(userId, usageDate);
    },
    saveUsage(payload) {
      return saveUsageByUserAndDate(payload);
    }
  };
}

module.exports = {
  createUsageRepository
};
