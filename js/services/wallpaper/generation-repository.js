"use strict";

// Attaches safe, non-secret diagnostic context (target table + operation
// name) to a raw Supabase/Postgres error before it propagates, without
// altering the error's own fields (message/code/details/hint stay intact).
// This lets callers log the REAL underlying database error instead of a
// swallowed/normalized generic failure. Mirrors job-repository.js's
// precedent (see JOB_CREATION_FAILURE diagnostics fix).
function withDiagnosticContext(error, table, operation) {
  if (error && typeof error === "object") {
    error.table = table;
    error.operation = operation;
  }
  return error;
}

function createGenerationRepository({ insertGeneration }) {
  if (typeof insertGeneration !== "function") {
    throw new Error("createGenerationRepository requires insertGeneration(payload).");
  }

  return {
    async createGenerationRecord(payload) {
      return insertGeneration(payload);
    }
  };
}

function createGenerationRepositoryFromSupabaseClient({
  supabaseClient,
  tableName = "wallpaper_generations"
}) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return createGenerationRepository({
    async insertGeneration(payload) {
      const insertPayload = {
        user_id: payload.userId,
        mascot_id: payload.mascotId,
        gift_id: payload.giftId,
        lucky_theme: payload.luckyTheme,
        blessing: payload.blessing,
        wallpaper_style: payload.wallpaperStyle,
        ai_model: payload.model || "unknown",
        status: payload.status,
        prompt_version: null,
        generation_seed: payload.generationSeed || null,
        storage_bucket: payload.storageBucket || null,
        storage_path: payload.storagePath || null,
        retry_count: 0,
        failure_code: payload.failureCode || null,
        failure_message: payload.failureMessage || null,
        metadata_json: {
          promptType: payload.promptType,
          promptVersion: payload.promptVersion,
          promptSource: payload.promptSource,
          provider: payload.provider,
          providerRequestId: payload.providerRequestId,
          mimeType: payload.mimeType || null,
          fileSize: Number.isFinite(Number(payload.fileSize)) ? Number(payload.fileSize) : null,
          durationMs: Number.isFinite(Number(payload.durationMs)) ? Number(payload.durationMs) : 0
        },
        expires_at: payload.expiresAt
      };

      const { data, error } = await supabaseClient
        .from(tableName)
        .insert(insertPayload)
        .select("id,status,ai_model,created_at,metadata_json")
        .single();

      if (error) {
        throw withDiagnosticContext(error, tableName, "insertGeneration");
      }

      return {
        generationId: data.id,
        status: data.status,
        provider: payload.provider,
        model: data.ai_model,
        imageUrl: payload.imageUrl || null,
        promptVersion: payload.promptVersion,
        durationMs:
          Number.isFinite(Number(payload.durationMs))
            ? Number(payload.durationMs)
            : Number(data?.metadata_json?.durationMs || 0),
        createdAt: data.created_at
      };
    }
  });
}

module.exports = {
  createGenerationRepository,
  createGenerationRepositoryFromSupabaseClient
};
