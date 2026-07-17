// ESM port of `js/services/wallpaper/generation-query-service.js`. Logic
// unchanged (ADR-006 ownership + status mapping + polling interval rules).

import {
  API_GENERATION_STATUSES,
  createStatusSuccessDto,
  createStatusErrorDto
} from "./progress-response-dto.ts";

const DB_GENERATION_STATUS = new Set([
  "pending",
  "processing",
  "succeeded",
  "failed",
  "expired"
]);

const DB_JOB_STATUS_TO_API: Record<string, string> = Object.freeze({
  queued: "pending",
  processing: "processing",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "failed"
});

function normalizeGenerationStatus(generationStatus: unknown, jobStatus: unknown): string | null {
  const gen = String(generationStatus || "").trim();
  const job = String(jobStatus || "").trim();

  if (DB_GENERATION_STATUS.has(gen)) {
    return gen;
  }

  const mapped = DB_JOB_STATUS_TO_API[job];
  if (mapped) {
    return mapped;
  }

  return null;
}

function isValidGenerationId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// deno-lint-ignore no-explicit-any
function resolveUpdatedAt(row: any) {
  return row.jobUpdatedAt || row.updatedAt || row.createdAt;
}

export function createGenerationQueryService({
  generationQueryRepository
}: {
  generationQueryRepository: {
    // deno-lint-ignore no-explicit-any
    getByGenerationId(generationId: string): Promise<any>;
  };
}) {
  if (!generationQueryRepository || typeof generationQueryRepository.getByGenerationId !== "function") {
    throw new Error("createGenerationQueryService requires generationQueryRepository.getByGenerationId(generationId).");
  }

  async function queryStatus({ generationId, requesterUserId }: { generationId: unknown; requesterUserId: unknown }) {
    const normalizedGenerationId = String(generationId || "").trim();
    const normalizedUserId = String(requesterUserId || "").trim();

    if (!isValidGenerationId(normalizedGenerationId)) {
      return createStatusErrorDto({
        code: "INVALID_GENERATION_ID",
        message: "Generation id is invalid.",
        retryable: false
      });
    }

    if (!normalizedUserId) {
      return createStatusErrorDto({
        code: "UNAUTHORIZED_GENERATION_ACCESS",
        message: "Authentication context is missing.",
        retryable: false
      });
    }

    // deno-lint-ignore no-explicit-any
    let row: any;
    try {
      row = await generationQueryRepository.getByGenerationId(normalizedGenerationId);
    } catch (error) {
      return createStatusErrorDto({
        code: "QUERY_FAILURE",
        message: "Failed to query generation status.",
        retryable: true,
        details: { reason: (error as Error)?.message || "unknown" }
      });
    }

    if (!row) {
      return createStatusErrorDto({
        code: "GENERATION_NOT_FOUND",
        message: "Generation not found.",
        retryable: false
      });
    }

    if (String(row.userId || "").trim() !== normalizedUserId) {
      return createStatusErrorDto({
        code: "UNAUTHORIZED_GENERATION_ACCESS",
        message: "You do not have access to this generation.",
        retryable: false
      });
    }

    const apiStatus = normalizeGenerationStatus(row.generationStatus, row.jobStatus);
    if (!apiStatus || !API_GENERATION_STATUSES.includes(apiStatus)) {
      return createStatusErrorDto({
        code: "INVALID_STATUS_RESPONSE",
        message: "Generation status cannot be mapped to API status.",
        retryable: false,
        details: {
          generationStatus: row.generationStatus || null,
          jobStatus: row.jobStatus || null
        }
      });
    }

    const updatedAt = resolveUpdatedAt(row);
    if (!updatedAt || !row.createdAt) {
      return createStatusErrorDto({
        code: "INVALID_STATUS_RESPONSE",
        message: "Status response timestamps are invalid.",
        retryable: false
      });
    }

    return createStatusSuccessDto({
      generationId: row.generationId,
      jobId: row.jobId,
      status: apiStatus,
      jobStatus: row.jobStatus,
      progressPercent: row.progressPercent,
      progressStage: row.progressStage,
      estimatedRemainingSeconds: row.estimatedRemainingSeconds,
      provider: row.provider,
      model: row.model,
      imageUrl: row.imageUrl,
      failureCode: row.failureCode,
      failureMessage: row.failureMessage,
      createdAt: row.createdAt,
      updatedAt
    });
  }

  return {
    // deno-lint-ignore no-explicit-any
    getGenerationStatus(input: any) {
      return queryStatus(input);
    },
    // deno-lint-ignore no-explicit-any
    getGenerationProgress(input: any) {
      return queryStatus(input);
    }
  };
}
