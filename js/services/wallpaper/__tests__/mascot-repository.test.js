"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMascotRepositoryFromSupabaseClient } = require("../mascot-repository");

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

test("maps a mascots catalog row into { species, title, appearance }", async () => {
  const client = createMockSupabaseClient({
    data: { id: "mascot-1", name: "Penguin", title: "Lucky Penguin", description: "A small round penguin with a red scarf." }
  });
  const repository = createMascotRepositoryFromSupabaseClient({ supabaseClient: client });

  const mascot = await repository.findMascotById("mascot-1");

  assert.equal(mascot.species, "Penguin");
  assert.equal(mascot.title, "Lucky Penguin");
  assert.equal(mascot.appearance, "A small round penguin with a red scarf.");
  // No dedicated "colors" column exists in the current schema — never fabricated.
  assert.equal(mascot.colors, null);
});

test("returns null when the mascot does not exist (never fabricates data)", async () => {
  const client = createMockSupabaseClient({ data: null });
  const repository = createMascotRepositoryFromSupabaseClient({ supabaseClient: client });

  const mascot = await repository.findMascotById("does-not-exist");

  assert.equal(mascot, null);
});

test("propagates a raw Supabase error unchanged", async () => {
  const dbError = new Error("connection failed");
  const client = createMockSupabaseClient({ error: dbError });
  const repository = createMascotRepositoryFromSupabaseClient({ supabaseClient: client });

  await assert.rejects(() => repository.findMascotById("mascot-1"), (error) => error === dbError);
});
