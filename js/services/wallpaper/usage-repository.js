"use strict";

function createUsageRepository({
  getUsageByUserAndDate,
  saveUsageByUserAndDate
}) {
  if (typeof getUsageByUserAndDate !== "function") {
    throw new Error("createUsageRepository requires getUsageByUserAndDate(userId, usageDate).");
  }

  if (typeof saveUsageByUserAndDate !== "function") {
    throw new Error("createUsageRepository requires saveUsageByUserAndDate(payload).");
  }

  return {
    fetchUsage(userId, usageDate) {
      return getUsageByUserAndDate(userId, usageDate);
    },
    saveUsage(payload) {
      return saveUsageByUserAndDate(payload);
    }
  };
}

function createUsageRepositoryFromSupabaseClient({
  supabaseClient,
  tableName = "daily_generation_usage"
}) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return createUsageRepository({
    async getUsageByUserAndDate(userId, usageDate) {
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

    async saveUsageByUserAndDate(payload) {
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

module.exports = {
  createUsageRepository,
  createUsageRepositoryFromSupabaseClient
};
