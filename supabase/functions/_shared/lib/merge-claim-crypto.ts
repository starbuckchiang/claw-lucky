// Account Merge Claim Crypto Helpers (P-AUTH-05A Hotfix)
//
// Deno/Web Crypto twin of js/services/auth/merge-claim-crypto.js — used by
// the (not-yet-implemented, P-AUTH-05B) Begin/Finalize Edge Functions.
// Same normalization rule (trim + lower-case BEFORE hashing) and same hash
// algorithm (SHA-256, hex-encoded) as the Node twin, so a hash computed by
// either runtime for the same input is byte-for-byte identical. Web
// Crypto's `subtle.digest` is async, unlike Node's `crypto.createHash`
// (sync) — the only runtime-forced divergence between the two twins.

export function normalizeEmailForHash(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

export async function hashClaimValue(value: string | null | undefined): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(value ?? ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashNormalizedEmail(email: string | null | undefined): Promise<string> {
  return hashClaimValue(normalizeEmailForHash(email));
}
