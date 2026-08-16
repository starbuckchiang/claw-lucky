"use strict";

/**
 * Account Merge Claim Crypto Helpers (P-AUTH-05A Hotfix)
 *
 * Small, pure utilities shared by the (not-yet-implemented, P-AUTH-05B)
 * Begin/Finalize Edge Functions and by the SECURITY DEFINER SQL functions'
 * callers. Server-side only (Edge Function context) — deliberately has NO
 * `window.X =` browser export (matching the existing Node/Edge-only
 * convention used by e.g. `js/services/wallpaper/points-repository.js`),
 * since the frontend must NEVER compute or see these hashes itself.
 *
 * Gate blocker fix (P-AUTH-05A-fix requirement 1): the target email must be
 * NORMALIZED (trimmed + lower-cased) BEFORE hashing, so
 * "User@Example.com", " user@example.com", and "user@example.com" all
 * produce the SAME `target_email_hash` — otherwise a legitimate user could
 * fail to consume their own claim purely due to incidental
 * casing/whitespace differences between when the claim was created and
 * when it's later verified against the real session's `user.email`.
 *
 * Has a hand-mirrored Deno/Web Crypto twin at
 * supabase/functions/_shared/lib/merge-claim-crypto.ts for the eventual
 * Edge Function (P-AUTH-05B) — same normalization rule, same hash
 * algorithm (SHA-256, hex-encoded), so a hash computed by either runtime
 * for the same input is byte-for-byte identical.
 */

const crypto = require("node:crypto");

function normalizeEmailForHash(email) {
  return String(email ?? "").trim().toLowerCase();
}

function hashClaimValue(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function hashNormalizedEmail(email) {
  return hashClaimValue(normalizeEmailForHash(email));
}

module.exports = {
  normalizeEmailForHash,
  hashClaimValue,
  hashNormalizedEmail
};
