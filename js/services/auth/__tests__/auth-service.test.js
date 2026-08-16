"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { USER_TYPE, resolveUserType, isOfficialUser, resolveAuthState } = require("../auth-service");

function futureExpiry() {
  return Math.floor(Date.now() / 1000) + 3600;
}

function pastExpiry() {
  return Math.floor(Date.now() / 1000) - 3600;
}

function officialUser() {
  return {
    id: "user-official-1",
    is_anonymous: false,
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
    identities: [{ provider: "google" }]
  };
}

function anonymousUser() {
  return {
    id: "user-anon-1",
    is_anonymous: true
  };
}

test("Visitor: no session -> userType visitor, not official", () => {
  const state = resolveAuthState({ session: null, user: null });

  assert.equal(resolveUserType({ session: null, user: null }), USER_TYPE.VISITOR);
  assert.equal(isOfficialUser({ session: null, user: null }), false);
  assert.equal(state.userType, USER_TYPE.VISITOR);
  assert.equal(state.isOfficialUser, false);
  assert.equal(state.hasSession, false);
});

test("Visitor: session present but JWT expired -> treated as visitor", () => {
  const session = { user: officialUser(), access_token: "token", expires_at: pastExpiry() };
  const user = officialUser();

  assert.equal(resolveUserType({ session, user }), USER_TYPE.VISITOR);
  assert.equal(isOfficialUser({ session, user }), false);
});

test("Anonymous User: valid session + is_anonymous true -> not official", () => {
  const session = { user: anonymousUser(), access_token: "token", expires_at: futureExpiry() };
  const user = anonymousUser();

  const state = resolveAuthState({ session, user });

  assert.equal(resolveUserType({ session, user }), USER_TYPE.ANONYMOUS);
  assert.equal(isOfficialUser({ session, user }), false);
  assert.equal(state.isAnonymous, true);
  assert.equal(state.isOfficialUser, false);
});

test("Official User: valid session + is_anonymous false + email verified + google identity -> official", () => {
  const session = { user: officialUser(), access_token: "token", expires_at: futureExpiry() };
  const user = officialUser();

  const state = resolveAuthState({ session, user });

  assert.equal(resolveUserType({ session, user }), USER_TYPE.OFFICIAL);
  assert.equal(isOfficialUser({ session, user }), true);
  assert.equal(state.isOfficialUser, true);
  assert.equal(state.isAnonymous, false);
  assert.equal(state.emailVerified, true);
  assert.equal(state.googleVerified, true);
});

test("Official User: valid session + is_anonymous false + email verified (no Google identity) -> official (Identity Verified is OR, not AND)", () => {
  const user = { ...officialUser(), identities: [] };
  const session = { user, access_token: "token", expires_at: futureExpiry() };

  const state = resolveAuthState({ session, user });

  assert.equal(isOfficialUser({ session, user }), true);
  assert.equal(state.isOfficialUser, true);
  assert.equal(state.emailVerified, true);
  assert.equal(state.googleVerified, false);
});

test("Official User: valid session + is_anonymous false + Google identity (no email confirmed) -> official (Identity Verified is OR, not AND)", () => {
  const user = { ...officialUser(), email_confirmed_at: null };
  const session = { user, access_token: "token", expires_at: futureExpiry() };

  const state = resolveAuthState({ session, user });

  assert.equal(isOfficialUser({ session, user }), true);
  assert.equal(state.isOfficialUser, true);
  assert.equal(state.emailVerified, false);
  assert.equal(state.googleVerified, true);
});

test("Not official: is_anonymous false but neither email confirmed nor Google identity present", () => {
  const user = { ...officialUser(), email_confirmed_at: null, identities: [] };
  const session = { user, access_token: "token", expires_at: futureExpiry() };

  assert.equal(isOfficialUser({ session, user }), false);
});

test("Not official: no access_token on session", () => {
  const user = officialUser();
  const session = { user, access_token: null, expires_at: futureExpiry() };

  assert.equal(isOfficialUser({ session, user }), false);
  assert.equal(resolveUserType({ session, user }), USER_TYPE.VISITOR);
});

test("Session with no expires_at is treated as valid (non-expiring)", () => {
  const user = officialUser();
  const session = { user, access_token: "token" };

  assert.equal(isOfficialUser({ session, user }), true);
});
