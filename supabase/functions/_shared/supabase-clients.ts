// Deno-native Supabase client construction for Edge Functions.
//
// Two distinct clients by design (Security Review requirement):
// - `anonClient`: used ONLY to verify the caller's JWT via `auth.getUser(jwt)`.
//   Never used for persistence.
// - `serviceClient`: SERVICE_ROLE_KEY based client used for all persistence
//   (generation/job/usage/points repositories) and Storage upload/signed URL
//   generation. Never exposed to the browser.

import { createClient } from "npm:@supabase/supabase-js@2";

export function createAnonClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY secrets are not configured.");
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY secrets are not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Extracts the bearer token from the Authorization header and resolves the
 * authenticated user id via the anon client (never trusts a client-supplied
 * userId). Returns `null` if the token is missing or invalid.
 */
export async function resolveAuthenticatedUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return null;
  }

  try {
    const anonClient = createAnonClient();
    const { data, error } = await anonClient.auth.getUser(token);

    if (error || !data?.user?.id) {
      return null;
    }

    return String(data.user.id);
  } catch (_error) {
    return null;
  }
}
