"use strict";

/**
 * Gift Repository (Prompt Context Resolver dependency).
 *
 * Reads the `gifts` catalog (name/description). This is the ONLY place the
 * Prompt Context Resolver is allowed to fetch gift data from — the
 * Wallpaper Prompt Builder itself never touches the database.
 */
function createGiftRepository({ findById }) {
  if (typeof findById !== "function") {
    throw new Error("createGiftRepository requires findById(giftId).");
  }

  return {
    findGiftById(giftId) {
      return findById(giftId);
    }
  };
}

function createGiftRepositoryFromSupabaseClient({
  supabaseClient,
  tableName = "gifts"
}) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return createGiftRepository({
    async findById(giftId) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select("id,name,description")
        .eq("id", giftId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return null;
      }

      return {
        id: data.id,
        name: String(data.name || "").trim(),
        description: String(data.description || "").trim()
      };
    }
  });
}

module.exports = {
  createGiftRepository,
  createGiftRepositoryFromSupabaseClient
};
