"use strict";

const { createGenerationErrorDto } = require("./response-dto");

function createGenerationOrchestrator({
  generationService,
  usageService,
  jobService,
  pointsService
}) {
  if (!generationService || typeof generationService.createWallpaperGeneration !== "function") {
    throw new Error("createGenerationOrchestrator requires generationService.createWallpaperGeneration(request).");
  }

  if (!usageService || typeof usageService.checkDailyLimit !== "function" || typeof usageService.recordSuccess !== "function") {
    throw new Error("createGenerationOrchestrator requires usageService.checkDailyLimit/recordSuccess.");
  }

  if (
    !jobService ||
    typeof jobService.createJob !== "function" ||
    typeof jobService.markRunning !== "function" ||
    typeof jobService.markSuccess !== "function" ||
    typeof jobService.markFailed !== "function"
  ) {
    throw new Error("createGenerationOrchestrator requires jobService create/update status methods.");
  }

  if (
    !pointsService ||
    typeof pointsService.validateUser !== "function" ||
    typeof pointsService.getGenerationCost !== "function" ||
    typeof pointsService.deductOnSuccess !== "function"
  ) {
    throw new Error("createGenerationOrchestrator requires pointsService validateUser/getGenerationCost/deductOnSuccess.");
  }

  async function failJobIfNeeded(jobId, patch) {
    if (!jobId) {
      return;
    }

    await jobService.markFailed(jobId, patch);
  }

  async function orchestrate(request) {
    const userId = String(request?.userId || "").trim();
    let jobId = null;

    const userCheck = await pointsService.validateUser(userId);
    if (!userCheck.ok) {
      return userCheck;
    }

    const usageCheck = await usageService.checkDailyLimit(userId);
    if (!usageCheck.ok) {
      return usageCheck;
    }

    const costResult = await pointsService.getGenerationCost();
    if (!costResult.ok) {
      return costResult;
    }

    const createdJob = await jobService.createJob({
      userId,
      status: jobService.JOB_STATUS?.PENDING || "Pending"
    });
    if (!createdJob.ok) {
      return createdJob;
    }

    jobId = createdJob.data?.jobId || createdJob.data?.id || null;

    const running = await jobService.markRunning(jobId);
    if (!running.ok) {
      return running;
    }

    const generationResult = await generationService.createWallpaperGeneration(request);
    if (!generationResult.ok) {
      await failJobIfNeeded(jobId, {
        failureCode: generationResult.error.code,
        failureMessage: generationResult.error.message
      });

      return createGenerationErrorDto({
        code: "GENERATION_FAILURE",
        message: "Generation workflow failed.",
        retryable: Boolean(generationResult.error.retryable),
        details: {
          jobId,
          generationError: generationResult.error
        }
      });
    }

    const pointsDeduction = await pointsService.deductOnSuccess({
      userId,
      costPoints: costResult.data.costPoints
    });
    if (!pointsDeduction.ok) {
      await failJobIfNeeded(jobId, {
        failureCode: pointsDeduction.error.code,
        failureMessage: pointsDeduction.error.message
      });
      return pointsDeduction;
    }

    const usageSaved = await usageService.recordSuccess(userId);
    if (!usageSaved.ok) {
      await failJobIfNeeded(jobId, {
        failureCode: usageSaved.error.code,
        failureMessage: usageSaved.error.message
      });
      return usageSaved;
    }

    const success = await jobService.markSuccess(jobId, {
      generationId: generationResult.data.generationId
    });
    if (!success.ok) {
      return success;
    }

    return {
      ok: true,
      data: {
        ...generationResult.data,
        jobId,
        jobStatus: jobService.JOB_STATUS?.SUCCESS || "Success",
        deductedPoints: pointsDeduction.data.deductedPoints,
        usageDate: usageSaved.data.usageDate,
        usageCount: usageSaved.data.successCount
      }
    };
  }

  return {
    createWallpaperGenerationWorkflow: orchestrate
  };
}

module.exports = {
  createGenerationOrchestrator
};
