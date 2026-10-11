// ESM port of `js/services/wallpaper/membership-quota-repository.js`. Logic unchanged.

// deno-lint-ignore no-explicit-any
export function createWallpaperQuotaRepositoryFromSupabaseClient({ supabaseClient }: { supabaseClient: any }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
    throw new Error("A valid supabaseClient with rpc() is required.");
  }

  return {
    // deno-lint-ignore no-explicit-any
    async reserveQuota({ userId, periodKey, limit, ttlSeconds, trialWindowSeconds }: any) {
      const { data, error } = await supabaseClient.rpc("reserve_wallpaper_quota", {
        p_user_id: userId,
        p_period_key: periodKey,
        p_limit: limit,
        p_ttl_seconds: ttlSeconds,
        p_trial_window_seconds: trialWindowSeconds ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return { allowed: Boolean(row?.allowed), remaining: Number(row?.remaining || 0) };
    },

    // deno-lint-ignore no-explicit-any
    async confirmUsage({ userId, periodKey }: any) {
      const { error } = await supabaseClient.rpc("confirm_wallpaper_quota_usage", {
        p_user_id: userId,
        p_period_key: periodKey,
      });
      if (error) throw error;
    },

    // deno-lint-ignore no-explicit-any
    async releaseReservation({ userId, periodKey }: any) {
      const { error } = await supabaseClient.rpc("release_wallpaper_quota_reservation", {
        p_user_id: userId,
        p_period_key: periodKey,
      });
      if (error) throw error;
    },
  };
}

// deno-lint-ignore no-explicit-any
export function createSubscriptionLookupRepositoryFromSupabaseClient({ supabaseClient }: { supabaseClient: any }) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return {
    async findActiveSubscription(userId: string) {
      const { data, error } = await supabaseClient
        .from("paypal_subscriptions")
        .select("status,paid_through")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
  };
}
