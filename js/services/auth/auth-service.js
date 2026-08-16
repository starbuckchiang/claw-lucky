"use strict";

/**
 * Authentication Service (P-AUTH-01 Foundation)
 *
 * Pure decision logic for the 4 user types defined in
 * specs/003-spec-auth-subscription.md (Visitor / Anonymous User /
 * Official User / Subscriber — Subscriber is out of scope for this
 * Foundation phase).
 *
 * This module does NO I/O (no Supabase calls, no localStorage, no DOM).
 * Callers pass in the already-fetched Supabase `session` and `user`
 * objects (e.g. from `supabaseClient.auth.getSession()`), matching the
 * dependency-injection style used by the other `js/services/**` modules
 * (see wallpaper-selection-service.js). This keeps it testable under
 * `node --test` and reusable from the browser via the same dual-export
 * pattern.
 *
 * NOTE (known spec gap, not fabricated): 003-spec-auth-subscription.md
 * Section 3 requires "Status = Active" as part of the Official User
 * definition, but the `users` table currently has no status/banned
 * column (no schema change was in scope for this task). `isOfficialUser`
 * therefore treats status as always-active until that column exists.
 *
 * SPEC ALIGNMENT HOTFIX (P-AUTH-03.1 hotfix): Section 3's original wording
 * read as if BOTH Email verification AND Google verification were required.
 * That was a spec wording error — the actual rule is: at least ONE durable,
 * re-loginable identity must be verified (Email OR Google OR any other
 * supported identity), not all of them simultaneously. `isOfficialUser`
 * below reflects the corrected OR rule.
 */

const USER_TYPE = Object.freeze({
  VISITOR: "visitor",
  ANONYMOUS: "anonymous",
  OFFICIAL: "official"
});

function isSessionPresent(session) {
  return Boolean(session && typeof session === "object" && session.user);
}

// A Supabase session is only usable if it has an access token AND, when an
// `expires_at` (unix seconds) is present, that expiry is in the future.
function isJwtValid(session) {
  if (!isSessionPresent(session)) {
    return false;
  }

  if (!session.access_token) {
    return false;
  }

  if (session.expires_at === undefined || session.expires_at === null) {
    return true;
  }

  const expiresAtMs = Number(session.expires_at) * 1000;
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }

  return expiresAtMs > Date.now();
}

function isEmailVerified(user) {
  return Boolean(user?.email_confirmed_at);
}

function isGoogleVerified(user) {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return identities.some((identity) => identity?.provider === "google");
}

// Placeholder for the missing `status` column (see module doc note above).
// Kept as its own function so it's a single, obvious place to update once
// a real status/banned column exists.
function isStatusActive(_user) {
  return true;
}

// Identity Verified (spec Section 3, corrected wording): at least ONE
// durable, re-loginable identity must be verified — Email confirmed OR a
// Google identity present. NOT both simultaneously.
function isIdentityVerified(user) {
  return isEmailVerified(user) || isGoogleVerified(user);
}

function resolveUserType({ session, user } = {}) {
  if (!isSessionPresent(session) || !isJwtValid(session)) {
    return USER_TYPE.VISITOR;
  }

  if (user?.is_anonymous) {
    return USER_TYPE.ANONYMOUS;
  }

  return USER_TYPE.OFFICIAL;
}

// Official User Definition (spec Section 3, corrected wording) — ALL must
// hold:
// - Valid Session
// - JWT 有效
// - is_anonymous == false
// - Identity Verified (Email confirmed OR Google identity present — at
//   least one, not both)
// - Status = Active
function isOfficialUser({ session, user } = {}) {
  if (!isSessionPresent(session) || !isJwtValid(session)) {
    return false;
  }

  if (user?.is_anonymous) {
    return false;
  }

  if (!isIdentityVerified(user)) {
    return false;
  }

  return isStatusActive(user);
}

function resolveAuthState({ session, user } = {}) {
  const hasSession = isSessionPresent(session);
  const jwtValid = isJwtValid(session);

  return {
    userType: resolveUserType({ session, user }),
    isOfficialUser: isOfficialUser({ session, user }),
    isAnonymous: hasSession && jwtValid ? Boolean(user?.is_anonymous) : false,
    hasSession,
    jwtValid,
    emailVerified: isEmailVerified(user),
    googleVerified: isGoogleVerified(user)
  };
}

const authServiceApi = {
  USER_TYPE,
  resolveUserType,
  isOfficialUser,
  resolveAuthState
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = authServiceApi;
}

if (typeof window !== "undefined") {
  window.AuthService = authServiceApi;
}
