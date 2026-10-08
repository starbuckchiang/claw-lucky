"use strict";

/**
 * Terms Consent Service (WEB-HOME-01)
 *
 * The formal-member upgrade entry (subscription.html's Email OTP panel,
 * driven by js/pages/subscription-entry.js) must not start an upgrade or
 * existing-account-login OTP flow until the user actively checks an
 * UNCHECKED "I have read and agree to the Terms of Service and Privacy
 * Policy" checkbox. This module is the single source of truth for the
 * current terms/privacy document versions and for building/persisting the
 * consent record ({ termsVersion, privacyVersion, acceptedAt, userId }).
 *
 * The digital-content immediate-delivery waiver (7-day rescission opt-out)
 * is intentionally feature-flagged OFF until legal review completes —
 * see ENABLE_DIGITAL_CONTENT_WAIVER.
 *
 * Dual-export pattern (Node CJS for tests + window for browser <script>),
 * same as js/services/auth/account-merge-service.js.
 */

// Versions match the unified policy version (WEB-HOME-01A) — kept in sync
// with js/services/auth/policy-versions.js (asserted by a unit test).
const CURRENT_TERMS_VERSION = "2026-09-15";
const CURRENT_PRIVACY_VERSION = "2026-09-15";

// localStorage key for the persisted consent record. WEB-HOME-01A: this
// local record is a NON-AUTHORITATIVE trace only — the authoritative
// consent record is written server-side via consent-ops BEFORE the OTP /
// checkout flow is allowed to proceed; localStorage alone never counts
// as consent.
const TERMS_CONSENT_STORAGE_KEY = "clawLuckyTermsConsent";

// Feature flag: the SECOND, independent, unchecked consent checkbox for
// "digital content delivered immediately, 7-day rescission may not apply".
// Must stay false until the company/legal confirms the wording.
const ENABLE_DIGITAL_CONTENT_WAIVER = false;

function buildTermsConsentRecord({ userId, acceptedAt } = {}) {
  return {
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    acceptedAt: acceptedAt || new Date().toISOString(),
    userId: String(userId || "")
  };
}

function saveTermsConsentRecord(storage, record) {
  if (!storage || typeof storage.setItem !== "function") {
    return false;
  }
  if (!record || typeof record !== "object") {
    return false;
  }
  try {
    storage.setItem(TERMS_CONSENT_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch (_error) {
    // Storage full / privacy mode — consent gating still applies in-page.
    return false;
  }
}

function loadTermsConsentRecord(storage) {
  if (!storage || typeof storage.getItem !== "function") {
    return null;
  }
  try {
    const raw = storage.getItem(TERMS_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

const termsConsentApi = {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  TERMS_CONSENT_STORAGE_KEY,
  ENABLE_DIGITAL_CONTENT_WAIVER,
  buildTermsConsentRecord,
  saveTermsConsentRecord,
  loadTermsConsentRecord
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = termsConsentApi;
}

if (typeof window !== "undefined") {
  window.TermsConsent = termsConsentApi;
}
