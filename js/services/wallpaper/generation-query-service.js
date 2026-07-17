"use strict";

const {
  API_GENERATION_STATUSES,
  createStatusSuccessDto,
  createStatusErrorDto
} = require("./progress-response-dto");

const DB_GENERATION_STATUS = new Set([
  "pending",
  "processing",
  "succeeded",
  "failed",
  "expired"
]);

const DB_JOB_STATUS_TO_API = Object.freeze({
  queued: "pending",
  processing: "processing",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "failed"
});

function normalizeGenerationStatus(generationStatus, jobStatus) {
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

function isValidGenerationId(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveUpdatedAt(row) {
  return row.jobUpdatedAt || row.updatedAt || row.createdAt;
}

function createGenerationQueryService({
  generationQueryRepository
}) {
  if (!generationQueryRepository || typeof generationQueryRepository.getByGenerationId !== "function") {
    throw new Error("createGenerationQueryService requires generationQueryRepository.getByGenerationId(generationId).");
  }

  async function queryStatus({ generationId, requesterUserId }) {
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

    let row;
    try {
      row = await generationQueryRepository.getByGenerationId(normalizedGenerationId);
    } catch (error) {
      return createStatusErrorDto({
        code: "QUERY_FAILURE",
        message: "Failed to query generation status.",
        retryable: true,
        details: { reason: error?.message || "unknown" }
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
    getGenerationStatus(input) {
      return queryStatus(input);
    },
    getGenerationProgress(input) {
      return queryStatus(input);
    }
  };
}

module.exports = {
  createGenerationQueryService
};
