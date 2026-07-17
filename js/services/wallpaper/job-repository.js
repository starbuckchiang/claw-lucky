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

const JOB_DB_STATUS = Object.freeze({
  Pending: "queued",
  Running: "processing",
  Success: "succeeded",
  Failed: "failed"
});

function toDbJobStatus(status) {
  return JOB_DB_STATUS[status] || String(status || "queued").toLowerCase();
}

// Attaches safe, non-secret diagnostic context (target table + operation
// name) to a raw Supabase/Postgres error before it propagates, without
// altering the error's own fields (message/code/details/hint stay intact).
// This lets callers log the REAL underlying database error instead of a
// swallowed/normalized generic failure.
function withDiagnosticContext(error, table, operation) {
  if (error && typeof error === "object") {
    error.table = table;
    error.operation = operation;
  }
  return error;
}

function createJobRepositoryFromSupabaseClient({
  supabaseClient,
  tableName = "wallpaper_generation_jobs"
}) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return createJobRepository({
    async insertJob(payload) {
      const idempotencyKey =
        payload.idempotencyKey || `wallpaper-job-${payload.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const { data, error } = await supabaseClient
        .from(tableName)
        .insert({
          wallpaper_id: payload.wallpaperId || payload.generationId || null,
          user_id: payload.userId,
          status: toDbJobStatus(payload.status),
          idempotency_key: idempotencyKey
        })
        .select("id,status,created_at")
        .single();

      if (error) {
        throw withDiagnosticContext(error, tableName, "insertJob");
      }

      return {
        jobId: data.id,
        id: data.id,
        status: data.status,
        createdAt: data.created_at
      };
    },

    async updateJob(jobId, patch) {
      const updatePayload = {};

      if (patch.status) {
        updatePayload.status = toDbJobStatus(patch.status);
      }
      if (patch.generationId) {
        updatePayload.wallpaper_id = patch.generationId;
      }
      if (patch.failureCode !== undefined) {
        updatePayload.last_error = patch.failureMessage || patch.failureCode || null;
      }

      const { error } = await supabaseClient
        .from(tableName)
        .update(updatePayload)
        .eq("id", jobId);

      if (error) {
        throw withDiagnosticContext(error, tableName, "updateJob");
      }

      return { jobId, ...updatePayload };
    }
  });
}

module.exports = {
  createJobRepository,
  createJobRepositoryFromSupabaseClient
};
