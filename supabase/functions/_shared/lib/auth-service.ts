// ESM port of `js/services/auth/auth-service.js`. Logic unchanged (see the
// original file's header for the full P-AUTH-01 design rationale and the
// P-AUTH-03.1 hotfix note on Identity Verified being an OR, not an AND).

export const USER_TYPE = Object.freeze({
  VISITOR: "visitor",
  ANONYMOUS: "anonymous",
  OFFICIAL: "official"
});

// deno-lint-ignore no-explicit-any
type AuthSession = any;
// deno-lint-ignore no-explicit-any
type AuthUser = any;

function isSessionPresent(session: AuthSession): boolean {
  return Boolean(session && typeof session === "object" && session.user);
}

function isJwtValid(session: AuthSession): boolean {
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

function isEmailVerified(user: AuthUser): boolean {
  return Boolean(user?.email_confirmed_at);
}

function isGoogleVerified(user: AuthUser): boolean {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  // deno-lint-ignore no-explicit-any
  return identities.some((identity: any) => identity?.provider === "google");
}

function isStatusActive(_user: AuthUser): boolean {
  return true;
}

function isIdentityVerified(user: AuthUser): boolean {
  return isEmailVerified(user) || isGoogleVerified(user);
}

export function resolveUserType({ session, user }: { session: AuthSession; user: AuthUser } = {} as never): string {
  if (!isSessionPresent(session) || !isJwtValid(session)) {
    return USER_TYPE.VISITOR;
  }

  if (user?.is_anonymous) {
    return USER_TYPE.ANONYMOUS;
  }

  return USER_TYPE.OFFICIAL;
}

export function isOfficialUser({ session, user }: { session: AuthSession; user: AuthUser } = {} as never): boolean {
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

export function resolveAuthState({ session, user }: { session: AuthSession; user: AuthUser } = {} as never) {
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
