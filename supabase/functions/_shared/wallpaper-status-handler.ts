// Wallpaper Status — Shared Request Handler (Deno ESM port).
//
// ESM twin of `wallpaper-status-handler.js` (Node.js-testable CommonJS
// source of truth). Logic identical; only module syntax differs. All
// ownership/status-mapping/polling-interval rules live in
// `lib/generation-query-service.ts` (ADR-006), unchanged.

import { createGenerationQueryService } from "./lib/generation-query-service.ts";
import { createGenerationQueryRepositoryFromSupabaseClient } from "./lib/generation-query-repository.ts";

export const ERROR_HTTP_STATUS: Record<string, number> = Object.freeze({
  UNAUTHORIZED: 401,
  INVALID_GENERATION_ID: 400,
  GENERATION_NOT_FOUND: 404,
  UNAUTHORIZED_GENERATION_ACCESS: 403,
  QUERY_FAILURE: 503,
  INVALID_STATUS_RESPONSE: 500
});

export function toHttpStatus(code: string): number {
  return ERROR_HTTP_STATUS[code] || 500;
}

// deno-lint-ignore no-explicit-any
export function buildQueryService({ supabaseClient }: { supabaseClient: any }) {
  return createGenerationQueryService({
    generationQueryRepository: createGenerationQueryRepositoryFromSupabaseClient({ supabaseClient })
  });
}

export interface StatusHandlerResult {
  statusCode: number;
  correlationId: string;
  // deno-lint-ignore no-explicit-any
  body: any;
}

export async function handleStatusRequest({
  generationId,
  userId,
  correlationId,
  deps = {}
}: {
  generationId: string;
  userId: string | null;
  correlationId: string;
  // deno-lint-ignore no-explicit-any
  deps?: any;
}): Promise<StatusHandlerResult> {
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
