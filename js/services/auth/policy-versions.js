"use strict";

/**
 * Canonical Policy Versions (WEB-HOME-01A)
 *
 * SINGLE SOURCE OF TRUTH for the currently-effective Terms of Service /
 * Privacy Policy version identifiers and their canonical content hashes.
 * The consent write API (consent-ops) reads versions/hashes from HERE —
 * never from the request body — so the SERVER decides what the user
 * consented to (WEB-HOME-01A requirement 5).
 *
 * The hashes are sha256 (hex) of the canonical policy documents:
 *   docs/policies/claw-lucky-terms-v2026-09-15.md
 *   docs/policies/claw-lucky-privacy-v2026-09-15.md
 * canonicalized by normalizing CRLF -> LF (see computePolicyContentHash).
 * A unit test recomputes both hashes from those files and fails if either
 * constant drifts from the canonical content — reproducibility guarantee.
 *
 * Deno ESM twin: supabase/functions/_shared/lib/policy-versions.ts —
 * mirror any change there.
 */

const CURRENT_TERMS_VERSION = "2026-09-15";
const CURRENT_PRIVACY_VERSION = "2026-09-15";

const TERMS_CONTENT_SHA256 =
  "e47b3fe0d205132087b862d28bdee9cf967b2108547f4319ead4b91a6e55329f";
const PRIVACY_CONTENT_SHA256 =
  "dc04b9fd032869a7b5daa03b09427e841e8992e346b0178a703fd9bc4766ce02";

// Canonicalization is deliberately minimal and deterministic: only line
// endings are normalized so the hash is identical regardless of the
// checkout's CRLF/LF settings. Content edits always change the hash.
function canonicalizePolicyText(text) {
  return String(text).replace(/\r\n/g, "\n");
}

const policyVersionsApi = {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  TERMS_CONTENT_SHA256,
  PRIVACY_CONTENT_SHA256,
  canonicalizePolicyText
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = policyVersionsApi;
}

if (typeof window !== "undefined") {
  window.PolicyVersions = policyVersionsApi;
}
