// ESM port of `js/services/wallpaper/mascot-repository.js`. Logic unchanged.

export interface MascotDto {
  id: string;
  species: string;
  title: string;
  appearance: string;
  colors: string | null;
}

export function createMascotRepository({
  findById
}: {
  findById: (mascotId: string) => Promise<MascotDto | null>;
}) {
  if (typeof findById !== "function") {
    throw new Error("createMascotRepository requires findById(mascotId).");
  }

  return {
    findMascotById(mascotId: string) {
      return findById(mascotId);
    }
  };
}

export function createMascotRepositoryFromSupabaseClient({
  supabaseClient,
  tableName = "mascots"
  // deno-lint-ignore no-explicit-any
}: { supabaseClient: any; tableName?: string }) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return createMascotRepository({
    async findById(mascotId: string) {
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
        colors: null
      };
    }
  });
}
