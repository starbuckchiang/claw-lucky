"use strict";

function createJobRepository({
  insertJob,
  updateJob
}) {
  if (typeof insertJob !== "function") {
    throw new Error("createJobRepository requires insertJob(payload).");
  }

  if (typeof updateJob !== "function") {
    throw new Error("createJobRepository requires updateJob(jobId, patch).");
  }

  return {
    create(payload) {
      return insertJob(payload);
    },
    update(jobId, patch) {
      return updateJob(jobId, patch);
    }
  };
}

module.exports = {
  createJobRepository
};
