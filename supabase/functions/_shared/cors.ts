// Shared CORS helper for Supabase Edge Functions (Deno runtime).
// Kept intentionally tiny: CORS handling is not a Business Rule.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-correlation-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  return null;
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
  correlationId?: string | null,
): Response {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Content-Type": "application/json",
  };

  if (correlationId) {
    headers["X-Correlation-Id"] = correlationId;
  }

  return new Response(JSON.stringify(body), { status: statusCode, headers });
}
