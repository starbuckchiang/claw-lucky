"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createGenerationRepositoryFromSupabaseClient } = require("../generation-repository");

function createMockSupabaseClient() {
  const inserted = [];

  const client = {
    from(tableName) {
      return {
        insert(payload) {
          inserted.push({ tableName, payload });
          return {
            select() {
              return {
                async single() {
                  return {
                    data: {
                      id: "gen-1",
                      status: payload.status,
                      ai_model: payload.ai_model,
                      created_at: "2026-07-16T00:00:00.000Z",
                      metadata_json: payload.metadata_json
                    },
                    error: null
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  return { client, inserted };
}

test("persists storage_bucket/storage_path and never persists imageUrl/base64 in metadata_json", async () => {
  const { client, inserted } = createMockSupabaseClient();
  const repository = createGenerationRepositoryFromSupabaseClient({ supabaseClient: client });

  const record = await repository.createGenerationRecord({
    userId: "user-1",
    mascotId: "mascot-1",
    giftId: "gift-1",
    wallpaperStyle: "Retro",
    luckyTheme: "Golden Day",
    blessing: "Fortune follows you.",
    promptType: "wallpaper_generation",
    promptVersion: "v1",
    promptSource: "database",
    provider: "gemini",
    model: "gemini-2.5-flash-image",
    providerRequestId: "req-1",
    imageUrl: "https://signed.example/wallpapers/user-1/asset-1/wallpaper.png",
    storageBucket: "wallpapers",
    storagePath: "user-1/asset-1/wallpaper.png",
    mimeType: "image/png",
    fileSize: 12345,
    durationMs: 900,
    status: "succeeded",
    failureCode: null,
    failureMessage: null,
    expiresAt: "2026-08-15T00:00:00.000Z"
  });

  assert.equal(inserted.length, 1);
  const { payload } = inserted[0];

  assert.equal(payload.storage_bucket, "wallpapers");
  assert.equal(payload.storage_path, "user-1/asset-1/wallpaper.png");
  assert.equal(payload.metadata_json.fileSize, 12345);
  assert.equal(payload.metadata_json.mimeType, "image/png");

  // Business rule: no base64 or long-lived signed URL persisted in metadata_json.
  assert.equal(payload.metadata_json.imageUrl, undefined);
  assert.equal(payload.metadata_json.base64, undefined);
  assert.equal(JSON.stringify(payload).toLowerCase().includes("base64"), false);

  // Response returned to the caller (immediate, not persisted) still carries imageUrl.
  assert.equal(record.imageUrl, "https://signed.example/wallpapers/user-1/asset-1/wallpaper.png");
  assert.equal(record.generationId, "gen-1");
});

test("insertGeneration attaches safe diagnostic context (table/operation) to a raw Supabase error", async () => {
  const dbError = new Error("duplicate key value violates unique constraint");
  dbError.code = "23505";

  const client = {
    from(tableName) {
      return {
        insert() {
          return {
            select() {
              return {
                async single() {
                  return { data: null, error: dbError };
                }
              };
            }
          };
        }
      };
    }
  };

  const repository = createGenerationRepositoryFromSupabaseClient({ supabaseClient: client, tableName: "wallpaper_generations" });

  await assert.rejects(
    () => repository.createGenerationRecord({
      userId: "user-1",
      mascotId: "mascot-1",
      giftId: "gift-1",
      wallpaperStyle: "Retro",
      luckyTheme: "Golden Day",
      blessing: "Fortune follows you.",
      status: "succeeded",
      expiresAt: "2026-08-15T00:00:00.000Z"
    }),
    (error) => {
      assert.equal(error.code, "23505");
      assert.equal(error.table, "wallpaper_generations");
      assert.equal(error.operation, "insertGeneration");
      return true;
    }
  );
});
