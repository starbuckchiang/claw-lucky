// ESM port of `js/services/wallpaper/generation-orchestrator.js` (ADR-004).
// Logic unchanged: Create Job -> Mark Running -> Call Generation Service ->
// (success) Deduct Points -> Record Usage -> Mark Job Success, with the
// same normalized error codes and failure handling on every step.

import { createGenerationErrorDto } from "./response-dto.ts";
import { createGenerationTracing } from "./generation-tracing.ts";
import { createGenerationLogger } from "./generation-logger.ts";

export function createGenerationOrchestrator({
  generationService,
  usageService,
  jobService,
  pointsService,
  generationTracing = createGenerationTracing(),
  generationLogger = createGenerationLogger()
}: {
  generationService: {
    // deno-lint-ignore no-explicit-any
    createWallpaperGeneration(request: any): Promise<any>;
  };
  usageService: {
    // deno-lint-ignore no-explicit-any
    checkDailyLimit(userId: string): Promise<any>;
    // deno-lint-ignore no-explicit-any
    recordSuccess(userId: string): Promise<any>;
  };
  jobService: {
    JOB_STATUS?: Record<string, string>;
    // deno-lint-ignore no-explicit-any
    createJob(payload: any): Promise<any>;
    // deno-lint-ignore no-explicit-any
    markRunning(jobId: string): Promise<any>;
    // deno-lint-ignore no-explicit-any
    markSuccess(jobId: string, patch?: any): Promise<any>;
    // deno-lint-ignore no-explicit-any
    markFailed(jobId: string, patch?: any): Promise<any>;
  };
  pointsService: {
    // deno-lint-ignore no-explicit-any
    validateUser(userId: string): Promise<any>;
    // deno-lint-ignore no-explicit-any
    getGenerationCost(): Promise<any>;
    // deno-lint-ignore no-explicit-any
    deductOnSuccess(input: any): Promise<any>;
  };
  // deno-lint-ignore no-explicit-any
  generationTracing?: any;
  // deno-lint-ignore no-explicit-any
  generationLogger?: any;
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

  // deno-lint-ignore no-explicit-any
  async function failJobIfNeeded(jobId: string | null, patch: any) {
    if (!jobId) {
      return;
    }

    await jobService.markFailed(jobId, patch);
  }

  // deno-lint-ignore no-explicit-any
  async function orchestrate(request: any) {
    const trace = generationTracing.startTrace({
      correlationId: request?.correlationId
    });

    const userId = String(request?.userId || "").trim();
    let jobId: string | null = null;

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
          // Safe diagnostics only (reason/code/details/hint/table/operation)
          // surfaced from job-service.ts so the real underlying
          // Supabase/Postgres error is visible in Edge Function logs
          // instead of being fully swallowed behind JOB_CREATION_FAILURE.
          diagnostics: createdJob.error.details || null,
          status: "failed"
        }
      });
      return createdJob;
    }

    jobId = createdJob.data?.jobId || createdJob.data?.id || null;

    const running = await jobService.markRunning(jobId as string);
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

    const success = await jobService.markSuccess(jobId as string, {
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
