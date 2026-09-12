"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handleRecordConsentRequest,
  validateRecordRequestShape,
  resolvePolicyFieldsForScope,
  ENABLED_CONSENT_SCOPES
} = require("../consent-ops-handler");

const {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  TERMS_CONTENT_SHA256,
  PRIVACY_CONTENT_SHA256
} = require("../../../../js/services/auth/policy-versions");

const USER = { id: "11111111-2222-3333-4444-555555555555" };
const VALID_BODY = Object.freeze({
  consentScope: "account_upgrade",
  source: "account_upgrade_form",
  idempotencyKey: "key-1234567890"
});

function createFakeRepository() {
  // Stateful fake modelling the RPC's idempotent contract:
  // (userId, scope, key) inserts once; retries return the ORIGINAL row.
  const rows = new Map();
  let insertCount = 0;
  return {
    rows,
    get insertCount() { return insertCount; },
    async recordConsent(payload) {
      const key = `${payload.userId}|${payload.consentScope}|${payload.idempotencyKey}`;
      if (!rows.has(key)) {
        insertCount += 1;
        rows.set(key, {
          out_id: `consent-${insertCount}`,
          out_consent_scope: payload.consentScope,
          out_terms_version: payload.termsVersion,
          out_privacy_version: payload.privacyVersion,
          out_accepted_at: "2026-09-15T00:00:00.000Z",
          out_was_existing: false,
          _payload: payload
        });
        return rows.get(key);
      }
      return { ...rows.get(key), out_was_existing: true };
    }
  };
}

test("success: repository receives the JWT-derived user id, never a body value", async () => {
  const repository = createFakeRepository();
  const result = await handleRecordConsentRequest({
    body: { ...VALID_BODY },
    user: USER,
    correlationId: "c-1",
    deps: { repository }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  const stored = [...repository.rows.values()][0]._payload;
  assert.equal(stored.userId, USER.id);
});

test("server decides versions and hashes from the policy module (account_upgrade)", async () => {
  const repository = createFakeRepository();
  await handleRecordConsentRequest({
    body: { ...VALID_BODY },
    user: USER,
    correlationId: "c-2",
    deps: { repository }
  });

  const stored = [...repository.rows.values()][0]._payload;
  assert.equal(stored.termsVersion, CURRENT_TERMS_VERSION);
  assert.equal(stored.privacyVersion, CURRENT_PRIVACY_VERSION);
  assert.equal(stored.termsContentSha256, TERMS_CONTENT_SHA256);
  assert.equal(stored.privacyContentSha256, PRIVACY_CONTENT_SHA256);
});

test("checkout scope records terms fields only (privacy fields null)", async () => {
  const fields = resolvePolicyFieldsForScope("checkout");
  assert.equal(fields.termsVersion, CURRENT_TERMS_VERSION);
  assert.equal(fields.termsContentSha256, TERMS_CONTENT_SHA256);
  assert.equal(fields.privacyVersion, null);
  assert.equal(fields.privacyContentSha256, null);
});

test("accepted_at is never passed to the repository — server (DB now()) time only", async () => {
  const repository = createFakeRepository();
  await handleRecordConsentRequest({
    body: { ...VALID_BODY },
    user: USER,
    correlationId: "c-3",
    deps: { repository }
  });

  const stored = [...repository.rows.values()][0]._payload;
  assert.ok(!("acceptedAt" in stored));
  assert.ok(!("accepted_at" in stored));
});

test("body may not carry owner-id or server-authority fields (rejected whole, repo untouched)", async () => {
  const forbidden = [
    { userId: "attacker" },
    { user_id: "attacker" },
    { ownerId: "attacker" },
    { owner_id: "attacker" },
    { acceptedAt: "2020-01-01T00:00:00Z" },
    { accepted_at: "2020-01-01T00:00:00Z" },
    { termsVersion: "1999-01-01" },
    { terms_version: "1999-01-01" },
    { privacyVersion: "1999-01-01" },
    { termsContentSha256: "a".repeat(64) },
    { privacy_content_sha256: "a".repeat(64) }
  ];

  for (const extra of forbidden) {
    const repository = createFakeRepository();
    const result = await handleRecordConsentRequest({
      body: { ...VALID_BODY, ...extra },
      user: USER,
      correlationId: "c-4",
      deps: { repository }
    });
    assert.equal(result.statusCode, 400, JSON.stringify(extra));
    assert.equal(repository.insertCount, 0);
  }
});

test("digital_content_waiver is rejected while the feature flag is off — no record is ever created", async () => {
  assert.ok(!ENABLED_CONSENT_SCOPES.includes("digital_content_waiver"));

  const repository = createFakeRepository();
  const result = await handleRecordConsentRequest({
    body: { ...VALID_BODY, consentScope: "digital_content_waiver" },
    user: USER,
    correlationId: "c-5",
    deps: { repository }
  });

  assert.equal(result.statusCode, 400);
  assert.equal(repository.insertCount, 0);
});

test("unknown scope and unknown source are rejected", () => {
  assert.ok(validateRecordRequestShape({ ...VALID_BODY, consentScope: "marketing" }).length > 0);
  assert.ok(validateRecordRequestShape({ ...VALID_BODY, source: "devtools" }).length > 0);
});

test("idempotency key format is enforced (length and charset)", () => {
  assert.ok(validateRecordRequestShape({ ...VALID_BODY, idempotencyKey: "short" }).length > 0);
  assert.ok(validateRecordRequestShape({ ...VALID_BODY, idempotencyKey: "x".repeat(129) }).length > 0);
  assert.ok(validateRecordRequestShape({ ...VALID_BODY, idempotencyKey: "bad key with spaces" }).length > 0);
  assert.equal(validateRecordRequestShape({ ...VALID_BODY }).length, 0);
});

test("missing/empty user -> 401, repository untouched", async () => {
  for (const user of [null, {}, { id: "  " }]) {
    const repository = createFakeRepository();
    const result = await handleRecordConsentRequest({
      body: { ...VALID_BODY },
      user,
      correlationId: "c-6",
      deps: { repository }
    });
    assert.equal(result.statusCode, 401);
    assert.equal(repository.insertCount, 0);
  }
});

test("idempotent retry: same user/scope/key returns the ORIGINAL record, no second insert", async () => {
  const repository = createFakeRepository();
  const first = await handleRecordConsentRequest({
    body: { ...VALID_BODY },
    user: USER,
    correlationId: "c-7a",
    deps: { repository }
  });
  const second = await handleRecordConsentRequest({
    body: { ...VALID_BODY },
    user: USER,
    correlationId: "c-7b",
    deps: { repository }
  });

  assert.equal(repository.insertCount, 1);
  assert.equal(second.body.data.consentId, first.body.data.consentId);
  assert.equal(second.body.data.wasExisting, true);
});

test("different scopes keep independent idempotency records for the same key", async () => {
  const repository = createFakeRepository();
  await handleRecordConsentRequest({
    body: { ...VALID_BODY },
    user: USER,
    correlationId: "c-8a",
    deps: { repository }
  });
  await handleRecordConsentRequest({
    body: { consentScope: "checkout", source: "subscription_page", idempotencyKey: VALID_BODY.idempotencyKey },
    user: USER,
    correlationId: "c-8b",
    deps: { repository }
  });

  assert.equal(repository.insertCount, 2);
});

test("RPC failure -> 502 CONSENT_RECORD_FAILED retryable:true; log carries no sensitive data", async () => {
  const logged = [];
  const originalError = console.error;
  console.error = (line) => logged.push(String(line));

  try {
    const result = await handleRecordConsentRequest({
      body: { ...VALID_BODY },
      user: USER,
      correlationId: "c-9",
      deps: {
        repository: {
          async recordConsent() {
            // Deliberately poison the message with fake sensitive values.
            throw new Error("db failed for user attacker@example.com token eyJhbGciOiJIUzI1NiJ9.zzz.zzz");
          }
        }
      }
    });

    assert.equal(result.statusCode, 502);
    assert.equal(result.body.error.code, "CONSENT_RECORD_FAILED");
    assert.equal(result.body.error.retryable, true);

    assert.equal(logged.length, 1);
    const entry = JSON.parse(logged[0]);
    assert.deepEqual(Object.keys(entry).sort(), ["correlationId", "event", "level", "reason"]);
    assert.equal(entry.reason, "RPC_ERROR");
    assert.doesNotMatch(logged[0], /attacker@example\.com/);
    assert.doesNotMatch(logged[0], /eyJ/);
    assert.doesNotMatch(logged[0], new RegExp(USER.id));
  } finally {
    console.error = originalError;
  }
});

test("success response body carries no email/user id/JWT fields", async () => {
  const repository = createFakeRepository();
  const result = await handleRecordConsentRequest({
    body: { ...VALID_BODY },
    user: { ...USER, email: "someone@example.com" },
    correlationId: "c-10",
    deps: { repository }
  });

  const serialized = JSON.stringify(result.body);
  assert.doesNotMatch(serialized, /someone@example\.com/);
  assert.doesNotMatch(serialized, new RegExp(USER.id));
  assert.deepEqual(
    Object.keys(result.body.data).sort(),
    ["acceptedAt", "consentId", "consentScope", "privacyVersion", "termsVersion", "wasExisting"]
  );
});
