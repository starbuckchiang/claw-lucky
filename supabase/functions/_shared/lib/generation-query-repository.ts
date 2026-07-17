// ESM port of `js/services/wallpaper/generation-query-repository.js`. Logic
// unchanged: generates a fresh signed URL from `storage_bucket` /
// `storage_path` at query time (only when `status === 'succeeded'`).

// deno-lint-ignore no-explicit-any
export function createGenerationQueryRepository({ fetchGenerationWithJob }: { fetchGenerationWithJob: (generationId: string) => Promise<any> }) {
  if (typeof fetchGenerationWithJob !== "function") {
    throw new Error("createGenerationQueryRepository requires fetchGenerationWithJob(generationId).");
  }

  return {
    getByGenerationId(generationId: string) {
      return fetchGenerationWithJob(generationId);
    }
  };
}

export function createGenerationQueryRepositoryFromSupabaseClient({
  supabaseClient,
  generationTable = "wallpaper_generations",
  jobTable = "wallpaper_generation_jobs",
  signedUrlExpirySeconds = 3600
}: {
  // deno-lint-ignore no-explicit-any
  supabaseClient: any;
  generationTable?: string;
  jobTable?: string;
  signedUrlExpirySeconds?: number;
}) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  // deno-lint-ignore no-explicit-any
  async function resolveImageUrl(generation: any): Promise<string | null> {
    if (generation.status !== "succeeded" || !generation.storage_bucket || !generation.storage_path) {
      return null;
    }

    if (!supabaseClient.storage || typeof supabaseClient.storage.from !== "function") {
      return null;
    }

    try {
      const { data, error } = await supabaseClient.storage
        .from(generation.storage_bucket)
        .createSignedUrl(generation.storage_path, signedUrlExpirySeconds);

      if (error) {
        return null;
      }

      return data?.signedUrl || null;
    } catch (_error) {
      return null;
    }
  }

  return createGenerationQueryRepository({
    async fetchGenerationWithJob(generationId: string) {
      const { data: generation, error: generationError } = await supabaseClient
        .from(generationTable)
        .select("id,user_id,status,ai_model,failure_code,failure_message,created_at,updated_at,metadata_json,storage_bucket,storage_path")
        .eq("id", generationId)
        .maybeSingle();

      if (generationError) {
        throw generationError;
      }

      if (!generation) {
        return null;
      }

      const { data: jobRows, error: jobError } = await supabaseClient
        .from(jobTable)
        .select("id,status,progress_percent,progress_stage,estimated_remaining_seconds,updated_at,created_at")
        .eq("wallpaper_id", generationId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (jobError) {
        throw jobError;
      }

      const job = Array.isArray(jobRows) && jobRows.length ? jobRows[0] : null;
      const metadata = generation.metadata_json && typeof generation.metadata_json === "object"
        ? generation.metadata_json
        : {};

      const imageUrl = await resolveImageUrl(generation);

      return {
        generationId: generation.id,
        userId: generation.user_id,
        generationStatus: generation.status,
        provider: metadata.provider || null,
        model: generation.ai_model || null,
        imageUrl,
        failureCode: generation.failure_code || null,
        failureMessage: generation.failure_message || null,
        createdAt: generation.created_at,
        updatedAt: generation.updated_at,
        jobId: job?.id || null,
        jobStatus: job?.status || null,
        progressPercent: job?.progress_percent ?? null,
        progressStage: job?.progress_stage || null,
        estimatedRemainingSeconds: job?.estimated_remaining_seconds ?? null,
        jobUpdatedAt: job?.updated_at || null
      };
    }
  });
}
