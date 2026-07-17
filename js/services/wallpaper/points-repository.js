"use strict";

function createPointsRepository({
  getUserById,
  deductPoints,
  getActiveGenerationCost
}) {
  if (typeof getUserById !== "function") {
    throw new Error("createPointsRepository requires getUserById(userId).");
  }

  if (typeof deductPoints !== "function") {
    throw new Error("createPointsRepository requires deductPoints(userId, points).");
  }

  if (typeof getActiveGenerationCost !== "function") {
    throw new Error("createPointsRepository requires getActiveGenerationCost().");
  }

  return {
    findUser(userId) {
      return getUserById(userId);
    },
    applyPointsDeduction(userId, points) {
      return deductPoints(userId, points);
    },
    fetchActiveGenerationCost() {
      return getActiveGenerationCost();
    }
  };
}

/**
 * Supabase-backed points repository.
 *
 * ASSUMPTION (flagged in review/P2-AI-02-review.md Known Limitations):
 * "Lucky Points" (spec FR-015/FR-016) are read from `public.users.points`,
 * which is distinct from the arcade `coins` column used elsewhere in the
 * product (js/api.js). This mapping should be confirmed with product/backend
 * owners before this repository is wired into a production Edge Function.
 */
function createPointsRepositoryFromSupabaseClient({
  supabaseClient,
  usersTable = "users",
  costConfigTable = "generation_cost_config",
  pointsColumn = "points"
}) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return createPointsRepository({
    async getUserById(userId) {
      const { data, error } = await supabaseClient
        .from(usersTable)
        .select(`user_id,${pointsColumn}`)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return null;
      }

      return {
        userId: data.user_id,
        points: Number(data[pointsColumn] || 0)
      };
    },

    async deductPoints(userId, points) {
      const { data: current, error: fetchError } = await supabaseClient
        .from(usersTable)
        .select(`user_id,${pointsColumn}`)
        .eq("user_id", userId)
        .maybeSingle();

      if (fetchError) {
        throw fetchError;
      }

      const currentPoints = Number(current?.[pointsColumn] || 0);
      const cost = Number(points || 0);

      if (currentPoints < cost) {
        return false;
      }

      const { error: updateError } = await supabaseClient
        .from(usersTable)
        .update({ [pointsColumn]: currentPoints - cost })
        .eq("user_id", userId);

      if (updateError) {
        throw updateError;
      }

      return true;
    },

    async getActiveGenerationCost() {
      const { data, error } = await supabaseClient
        .from(costConfigTable)
        .select("cost_points")
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        return null;
      }

      return data ? { costPoints: Number(data.cost_points) } : null;
    }
  });
}

module.exports = {
  createPointsRepository,
  createPointsRepositoryFromSupabaseClient
};
