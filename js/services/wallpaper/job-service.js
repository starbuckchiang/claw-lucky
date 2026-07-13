"use strict";

const { createGenerationErrorDto } = require("./response-dto");

const JOB_STATUS = Object.freeze({
  PENDING: "Pending",
  RUNNING: "Running",
  SUCCESS: "Success",
  FAILED: "Failed"
});

function createJobService({
  jobRepository,
  now = () => new Date()
}) {
  if (!jobRepository || typeof jobRepository.create !== "function" || typeof jobRepository.update !== "function") {
    throw new Error("createJobService requires jobRepository.create and jobRepository.update.");
  }

  async function createJob(payload) {
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
        details: { reason: error?.message || "unknown" }
      });
    }
  }

  async function markRunning(jobId) {
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
        details: { reason: error?.message || "unknown", jobId }
      });
    }
  }

  async function markSuccess(jobId, patch = {}) {
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
        details: { reason: error?.message || "unknown", jobId }
      });
    }
  }

  async function markFailed(jobId, patch = {}) {
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
        details: { reason: error?.message || "unknown", jobId }
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

module.exports = {
  JOB_STATUS,
  createJobService
};
