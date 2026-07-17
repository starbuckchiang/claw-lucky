"use strict";

const { createGenerationErrorDto } = require("./response-dto");
const { createGenerationTracing } = require("../logging/generation-tracing");
const { createGenerationLogger } = require("../logging/generation-logger");

function createGenerationOrchestrator({
  generationService,
  usageService,
  jobService,
  pointsService,
  generationTracing = createGenerationTracing(),
  generationLogger = createGenerationLogger()
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
    const trace = generationTracing.startTrace({
      correlationId: request?.correlationId
    });

    const userId = String(request?.userId || "").trim();
    let jobId = null;

    generationLogger.logInfo({
      event: "generation_orchestrator_started",
      correlationId: trace.correlationId,
      payload: {
        status: "started",
        createdAt: trace.createdAt
      }
    });

    const userCheck = await pointsService.validateUser(userId);
    if (!userCheck.ok) {
      generationLogger.logWarn({
        event: "generation_orchestrator_user_validation_failed",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, userCheck.error.code),
          status: "failed"
        }
      });
      return userCheck;
    }

    const usageCheck = await usageService.checkDailyLimit(userId);
    if (!usageCheck.ok) {
      generationLogger.logWarn({
        event: "generation_orchestrator_daily_limit_failed",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, usageCheck.error.code),
          status: "failed"
        }
      });
      return usageCheck;
    }

    const costResult = await pointsService.getGenerationCost();
    if (!costResult.ok) {
      generationLogger.logWarn({
        event: "generation_orchestrator_cost_lookup_failed",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, costResult.error.code),
          status: "failed"
        }
      });
      return costResult;
    }

    const createdJob = await jobService.createJob({
      userId,
      status: jobService.JOB_STATUS?.PENDING || "Pending"
    });
    if (!createdJob.ok) {
      generationLogger.logError({
        event: "generation_orchestrator_job_creation_failed",
        correlationId: trace.correlationId,
        payload: {
          error: generationTracing.buildErrorTrace(trace, createdJob.error.code),
          status: "failed"
        }
      });
      return createdJob;
    }

    jobId = createdJob.data?.jobId || createdJob.data?.id || null;

    const running = await jobService.markRunning(jobId);
    if (!running.ok) {
      generationLogger.logError({
        event: "generation_orchestrator_mark_running_failed",
        correlationId: trace.correlationId,
        payload: {
          jobId,
          error: generationTracing.buildErrorTrace(trace, running.error.code),
          status: "failed"
        }
      });
      return running;
    }

    const generationResult = await generationService.createWallpaperGeneration({
      ...request,
      correlationId: trace.correlationId
    });
    if (!generationResult.ok) {
      await failJobIfNeeded(jobId, {
        failureCode: generationResult.error.code,
        failureMessage: generationResult.error.message
      });

      generationLogger.logError({
        event: "generation_orchestrator_generation_failed",
        correlationId: trace.correlationId,
        payload: {
          jobId,
          error: generationTracing.buildErrorTrace(trace, generationResult.error.code),
          status: "failed"
        }
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
      generationLogger.logError({
        event: "generation_orchestrator_points_failed",
        correlationId: trace.correlationId,
        payload: {
          jobId,
          generationId: generationResult.data?.generationId || null,
          error: generationTracing.buildErrorTrace(trace, pointsDeduction.error.code),
          status: "failed"
        }
      });
      return pointsDeduction;
    }

    const usageSaved = await usageService.recordSuccess(userId);
    if (!usageSaved.ok) {
      await failJobIfNeeded(jobId, {
        failureCode: usageSaved.error.code,
        failureMessage: usageSaved.error.message
      });
      generationLogger.logError({
        event: "generation_orchestrator_usage_failed",
        correlationId: trace.correlationId,
        payload: {
          jobId,
          generationId: generationResult.data?.generationId || null,
          error: generationTracing.buildErrorTrace(trace, usageSaved.error.code),
          status: "failed"
        }
      });
      return usageSaved;
    }

    const success = await jobService.markSuccess(jobId, {
      generationId: generationResult.data.generationId
    });
    if (!success.ok) {
      generationLogger.logError({
        event: "generation_orchestrator_mark_success_failed",
        correlationId: trace.correlationId,
        payload: {
          jobId,
          generationId: generationResult.data?.generationId || null,
          error: generationTracing.buildErrorTrace(trace, success.error.code),
          status: "failed"
        }
      });
      return success;
    }

    const result = {
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

    generationLogger.logInfo({
      event: "generation_orchestrator_succeeded",
      correlationId: trace.correlationId,
      payload: generationTracing.buildGenerationTrace(trace, {
        generationId: result.data.generationId,
        jobId: result.data.jobId,
        provider: result.data.provider,
        model: result.data.model,
        promptVersion: result.data.promptVersion,
        status: result.data.status,
        durationMs: result.data.durationMs,
        createdAt: result.data.createdAt
      })
    });

    return result;
  }

  return {
    createWallpaperGenerationWorkflow: orchestrate
  };
}

module.exports = {
  createGenerationOrchestrator
};
