"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWallpaperGenerationStatusController
} = require("../../../api/wallpaper-generation-status-controller");

function createServiceMock({
  statusResult,
  progressResult
}) {
  return {
    async getGenerationStatus() {
      return statusResult;
    },
    async getGenerationProgress() {
      return progressResult;
    }
  };
}

test("GET /api/wallpapers/generations/{id} 回傳 200", async () => {
  const controller = createWallpaperGenerationStatusController({
    generationQueryService: createServiceMock({
      statusResult: {
        ok: true,
        data: {
          generationId: "gen-1"
        }
      },
      progressResult: { ok: true, data: {} }
    })
  });

  const response = await controller.getGeneration({
    params: { id: "gen-1" },
    auth: { userId: "user-1" }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
});

test("GET /api/wallpapers/generations/{id}/progress 回傳 403", async () => {
  const controller = createWallpaperGenerationStatusController({
    generationQueryService: createServiceMock({
      statusResult: { ok: true, data: {} },
      progressResult: {
        ok: false,
        error: {
          code: "UNAUTHORIZED_GENERATION_ACCESS",
          message: "forbidden"
        }
      }
    })
  });

  const response = await controller.getGenerationProgress({
    params: { id: "gen-1" },
    auth: { userId: "user-x" }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error.code, "UNAUTHORIZED_GENERATION_ACCESS");
});
