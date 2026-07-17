// ESM port of `js/services/wallpaper/job-service.js`. Logic unchanged.

import { createGenerationErrorDto } from "./response-dto.ts";

// Extracts ONLY safe, non-secret diagnostic fields from a raw
// Supabase/Postgres error (never JWTs/API keys/service-role keys/full
// request headers). `table`/`operation` are attached by the repository
// layer (see job-repository.ts) so the real failure point is visible even
// though the public-facing error code stays normalized.
// deno-lint-ignore no-explicit-any
function extractSafeErrorDiagnostics(error: any) {
  return {
    reason: error?.message || "unknown",
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
    table: error?.table || null,
    operation: error?.operation || null
  };
}

export const JOB_STATUS = Object.freeze({
  PENDING: "Pending",
  RUNNING: "Running",
  SUCCESS: "Success",
  FAILED: "Failed"
});

export function createJobService({
  jobRepository,
  now = () => new Date()
}: {
  jobRepository: {
    // deno-lint-ignore no-explicit-any
    create(payload: any): Promise<any>;
    // deno-lint-ignore no-explicit-any
    update(jobId: string, patch: any): Promise<any>;
  };
  now?: () => Date;
}) {
  if (!jobRepository || typeof jobRepository.create !== "function" || typeof jobRepository.update !== "function") {
    throw new Error("createJobService requires jobRepository.create and jobRepository.update.");
  }

  // deno-lint-ignore no-explicit-any
  async function createJob(payload: any) {
    try {
      const created = await jobRepository.create({
        ...payload,
        status: JOB_STATUS.PENDING,
        createdAt: now().toISOString()
      });

      return {
        ok: true,
        data: created
      };
    } catch (error) {
      return createGenerationErrorDto({
        code: "JOB_CREATION_FAILURE",
        message: "Failed to create generation job.",
        retryable: true,
        details: extractSafeErrorDiagnostics(error)
      });
    }
  }

  async function markRunning(jobId: string) {
    try {
      await jobRepository.update(jobId, {
        status: JOB_STATUS.RUNNING,
        updatedAt: now().toISOString()
      });

      return { ok: true };
    } catch (error) {
      return createGenerationErrorDto({
        code: "PERSISTENCE_FAILURE",
        message: "Failed to update job status to Running.",
        retryable: true,
        details: { ...extractSafeErrorDiagnostics(error), jobId }
      });
    }
  }

  // deno-lint-ignore no-explicit-any
  async function markSuccess(jobId: string, patch: any = {}) {
    try {
      await jobRepository.update(jobId, {
        status: JOB_STATUS.SUCCESS,
        updatedAt: now().toISOString(),
        ...patch
      });

      return { ok: true };
    } catch (error) {
      return createGenerationErrorDto({
        code: "PERSISTENCE_FAILURE",
        message: "Failed to update job status to Success.",
        retryable: true,
        details: { ...extractSafeErrorDiagnostics(error), jobId }
      });
    }
  }

  // deno-lint-ignore no-explicit-any
  async function markFailed(jobId: string, patch: any = {}) {
    try {
      await jobRepository.update(jobId, {
        status: JOB_STATUS.FAILED,
        updatedAt: now().toISOString(),
        ...patch
      });

      return { ok: true };
    } catch (error) {
      return createGenerationErrorDto({
        code: "PERSISTENCE_FAILURE",
        message: "Failed to update job status to Failed.",
        retryable: true,
        details: { ...extractSafeErrorDiagnostics(error), jobId }
      });
    }
  }

  return {
    JOB_STATUS,
    createJob,
    markRunning,
    markSuccess,
    markFailed
  };
}
