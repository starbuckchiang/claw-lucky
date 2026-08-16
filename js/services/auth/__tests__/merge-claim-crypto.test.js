"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeEmailForHash, hashClaimValue, hashNormalizedEmail } = require("../merge-claim-crypto");

test("normalizeEmailForHash: trims whitespace and lower-cases", () => {
  assert.equal(normalizeEmailForHash("  User@Example.com  "), "user@example.com");
  assert.equal(normalizeEmailForHash("USER@EXAMPLE.COM"), "user@example.com");
  assert.equal(normalizeEmailForHash("user@example.com"), "user@example.com");
});

test("normalizeEmailForHash: handles null/undefined/empty without throwing", () => {
  assert.equal(normalizeEmailForHash(null), "");
  assert.equal(normalizeEmailForHash(undefined), "");
  assert.equal(normalizeEmailForHash(""), "");
});

test("hashClaimValue: deterministic — same input always produces the same hash", () => {
  const first = hashClaimValue("some-claim-token");
  const second = hashClaimValue("some-claim-token");
  assert.equal(first, second);
});

test("hashClaimValue: different input produces a different hash", () => {
  assert.notEqual(hashClaimValue("token-a"), hashClaimValue("token-b"));
});

test("hashClaimValue: returns a 64-character lowercase hex string (SHA-256)", () => {
  const hash = hashClaimValue("anything");
  assert.match(hash, /^[0-9a-f]{64}$/);
});

// Gate blocker fix (P-AUTH-05A-fix requirement 1): case/whitespace
// variations of the SAME email must hash identically, so a claim created
// for "User@Example.com" can still be matched later against a verified
// session's `user.email` of "user@example.com".
test("hashNormalizedEmail: case and whitespace variations of the same email hash identically", () => {
  const a = hashNormalizedEmail(" User@Example.com ");
  const b = hashNormalizedEmail("user@example.com");
  const c = hashNormalizedEmail("USER@EXAMPLE.COM");

  assert.equal(a, b);
  assert.equal(b, c);
});

test("hashNormalizedEmail: different emails hash differently", () => {
  assert.notEqual(hashNormalizedEmail("a@example.com"), hashNormalizedEmail("b@example.com"));
});
