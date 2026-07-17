// ESM port of `js/services/wallpaper/job-repository.js`. Logic unchanged.

// deno-lint-ignore no-explicit-any
export function createJobRepository({ insertJob, updateJob }: { insertJob: (payload: any) => Promise<any>; updateJob: (jobId: string, patch: any) => Promise<any> }) {
  if (typeof insertJob !== "function") {
    throw new Error("createJobRepository requires insertJob(payload).");
  }

  if (typeof updateJob !== "function") {
    throw new Error("createJobRepository requires updateJob(jobId, patch).");
  }

  return {
    // deno-lint-ignore no-explicit-any
    create(payload: any) {
      return insertJob(payload);
    },
    // deno-lint-ignore no-explicit-any
    update(jobId: string, patch: any) {
      return updateJob(jobId, patch);
    }
  };
}

const JOB_DB_STATUS: Record<string, string> = Object.freeze({
  Pending: "queued",
  Running: "processing",
  Success: "succeeded",
  Failed: "failed"
});

function toDbJobStatus(status: unknown): string {
  return JOB_DB_STATUS[status as string] || String(status || "queued").toLowerCase();
}

// Attaches safe, non-secret diagnostic context (target table + operation
// name) to a raw Supabase/Postgres error before it propagates, without
// altering the error's own fields (message/code/details/hint stay intact).
// deno-lint-ignore no-explicit-any
function withDiagnosticContext(error: any, table: string, operation: string) {
  if (error && typeof error === "object") {
    error.table = table;
    error.operation = operation;
  }
  return error;
}

export function createJobRepositoryFromSupabaseClient({
  supabaseClient,
  tableName = "wallpaper_generation_jobs"
  // deno-lint-ignore no-explicit-any
}: { supabaseClient: any; tableName?: string }) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return createJobRepository({
    // deno-lint-ignore no-explicit-any
    async insertJob(payload: any) {
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

    // deno-lint-ignore no-explicit-any
    async updateJob(jobId: string, patch: any) {
      // deno-lint-ignore no-explicit-any
      const updatePayload: any = {};

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
