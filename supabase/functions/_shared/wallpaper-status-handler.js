"use strict";

/**
 * Wallpaper Status — Shared Request Handler
 *
 * Same runtime-boundary rationale as `wallpaper-generate-handler.js`: this is
 * plain, dependency-free CommonJS reused from both Node.js (unit tests) and
 * the Deno `wallpaper-status` Edge Function (via `node:module` createRequire).
 *
 * Contains ONLY: request shape handling + HTTP status mapping. All actual
 * query/ownership/status-mapping/polling-interval business rules live in
 * `generation-query-service.js` (ADR-006), unchanged and reused as-is.
 */

const { createGenerationQueryService } = require("../../../js/services/wallpaper/generation-query-service.js");
const { createGenerationQueryRepositoryFromSupabaseClient } = require("../../../js/services/wallpaper/generation-query-repository.js");

const ERROR_HTTP_STATUS = Object.freeze({
  UNAUTHORIZED: 401,
  INVALID_GENERATION_ID: 400,
  GENERATION_NOT_FOUND: 404,
  UNAUTHORIZED_GENERATION_ACCESS: 403,
  QUERY_FAILURE: 503,
  INVALID_STATUS_RESPONSE: 500
});

function toHttpStatus(code) {
  return ERROR_HTTP_STATUS[code] || 500;
}

/**
 * @param {object} params
 * @param {object} params.supabaseClient - service-role Supabase client (read + signed URL generation)
 */
function buildQueryService({ supabaseClient }) {
  return createGenerationQueryService({
    generationQueryRepository: createGenerationQueryRepositoryFromSupabaseClient({ supabaseClient })
  });
}

/**
 * @param {object} params
 * @param {string} params.generationId
 * @param {string|null} params.userId - authenticated user id (from verified JWT). NEVER from query string.
 * @param {string} params.correlationId
 * @param {object} params.deps - either `{ queryService }` (tests) or `{ supabaseClient }` (real wiring).
 */
async function handleStatusRequest({ generationId, userId, correlationId, deps = {} }) {
  if (!userId) {
    return {
      statusCode: 401,
      correlationId,
      body: {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required.", retryable: false, details: null }
      }
    };
  }

  const queryService = deps.queryService || buildQueryService(deps);

  const result = await queryService.getGenerationProgress({
    generationId,
    requesterUserId: userId
  });

  return {
    statusCode: result.ok ? 200 : toHttpStatus(result.error.code),
    correlationId,
    body: result
  };
}

module.exports = {
  handleStatusRequest,
  buildQueryService,
  toHttpStatus,
  ERROR_HTTP_STATUS
};
