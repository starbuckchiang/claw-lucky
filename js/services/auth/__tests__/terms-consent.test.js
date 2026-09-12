"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  TERMS_CONSENT_STORAGE_KEY,
  ENABLE_DIGITAL_CONTENT_WAIVER,
  buildTermsConsentRecord,
  saveTermsConsentRecord,
  loadTermsConsentRecord
} = require("../terms-consent");

function createFakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    map
  };
}

test("digital-content waiver feature flag is OFF until legal review", () => {
  assert.equal(ENABLE_DIGITAL_CONTENT_WAIVER, false);
});

test("buildTermsConsentRecord: contains current versions, userId, acceptedAt", () => {
  const record = buildTermsConsentRecord({ userId: "uid-123" });
  assert.equal(record.termsVersion, CURRENT_TERMS_VERSION);
  assert.equal(record.privacyVersion, CURRENT_PRIVACY_VERSION);
  assert.equal(record.userId, "uid-123");
  assert.ok(!Number.isNaN(Date.parse(record.acceptedAt)));
});

test("buildTermsConsentRecord: missing userId becomes empty string, never undefined", () => {
  const record = buildTermsConsentRecord({});
  assert.equal(record.userId, "");
});

test("save + load round-trips the record via the fixed storage key", () => {
  const storage = createFakeStorage();
  const record = buildTermsConsentRecord({
    userId: "uid-9",
    acceptedAt: "2026-09-10T00:00:00.000Z"
  });

  assert.equal(saveTermsConsentRecord(storage, record), true);
  assert.ok(storage.map.has(TERMS_CONSENT_STORAGE_KEY));

  const loaded = loadTermsConsentRecord(storage);
  assert.deepEqual(loaded, record);
});

test("saveTermsConsentRecord: returns false on missing storage or record, and on setItem throw", () => {
  assert.equal(saveTermsConsentRecord(null, {}), false);
  assert.equal(saveTermsConsentRecord(createFakeStorage(), null), false);

  const throwingStorage = {
    setItem: () => {
      throw new Error("QuotaExceededError");
    }
  };
  assert.equal(
    saveTermsConsentRecord(throwingStorage, buildTermsConsentRecord({ userId: "u" })),
    false
  );
});

test("loadTermsConsentRecord: null on missing storage, absent key, or corrupt JSON", () => {
  assert.equal(loadTermsConsentRecord(null), null);
  assert.equal(loadTermsConsentRecord(createFakeStorage()), null);

  const corrupt = createFakeStorage();
  corrupt.setItem(TERMS_CONSENT_STORAGE_KEY, "{not json");
  assert.equal(loadTermsConsentRecord(corrupt), null);
});
