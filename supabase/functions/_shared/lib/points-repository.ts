// ESM port of `js/services/wallpaper/points-repository.js`. Logic
// unchanged, INCLUDING the same "Lucky Points reads/writes `users.points`"
// assumption flagged in review/P2-AI-02-review.md Known Limitations.

export function createPointsRepository({
  getUserById,
  deductPoints,
  getActiveGenerationCost
}: {
  // deno-lint-ignore no-explicit-any
  getUserById: (userId: string) => Promise<any>;
  deductPoints: (userId: string, points: number) => Promise<boolean>;
  // deno-lint-ignore no-explicit-any
  getActiveGenerationCost: () => Promise<any>;
}) {
  if (
    typeof getUserById !== "function" ||
    typeof deductPoints !== "function" ||
    typeof getActiveGenerationCost !== "function"
  ) {
    throw new Error(
      "createPointsRepository requires getUserById/deductPoints/getActiveGenerationCost."
    );
  }

  return {
    findUser(userId: string) {
      return getUserById(userId);
    },
    applyPointsDeduction(userId: string, points: number) {
      return deductPoints(userId, points);
    },
    fetchActiveGenerationCost() {
      return getActiveGenerationCost();
    }
  };
}

export function createPointsRepositoryFromSupabaseClient({
  supabaseClient,
  usersTable = "users",
  costConfigTable = "generation_cost_config",
  pointsColumn = "points"
}: {
  // deno-lint-ignore no-explicit-any
  supabaseClient: any;
  usersTable?: string;
  costConfigTable?: string;
  pointsColumn?: string;
}) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return createPointsRepository({
    async getUserById(userId: string) {
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

    async deductPoints(userId: string, points: number) {
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
