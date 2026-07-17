"use strict";

const API_GENERATION_STATUSES = Object.freeze([
  "pending",
  "processing",
  "succeeded",
  "failed",
  "expired"
]);

const TERMINAL_API_STATUSES = new Set([
  "succeeded",
  "failed",
  "expired"
]);

function createStatusErrorDto({
  code,
  message,
  retryable = false,
  details = null
}) {
  return {
    ok: false,
    error: {
      code: String(code),
      message: String(message),
      retryable: Boolean(retryable),
      details: details || null
    }
  };
}

function normalizeProgressPercent(value, status) {
  const numeric = Number(value);

  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }

  if (status === "succeeded") {
    return 100;
  }

  if (status === "failed" || status === "expired") {
    return 100;
  }

  return 0;
}

function normalizeRemainingSeconds(value, terminal) {
  if (terminal) {
    return 0;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Math.round(numeric);
}

function getRecommendedPollIntervalMs(status, isCancelledJob) {
  if (TERMINAL_API_STATUSES.has(status) || isCancelledJob) {
    return 0;
  }

  if (status === "processing") {
    return 1500;
  }

  return 2500;
}

function createStatusSuccessDto(payload) {
  const status = String(payload.status || "").trim();
  const isCancelledJob = String(payload.jobStatus || "").trim() === "cancelled";
  const isTerminal = TERMINAL_API_STATUSES.has(status) || isCancelledJob;

  return {
    ok: true,
    data: {
      generationId: String(payload.generationId),
      jobId: payload.jobId ? String(payload.jobId) : null,
      status,
      progressPercent: normalizeProgressPercent(payload.progressPercent, status),
      progressStage: String(payload.progressStage || "").trim() || null,
      estimatedRemainingSeconds: normalizeRemainingSeconds(payload.estimatedRemainingSeconds, isTerminal),
      provider: payload.provider ? String(payload.provider) : null,
      model: payload.model ? String(payload.model) : null,
      imageUrl: payload.imageUrl ? String(payload.imageUrl) : null,
      failureCode: payload.failureCode ? String(payload.failureCode) : null,
      failureMessage: payload.failureMessage ? String(payload.failureMessage) : null,
      createdAt: String(payload.createdAt),
      updatedAt: String(payload.updatedAt),
      recommendedPollIntervalMs: getRecommendedPollIntervalMs(status, isCancelledJob),
      terminal: isTerminal
    }
  };
}

module.exports = {
  API_GENERATION_STATUSES,
  createStatusSuccessDto,
  createStatusErrorDto
};
