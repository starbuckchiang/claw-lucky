"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  loadCollection,
  loadGifts,
  createSelectionState,
  selectMascot,
  selectGift,
  buildPreview,
  submitGenerationSelection
} = require("../wallpaper-selection-service");

test("Collection Success", async () => {
  const result = await loadCollection({
    api: {
      async getUserMascots() {
        return [{ mascot_id: "m1", mascot_name: "Alpaca", rarity: "SSR", image: "a.png" }];
      }
    },
    userId: "user-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].id, "m1");
});

test("Collection Empty", async () => {
  const result = await loadCollection({
    api: {
      async getUserMascots() {
        return [];
      }
    },
    userId: "user-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 0);
});

test("Gift Success", async () => {
  const result = await loadGifts({
    api: {
      async getGiftList() {
        return [{ id: "g1", name: "Lucky Bell", image: "g.png" }];
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].id, "g1");
});

test("Gift Empty", async () => {
  const result = await loadGifts({
    api: {
      async getGiftList() {
        return [];
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 0);
});

test("Selection", () => {
  const state = createSelectionState();
  selectMascot(state, "m2");
  selectGift(state, "g2");
  assert.equal(state.mascotId, "m2");
  assert.equal(state.giftId, "g2");
});

test("Preview", () => {
  const state = createSelectionState();
  selectMascot(state, "m1");
  selectGift(state, "g1");
  const preview = buildPreview({
    state,
    collection: [{ id: "m1", name: "Alpaca" }],
    gifts: [{ id: "g1", name: "Lucky Bell" }]
  });

  assert.equal(preview.mascot.name, "Alpaca");
  assert.equal(preview.gift.name, "Lucky Bell");
});

test("Generation Submit", async () => {
  const result = await submitGenerationSelection({
    generationClient: {
      async submitAndPoll() {
        return {
          ok: true,
          data: {
            generationId: "gen-1",
            imageUrl: "https://example.com/image.png",
            provider: "mock-provider",
            promptVersion: "v1"
          }
        };
      }
    },
    request: {
      mascotId: "m1",
      giftId: "g1"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.generationId, "gen-1");
});
