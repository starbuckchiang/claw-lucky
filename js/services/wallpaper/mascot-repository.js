"use strict";

/**
 * Mascot Repository (Prompt Context Resolver dependency).
 *
 * Reads the master `mascots` catalog (species/title/appearance description),
 * NOT the `user_mascots` collection join table. This is the ONLY place the
 * Prompt Context Resolver is allowed to fetch mascot identity data from —
 * the Wallpaper Prompt Builder itself never touches the database (see
 * wallpaper-prompt-builder.js).
 *
 * The `mascots` table (pre-existing, shared with the shop/gacha feature)
 * does not have dedicated "appearance"/"colors" columns; `description` is
 * used as the appearance/character description text. `colors` is left
 * optional/null rather than fabricated, since no such structured column
 * exists today (flagged as a known limitation in the P2-AI-02 review).
 */
function createMascotRepository({ findById }) {
  if (typeof findById !== "function") {
    throw new Error("createMascotRepository requires findById(mascotId).");
  }

  return {
    findMascotById(mascotId) {
      return findById(mascotId);
    }
  };
}

function createMascotRepositoryFromSupabaseClient({
  supabaseClient,
  tableName = "mascots"
}) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return createMascotRepository({
    async findById(mascotId) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select("id,name,title,description")
        .eq("id", mascotId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return null;
      }

      return {
        id: data.id,
        species: String(data.name || "").trim(),
        title: String(data.title || "").trim(),
        appearance: String(data.description || "").trim(),
        // No dedicated colors column in the current schema — never fabricated.
        colors: null
      };
    }
  });
}

module.exports = {
  createMascotRepository,
  createMascotRepositoryFromSupabaseClient
};
