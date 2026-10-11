"use strict";

/**
 * PROD-RELEASE-DAY3C: Supabase-backed repositories for membership-quota-service.js.
 */

function createWallpaperQuotaRepositoryFromSupabaseClient({ supabaseClient }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
    throw new Error("A valid supabaseClient with rpc() is required.");
  }

  return {
    async reserveQuota({ userId, periodKey, limit, ttlSeconds, trialWindowSeconds }) {
      const { data, error } = await supabaseClient.rpc("reserve_wallpaper_quota", {
        p_user_id: userId,
        p_period_key: periodKey,
        p_limit: limit,
        p_ttl_seconds: ttlSeconds,
        p_trial_window_seconds: trialWindowSeconds ?? null
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return { allowed: Boolean(row?.allowed), remaining: Number(row?.remaining || 0) };
    },

    async confirmUsage({ userId, periodKey }) {
      const { error } = await supabaseClient.rpc("confirm_wallpaper_quota_usage", {
        p_user_id: userId,
        p_period_key: periodKey
      });
      if (error) throw error;
    },

    async releaseReservation({ userId, periodKey }) {
      const { error } = await supabaseClient.rpc("release_wallpaper_quota_reservation", {
        p_user_id: userId,
        p_period_key: periodKey
      });
      if (error) throw error;
    }
  };
}

function createSubscriptionLookupRepositoryFromSupabaseClient({ supabaseClient }) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return {
    async findActiveSubscription(userId) {
      const { data, error } = await supabaseClient
        .from("paypal_subscriptions")
        .select("status,paid_through")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    }
  };
}

module.exports = {
  createWallpaperQuotaRepositoryFromSupabaseClient,
  createSubscriptionLookupRepositoryFromSupabaseClient
};
