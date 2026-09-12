// Canonical Policy Versions (WEB-HOME-01A) — Deno ESM twin of
// js/services/auth/policy-versions.js. Keep both files in sync; the
// Node.js CJS original is the tested source of truth.
//
// The consent write API reads versions/hashes from HERE — never from the
// request body — so the SERVER decides what the user consented to.
// Hashes are sha256 (hex) of the canonical policy documents under
// docs/policies/ with CRLF normalized to LF.

export const CURRENT_TERMS_VERSION = "2026-09-15";
export const CURRENT_PRIVACY_VERSION = "2026-09-15";

export const TERMS_CONTENT_SHA256 =
  "e47b3fe0d205132087b862d28bdee9cf967b2108547f4319ead4b91a6e55329f";
export const PRIVACY_CONTENT_SHA256 =
  "dc04b9fd032869a7b5daa03b09427e841e8992e346b0178a703fd9bc4766ce02";

export function canonicalizePolicyText(text: string): string {
  return String(text).replace(/\r\n/g, "\n");
}
