// ESM port of `js/services/wallpaper/gift-repository.js`. Logic unchanged.

export interface GiftDto {
  id: string;
  name: string;
  description: string;
}

export function createGiftRepository({
  findById
}: {
  findById: (giftId: string) => Promise<GiftDto | null>;
}) {
  if (typeof findById !== "function") {
    throw new Error("createGiftRepository requires findById(giftId).");
  }

  return {
    findGiftById(giftId: string) {
      return findById(giftId);
    }
  };
}

export function createGiftRepositoryFromSupabaseClient({
  supabaseClient,
  tableName = "gifts"
  // deno-lint-ignore no-explicit-any
}: { supabaseClient: any; tableName?: string }) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return createGiftRepository({
    async findById(giftId: string) {
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
