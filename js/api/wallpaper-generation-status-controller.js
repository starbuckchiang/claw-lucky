"use strict";

const ERROR_HTTP_STATUS = Object.freeze({
  INVALID_GENERATION_ID: 400,
  GENERATION_NOT_FOUND: 404,
  UNAUTHORIZED_GENERATION_ACCESS: 403,
  QUERY_FAILURE: 503,
  INVALID_STATUS_RESPONSE: 500
});

function extractGenerationId(request) {
  return request?.params?.id || request?.pathParams?.id || null;
}

function extractRequesterUserId(request) {
  return request?.auth?.userId || request?.auth?.sub || null;
}

function toHttpResponse(result) {
  if (result?.ok) {
    return {
      statusCode: 200,
      body: result
    };
  }

  const code = result?.error?.code || "INVALID_STATUS_RESPONSE";
  return {
    statusCode: ERROR_HTTP_STATUS[code] || 500,
    body: result
  };
}

function createWallpaperGenerationStatusController({
  generationQueryService
}) {
  if (!generationQueryService) {
    throw new Error("createWallpaperGenerationStatusController requires generationQueryService.");
  }

  return {
    async getGeneration(request) {
      const result = await generationQueryService.getGenerationStatus({
        generationId: extractGenerationId(request),
        requesterUserId: extractRequesterUserId(request)
      });

      return toHttpResponse(result);
    },

    async getGenerationProgress(request) {
      const result = await generationQueryService.getGenerationProgress({
        generationId: extractGenerationId(request),
        requesterUserId: extractRequesterUserId(request)
      });

      return toHttpResponse(result);
    }
  };
}

module.exports = {
  createWallpaperGenerationStatusController
};
