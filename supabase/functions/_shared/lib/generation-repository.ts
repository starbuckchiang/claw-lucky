// ESM port of `js/services/wallpaper/generation-repository.js`. Logic
// unchanged: persists `storage_bucket` / `storage_path` (never base64 / the
// ephemeral signed URL) in `wallpaper_generations`.

// Attaches safe, non-secret diagnostic context (target table + operation
// name) to a raw Supabase/Postgres error before it propagates, without
// altering the error's own fields (message/code/details/hint stay intact).
// Mirrors job-repository.ts's precedent.
// deno-lint-ignore no-explicit-any
function withDiagnosticContext(error: any, table: string, operation: string) {
  if (error && typeof error === "object") {
    error.table = table;
    error.operation = operation;
  }
  return error;
}

// deno-lint-ignore no-explicit-any
export function createGenerationRepository({ insertGeneration }: { insertGeneration: (payload: any) => Promise<any> }) {
  if (typeof insertGeneration !== "function") {
    throw new Error("createGenerationRepository requires insertGeneration(payload).");
  }

  return {
    // deno-lint-ignore no-explicit-any
    async createGenerationRecord(payload: any) {
      return insertGeneration(payload);
    }
  };
}

export function createGenerationRepositoryFromSupabaseClient({
  supabaseClient,
  tableName = "wallpaper_generations"
  // deno-lint-ignore no-explicit-any
}: { supabaseClient: any; tableName?: string }) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return createGenerationRepository({
    // deno-lint-ignore no-explicit-any
    async insertGeneration(payload: any) {
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
