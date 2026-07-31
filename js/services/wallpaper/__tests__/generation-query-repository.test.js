"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createGenerationQueryRepositoryFromSupabaseClient } = require("../generation-query-repository");

function createMockSupabaseClient({ generation, job = null, signedUrl = "https://signed.example/file.png", signedUrlError = null }) {
  const signedUrlCalls = [];

  return {
    from(tableName) {
      if (tableName === "wallpaper_generations") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: generation, error: null };
                  }
                };
              }
            };
          }
        };
      }

      if (tableName === "wallpaper_generation_jobs") {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      limit() {
                        return Promise.resolve({ data: job ? [job] : [], error: null });
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }

      throw new Error(`Unexpected table: ${tableName}`);
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path, expirySeconds) {
            signedUrlCalls.push({ bucket, path, expirySeconds });
            if (signedUrlError) return { data: null, error: signedUrlError };
            return { data: { signedUrl }, error: null };
          }
        };
      }
    },
    signedUrlCalls
  };
}

test("generates a fresh signed URL when generation succeeded and storage columns present", async () => {
  const client = createMockSupabaseClient({
    generation: {
      id: "gen-1",
      user_id: "user-1",
      status: "succeeded",
      ai_model: "gemini-2.5-flash-image",
      failure_code: null,
      failure_message: null,
      created_at: "2026-07-16T00:00:00.000Z",
      updated_at: "2026-07-16T00:01:00.000Z",
      metadata_json: { provider: "gemini" },
      storage_bucket: "wallpapers",
      storage_path: "user-1/asset-1/wallpaper.png"
    }
  });

  const repository = createGenerationQueryRepositoryFromSupabaseClient({ supabaseClient: client });
  const row = await repository.getByGenerationId("gen-1");

  assert.equal(row.imageUrl, "https://signed.example/file.png");
  assert.equal(client.signedUrlCalls.length, 1);
  assert.equal(client.signedUrlCalls[0].path, "user-1/asset-1/wallpaper.png");
});

test("does not attempt signed URL generation when not yet succeeded", async () => {
  const client = createMockSupabaseClient({
    generation: {
      id: "gen-1",
      user_id: "user-1",
      status: "processing",
      ai_model: null,
      failure_code: null,
      failure_message: null,
      created_at: "2026-07-16T00:00:00.000Z",
      updated_at: "2026-07-16T00:01:00.000Z",
      metadata_json: {},
      storage_bucket: null,
      storage_path: null
    }
  });

  const repository = createGenerationQueryRepositoryFromSupabaseClient({ supabaseClient: client });
  const row = await repository.getByGenerationId("gen-1");

  assert.equal(row.imageUrl, null);
  assert.equal(client.signedUrlCalls.length, 0);
});

test("signed URL failure degrades to null imageUrl instead of throwing", async () => {
  const client = createMockSupabaseClient({
    generation: {
      id: "gen-1",
      user_id: "user-1",
      status: "succeeded",
      ai_model: "gemini-2.5-flash-image",
      failure_code: null,
      failure_message: null,
      created_at: "2026-07-16T00:00:00.000Z",
      updated_at: "2026-07-16T00:01:00.000Z",
      metadata_json: {},
      storage_bucket: "wallpapers",
      storage_path: "user-1/asset-1/wallpaper.png"
    },
    signedUrlError: { message: "internal storage failure" }
  });

  const repository = createGenerationQueryRepositoryFromSupabaseClient({ supabaseClient: client });
  const row = await repository.getByGenerationId("gen-1");

  assert.equal(row.imageUrl, null);
});

test("P2-AI-04 Lite: extracts the 5 safe Shopkeeper display fields from metadata_json.shopkeeperSnapshot", async () => {
  const client = createMockSupabaseClient({
    generation: {
      id: "gen-1",
      user_id: "user-1",
      status: "succeeded",
      ai_model: "gemini-2.5-flash-image",
      failure_code: null,
      failure_message: null,
      created_at: "2026-07-16T00:00:00.000Z",
      updated_at: "2026-07-16T00:01:00.000Z",
      metadata_json: {
        provider: "gemini",
        shopkeeperVersion: "shopkeeper-context-v1",
        source: "ai",
        shopkeeperSnapshot: {
          luckyTheme: "Golden Day",
          blessing: "Fortune follows you.",
          story: "A tiny lucky story.",
          oneLiner: "Shine on.",
          shopkeeperMessage: "Hi there!",
          version: "shopkeeper-context-v1",
          source: "ai"
        }
      },
      storage_bucket: "wallpapers",
      storage_path: "user-1/asset-1/wallpaper.png"
    }
  });

  const repository = createGenerationQueryRepositoryFromSupabaseClient({ supabaseClient: client });
  const row = await repository.getByGenerationId("gen-1");

  assert.equal(row.luckyTheme, "Golden Day");
  assert.equal(row.blessing, "Fortune follows you.");
  assert.equal(row.story, "A tiny lucky story.");
  assert.equal(row.oneLiner, "Shine on.");
  assert.equal(row.shopkeeperMessage, "Hi there!");
  // Never expose source/version/the raw snapshot object itself on the row.
  assert.equal(row.source, undefined);
  assert.equal(row.shopkeeperVersion, undefined);
  assert.equal(row.shopkeeperSnapshot, undefined);
});

test("missing shopkeeperSnapshot degrades to null fields (never throws)", async () => {
  const client = createMockSupabaseClient({
    generation: {
      id: "gen-1",
      user_id: "user-1",
      status: "succeeded",
      ai_model: "gemini-2.5-flash-image",
      failure_code: null,
      failure_message: null,
      created_at: "2026-07-16T00:00:00.000Z",
      updated_at: "2026-07-16T00:01:00.000Z",
      metadata_json: { provider: "gemini" },
      storage_bucket: "wallpapers",
      storage_path: "user-1/asset-1/wallpaper.png"
    }
  });

  const repository = createGenerationQueryRepositoryFromSupabaseClient({ supabaseClient: client });
  const row = await repository.getByGenerationId("gen-1");

  assert.equal(row.luckyTheme, null);
  assert.equal(row.blessing, null);
  assert.equal(row.story, null);
  assert.equal(row.oneLiner, null);
  assert.equal(row.shopkeeperMessage, null);
});
