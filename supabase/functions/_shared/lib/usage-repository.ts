// ESM port of `js/services/wallpaper/usage-repository.js`. Logic unchanged.

export function createUsageRepository({
  getUsageByUserAndDate,
  saveUsageByUserAndDate
}: {
  // deno-lint-ignore no-explicit-any
  getUsageByUserAndDate: (userId: string, usageDate: string) => Promise<any>;
  // deno-lint-ignore no-explicit-any
  saveUsageByUserAndDate: (payload: any) => Promise<any>;
}) {
  if (typeof getUsageByUserAndDate !== "function") {
    throw new Error("createUsageRepository requires getUsageByUserAndDate(userId, usageDate).");
  }

  if (typeof saveUsageByUserAndDate !== "function") {
    throw new Error("createUsageRepository requires saveUsageByUserAndDate(payload).");
  }

  return {
    fetchUsage(userId: string, usageDate: string) {
      return getUsageByUserAndDate(userId, usageDate);
    },
    // deno-lint-ignore no-explicit-any
    saveUsage(payload: any) {
      return saveUsageByUserAndDate(payload);
    }
  };
}

export function createUsageRepositoryFromSupabaseClient({
  supabaseClient,
  tableName = "daily_generation_usage"
  // deno-lint-ignore no-explicit-any
}: { supabaseClient: any; tableName?: string }) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return createUsageRepository({
    async getUsageByUserAndDate(userId: string, usageDate: string) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select("user_id,usage_date,success_count")
        .eq("user_id", userId)
        .eq("usage_date", usageDate)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data
        ? {
            userId: data.user_id,
            usageDate: data.usage_date,
            successCount: Number(data.success_count || 0)
          }
        : null;
    },

    // deno-lint-ignore no-explicit-any
    async saveUsageByUserAndDate(payload: any) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .upsert(
          {
            user_id: payload.userId,
            usage_date: payload.usageDate,
            success_count: payload.successCount
          },
          { onConflict: "user_id,usage_date" }
        )
        .select("user_id,usage_date,success_count")
        .single();

      if (error) {
        throw error;
      }

      return {
        userId: data.user_id,
        usageDate: data.usage_date,
        successCount: Number(data.success_count || 0)
      };
    }
  });
}
