"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createGiftRepositoryFromSupabaseClient } = require("../gift-repository");

function createMockSupabaseClient({ data = null, error = null } = {}) {
  return {
    from(tableName) {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data, error };
                }
              };
            }
          };
        }
      };
    }
  };
}

test("maps a gifts catalog row into { name, description }", async () => {
  const client = createMockSupabaseClient({
    data: { id: "gift-1", name: "Lucky Charm", description: "A small guardian charm." }
  });
  const repository = createGiftRepositoryFromSupabaseClient({ supabaseClient: client });

  const gift = await repository.findGiftById("gift-1");

  assert.equal(gift.name, "Lucky Charm");
  assert.equal(gift.description, "A small guardian charm.");
});

test("returns null when the gift does not exist", async () => {
  const client = createMockSupabaseClient({ data: null });
  const repository = createGiftRepositoryFromSupabaseClient({ supabaseClient: client });

  const gift = await repository.findGiftById("does-not-exist");

  assert.equal(gift, null);
});

test("propagates a raw Supabase error unchanged", async () => {
  const dbError = new Error("connection failed");
  const client = createMockSupabaseClient({ error: dbError });
  const repository = createGiftRepositoryFromSupabaseClient({ supabaseClient: client });

  await assert.rejects(() => repository.findGiftById("gift-1"), (error) => error === dbError);
});
