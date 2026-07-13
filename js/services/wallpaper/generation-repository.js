"use strict";

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
        storage_bucket: null,
        storage_path: null,
        retry_count: 0,
        failure_code: payload.failureCode || null,
        failure_message: payload.failureMessage || null,
        metadata_json: {
          promptType: payload.promptType,
          promptVersion: payload.promptVersion,
          promptSource: payload.promptSource,
          provider: payload.provider,
          providerRequestId: payload.providerRequestId,
          imageUrl: payload.imageUrl || null,
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
        throw error;
      }

      return {
        generationId: data.id,
        status: data.status,
        provider: payload.provider,
        model: data.ai_model,
        imageUrl: payload.imageUrl || data?.metadata_json?.imageUrl || null,
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
