"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createEmailOtpService, isUuidPreserved, isValidOtpToken } = require("../email-otp-service");

const ANON_UUID = "11111111-1111-1111-1111-111111111111";

function futureExpiry() {
  return Math.floor(Date.now() / 1000) + 3600;
}

function officialSessionAndUser(uuid = ANON_UUID) {
  const user = {
    id: uuid,
    is_anonymous: false,
    email_confirmed_at: "2026-08-03T00:00:00.000Z",
    identities: [{ provider: "google" }]
  };
  const session = { user, access_token: "token", expires_at: futureExpiry() };
  return { session, user };
}

function createAuthClientMock({
  updateUserError = null,
  updateUserThrows = null,
  verifyOtpError = null,
  verifyOtpThrows = null,
  verifyOtpResultUuid = ANON_UUID,
  refreshSessionError = null,
  refreshSessionThrows = null,
  getSessionError = null,
  getSessionThrows = null,
  getSessionResultUuid = ANON_UUID,
  getSessionIsAnonymous = false,
  signInWithOtpError = null,
  signInWithOtpThrows = null
} = {}) {
  return {
    async updateUser(_payload) {
      if (updateUserThrows) throw updateUserThrows;
      if (updateUserError) return { data: null, error: updateUserError };
      return { data: { user: { id: ANON_UUID } }, error: null };
    },
    async refreshSession(_payload) {
      if (refreshSessionThrows) throw refreshSessionThrows;
      if (refreshSessionError) return { data: null, error: refreshSessionError };
      return { data: {}, error: null };
    },
    async getSession() {
      if (getSessionThrows) throw getSessionThrows;
      if (getSessionError) return { data: null, error: getSessionError };
      const { session } = officialSessionAndUser(getSessionResultUuid);
      session.user = { ...session.user, is_anonymous: getSessionIsAnonymous };
      return { data: { session }, error: null };
    },
    async verifyOtp(_payload) {
      if (verifyOtpThrows) throw verifyOtpThrows;
      if (verifyOtpError) return { data: null, error: verifyOtpError };
      const { session, user } = officialSessionAndUser(verifyOtpResultUuid);
      return { data: { session, user }, error: null };
    },
    async signInWithOtp(_payload) {
      if (signInWithOtpThrows) throw signInWithOtpThrows;
      if (signInWithOtpError) return { data: null, error: signInWithOtpError };
      return { data: {}, error: null };
    }
  };
}

test("createEmailOtpService requires authClient.updateUser/verifyOtp/refreshSession/getSession/signInWithOtp", () => {
  assert.throws(() => createEmailOtpService({ authClient: {} }));
  assert.throws(() => createEmailOtpService({}));
  assert.throws(() => createEmailOtpService({
    authClient: {
      updateUser: async () => ({}),
      verifyOtp: async () => ({})
      // missing refreshSession/getSession/signInWithOtp
    }
  }));
  assert.throws(() => createEmailOtpService({
    authClient: {
      updateUser: async () => ({}),
      verifyOtp: async () => ({}),
      refreshSession: async () => ({}),
      getSession: async () => ({})
      // missing signInWithOtp
    }
  }));
});

test("sendUpgradeOtp: rejects invalid email without calling Supabase", async () => {
  const service = createEmailOtpService({ authClient: createAuthClientMock() });

  const result = await service.sendUpgradeOtp({ email: "not-an-email" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_EMAIL");
});

test("sendUpgradeOtp: success returns the normalized email and otpPurpose 'email_change' (updateUser's OTP type, P-AUTH-04 hotfix)", async () => {
  const service = createEmailOtpService({ authClient: createAuthClientMock() });

  const result = await service.sendUpgradeOtp({ email: " user@example.com " });

  assert.equal(result.ok, true);
  assert.equal(result.data.email, "user@example.com");
  assert.equal(result.data.otpPurpose, "email_change");
});

test("sendUpgradeOtp: Supabase error is normalized as OTP_SEND_FAILED", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ updateUserError: { message: "rate limited" } })
  });

  const result = await service.sendUpgradeOtp({ email: "user@example.com" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "OTP_SEND_FAILED");
});

test("sendUpgradeOtp: thrown exception is normalized as OTP_SEND_FAILED", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ updateUserThrows: new Error("network down") })
  });

  const result = await service.sendUpgradeOtp({ email: "user@example.com" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "OTP_SEND_FAILED");
});

// Hotfix (P-AUTH-04.2): the core bug being fixed — an email that already
// belongs to a DIFFERENT, already-registered account must be detected and
// routed to the Existing Account Login flow, not surfaced as a generic
// (and previously raw-English) send failure.
test("sendUpgradeOtp: Supabase 'already registered' error (with code) is normalized as EMAIL_ALREADY_REGISTERED with a zh-TW friendly message", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({
      updateUserError: { code: "email_exists", message: "A user with this email address has already been registered" }
    })
  });

  const result = await service.sendUpgradeOtp({ email: "user@example.com" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMAIL_ALREADY_REGISTERED");
  assert.equal(result.error.details.requiresLogin, true);
  assert.doesNotMatch(result.error.message, /already|registered/i);
});

test("sendUpgradeOtp: Supabase 'already registered' error (message only, no code) is still normalized as EMAIL_ALREADY_REGISTERED", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({
      updateUserError: { message: "User already registered" }
    })
  });

  const result = await service.sendUpgradeOtp({ email: "user@example.com" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMAIL_ALREADY_REGISTERED");
});

test("sendUpgradeOtp: unrelated Supabase error message never mismatches as EMAIL_ALREADY_REGISTERED", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ updateUserError: { message: "rate limited" } })
  });

  const result = await service.sendUpgradeOtp({ email: "user@example.com" });

  assert.equal(result.error.code, "OTP_SEND_FAILED");
});

// Hotfix-of-hotfix (P-AUTH-04.2 E2E finding): in real E2E testing, the
// Supabase client THREW instead of resolving with `{ data, error }` for
// this exact case — the "already registered" detection must ALSO run on a
// thrown exception, not only on the resolved-with-error branch.
test("sendUpgradeOtp: Supabase 'already registered' error thrown as an exception (not resolved with {error}) is still normalized as EMAIL_ALREADY_REGISTERED", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({
      updateUserThrows: Object.assign(new Error("A user with this email address has already been registered"), { code: "email_exists" })
    })
  });

  const result = await service.sendUpgradeOtp({ email: "user@example.com" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMAIL_ALREADY_REGISTERED");
  assert.equal(result.error.details.requiresLogin, true);
  assert.doesNotMatch(result.error.message, /already|registered/i);
});

test("verifyUpgradeOtp: rejects missing token", async () => {
  const service = createEmailOtpService({ authClient: createAuthClientMock() });

  const result = await service.verifyUpgradeOtp({ email: "user@example.com", token: "" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_OTP");
});

// P-AUTH-04.3 hotfix: Supabase's actual OTP token length is NOT fixed at 6
// digits (varies 6-8 depending on project config) — this must never be
// hardcoded to reject 7/8-digit codes.
test("isValidOtpToken: accepts 6, 7, and 8 digit numeric tokens", () => {
  assert.equal(isValidOtpToken("123456"), true);
  assert.equal(isValidOtpToken("1234567"), true);
  assert.equal(isValidOtpToken("12345678"), true);
});

test("isValidOtpToken: rejects too-short, too-long, non-numeric, and empty tokens", () => {
  assert.equal(isValidOtpToken("12345"), false);
  assert.equal(isValidOtpToken("123456789"), false);
  assert.equal(isValidOtpToken("abcdef"), false);
  assert.equal(isValidOtpToken(""), false);
  assert.equal(isValidOtpToken(undefined), false);
});

test("verifyUpgradeOtp: accepts a 7-digit OTP token (never hardcoded to exactly 6 digits) and defers real acceptance to Supabase's verifyOtp", async () => {
  const service = createEmailOtpService({ authClient: createAuthClientMock() });

  const result = await service.verifyUpgradeOtp({
    email: "user@example.com",
    token: "1234567",
    previousAuthUserId: ANON_UUID
  });

  assert.equal(result.ok, true);
});

test("verifyUpgradeOtp: rejects an obviously-malformed token (5 digits) before ever calling Supabase", async () => {
  let called = false;
  const authClient = createAuthClientMock();
  authClient.verifyOtp = async (payload) => {
    called = true;
    return { data: { session: null, user: null }, error: null };
  };

  const service = createEmailOtpService({ authClient });
  const result = await service.verifyUpgradeOtp({ email: "user@example.com", token: "12345" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_OTP");
  assert.equal(called, false);
});

test("verifyUpgradeOtp: success -> UUID preserved, Official Authentication State returned (P-AUTH-01 integration)", async () => {
  const service = createEmailOtpService({ authClient: createAuthClientMock() });

  const result = await service.verifyUpgradeOtp({
    email: "user@example.com",
    token: "123456",
    previousAuthUserId: ANON_UUID
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.authUserId, ANON_UUID);
  assert.equal(result.data.authState.userType, "official");
  assert.equal(result.data.authState.isOfficialUser, true);
});

// P-AUTH-04 hotfix: `updateUser({ email })` sends an "email_change" OTP,
// NOT an "email" (sign-in) OTP — verifying with the wrong `type` makes
// Supabase reject an otherwise-correct code as invalid/expired. This is
// the exact root cause of "新 Email OTP 驗證失敗".
test("verifyUpgradeOtp: calls authClient.verifyOtp with type='email_change' by DEFAULT (never hardcoded 'email')", async () => {
  let capturedPayload = null;
  const authClient = createAuthClientMock();
  const originalVerifyOtp = authClient.verifyOtp;
  authClient.verifyOtp = async (payload) => {
    capturedPayload = payload;
    return originalVerifyOtp(payload);
  };

  const service = createEmailOtpService({ authClient });
  await service.verifyUpgradeOtp({ email: "user@example.com", token: "123456", previousAuthUserId: ANON_UUID });

  assert.equal(capturedPayload.type, "email_change");
});

test("verifyUpgradeOtp: honors an explicit otpPurpose (the value sendUpgradeOtp actually returned), never overriding it with a hardcoded type", async () => {
  let capturedPayload = null;
  const authClient = createAuthClientMock();
  const originalVerifyOtp = authClient.verifyOtp;
  authClient.verifyOtp = async (payload) => {
    capturedPayload = payload;
    return originalVerifyOtp(payload);
  };

  const service = createEmailOtpService({ authClient });
  await service.verifyUpgradeOtp({
    email: "user@example.com",
    token: "123456",
    previousAuthUserId: ANON_UUID,
    otpPurpose: "email_change"
  });

  assert.equal(capturedPayload.type, "email_change");
});

test("verifyUpgradeOtp: UUID mismatch is rejected (never silently accepts a new Auth User)", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ verifyOtpResultUuid: "22222222-2222-2222-2222-222222222222" })
  });

  const result = await service.verifyUpgradeOtp({
    email: "user@example.com",
    token: "123456",
    previousAuthUserId: ANON_UUID
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "AUTH_UUID_MISMATCH");
  assert.equal(result.error.details.previousAuthUserId, ANON_UUID);
});

test("verifyUpgradeOtp: no previousAuthUserId supplied -> skips the UUID-preservation check", async () => {
  const service = createEmailOtpService({ authClient: createAuthClientMock() });

  const result = await service.verifyUpgradeOtp({ email: "user@example.com", token: "123456" });

  assert.equal(result.ok, true);
});

// Hotfix (P-AUTH-02-hotfix): E2E showed the browser session kept the stale
// pre-upgrade JWT (is_anonymous still true) right after verifyOtp() resolved.
// This test proves the fix by making verifyOtp's OWN response look stale
// (is_anonymous: true) while getSession() (called after refreshSession())
// returns the real post-upgrade state — the final Authentication State must
// reflect the REFRESHED session, not verifyOtp's stale one.
test("verifyUpgradeOtp: refreshes the session and returns is_anonymous=false even when verifyOtp's own response still looked anonymous", async () => {
  const authClient = createAuthClientMock({ getSessionIsAnonymous: false });
  const originalVerifyOtp = authClient.verifyOtp;
  authClient.verifyOtp = async (payload) => {
    const result = await originalVerifyOtp(payload);
    const staleUser = { ...result.data.user, is_anonymous: true };
    return {
      data: { session: { ...result.data.session, user: staleUser }, user: staleUser },
      error: null
    };
  };

  const service = createEmailOtpService({ authClient });

  const result = await service.verifyUpgradeOtp({
    email: "user@example.com",
    token: "123456",
    previousAuthUserId: ANON_UUID
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.authState.isAnonymous, false);
  assert.equal(result.data.authState.userType, "official");
  assert.equal(result.data.authState.isOfficialUser, true);
});

test("verifyUpgradeOtp: refreshSession() failure is normalized as OTP_VERIFY_FAILED", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ refreshSessionError: { message: "refresh failed" } })
  });

  const result = await service.verifyUpgradeOtp({
    email: "user@example.com",
    token: "123456",
    previousAuthUserId: ANON_UUID
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "OTP_VERIFY_FAILED");
});

test("verifyUpgradeOtp: getSession() failure after refresh is normalized as OTP_VERIFY_FAILED", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ getSessionError: { message: "session read failed" } })
  });

  const result = await service.verifyUpgradeOtp({
    email: "user@example.com",
    token: "123456",
    previousAuthUserId: ANON_UUID
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "OTP_VERIFY_FAILED");
});

test("verifyUpgradeOtp: Supabase error is normalized as OTP_VERIFY_FAILED", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ verifyOtpError: { message: "invalid token" } })
  });

  const result = await service.verifyUpgradeOtp({ email: "user@example.com", token: "000000" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "OTP_VERIFY_FAILED");
});

test("verifyUpgradeOtp: thrown exception is normalized as OTP_VERIFY_FAILED", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ verifyOtpThrows: new Error("network down") })
  });

  const result = await service.verifyUpgradeOtp({ email: "user@example.com", token: "000000" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "OTP_VERIFY_FAILED");
});

test("isUuidPreserved: matches only when both ids are present and identical", () => {
  assert.equal(isUuidPreserved(ANON_UUID, ANON_UUID), true);
  assert.equal(isUuidPreserved(ANON_UUID, "other-id"), false);
  assert.equal(isUuidPreserved("", ANON_UUID), false);
  assert.equal(isUuidPreserved(ANON_UUID, ""), false);
});

// --- Existing Account Login (P-AUTH-04.2 hotfix, spec Section 7) ---

const EXISTING_UUID = "33333333-3333-3333-3333-333333333333";

test("sendLoginOtp: rejects invalid email without calling Supabase", async () => {
  const service = createEmailOtpService({ authClient: createAuthClientMock() });

  const result = await service.sendLoginOtp({ email: "not-an-email" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_EMAIL");
});

test("sendLoginOtp: success returns the normalized email, never creates a new account (shouldCreateUser: false), and forwards captchaToken (Supabase Captcha protection on this public endpoint)", async () => {
  let capturedPayload = null;
  const authClient = createAuthClientMock();
  const originalSignInWithOtp = authClient.signInWithOtp;
  authClient.signInWithOtp = async (payload) => {
    capturedPayload = payload;
    return originalSignInWithOtp(payload);
  };

  const service = createEmailOtpService({ authClient });
  const result = await service.sendLoginOtp({ email: " user@example.com ", captchaToken: "turnstile-token-abc" });

  assert.equal(result.ok, true);
  assert.equal(result.data.email, "user@example.com");
  assert.equal(result.data.otpPurpose, "email");
  assert.equal(capturedPayload.options.shouldCreateUser, false);
  assert.equal(capturedPayload.options.captchaToken, "turnstile-token-abc");
});

test("sendLoginOtp: Supabase error is normalized as LOGIN_OTP_SEND_FAILED with a friendly message", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ signInWithOtpError: { message: "rate limited" } })
  });

  const result = await service.sendLoginOtp({ email: "user@example.com" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LOGIN_OTP_SEND_FAILED");
  assert.doesNotMatch(result.error.message, /rate limited/i);
});

test("sendLoginOtp: thrown exception is normalized as LOGIN_OTP_SEND_FAILED", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ signInWithOtpThrows: new Error("network down") })
  });

  const result = await service.sendLoginOtp({ email: "user@example.com" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LOGIN_OTP_SEND_FAILED");
});

test("verifyLoginOtp: rejects missing token", async () => {
  const service = createEmailOtpService({ authClient: createAuthClientMock() });

  const result = await service.verifyLoginOtp({ email: "user@example.com", token: "" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_OTP");
});

test("verifyLoginOtp: accepts an 8-digit OTP token (never hardcoded to exactly 6 digits)", async () => {
  const service = createEmailOtpService({ authClient: createAuthClientMock() });

  const result = await service.verifyLoginOtp({ email: "user@example.com", token: "12345678" });

  assert.equal(result.ok, true);
});

test("verifyLoginOtp: success returns the EXISTING account's Auth UUID (deliberately different from the anonymous UUID) and Official Authentication State, without enforcing UUID Preservation", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ verifyOtpResultUuid: EXISTING_UUID })
  });

  const result = await service.verifyLoginOtp({ email: "user@example.com", token: "123456" });

  assert.equal(result.ok, true);
  assert.equal(result.data.authUserId, EXISTING_UUID);
  assert.equal(result.data.authState.isOfficialUser, true);
});

// P-AUTH-04 hotfix: `signInWithOtp()` sends an "email" (sign-in) OTP, which
// MUST be verified with type='email' — distinct from the "email_change"
// type used by verifyUpgradeOtp above. This test guards against ever
// accidentally sharing/confusing the two.
test("verifyLoginOtp: calls authClient.verifyOtp with type='email' by DEFAULT (never hardcoded/confused with 'email_change')", async () => {
  let capturedPayload = null;
  const authClient = createAuthClientMock();
  const originalVerifyOtp = authClient.verifyOtp;
  authClient.verifyOtp = async (payload) => {
    capturedPayload = payload;
    return originalVerifyOtp(payload);
  };

  const service = createEmailOtpService({ authClient });
  await service.verifyLoginOtp({ email: "user@example.com", token: "123456" });

  assert.equal(capturedPayload.type, "email");
});

test("verifyLoginOtp: Supabase error is normalized as LOGIN_OTP_VERIFY_FAILED with a friendly message", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ verifyOtpError: { message: "invalid token" } })
  });

  const result = await service.verifyLoginOtp({ email: "user@example.com", token: "000000" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LOGIN_OTP_VERIFY_FAILED");
  assert.doesNotMatch(result.error.message, /invalid token/i);
});

test("verifyLoginOtp: thrown exception is normalized as LOGIN_OTP_VERIFY_FAILED", async () => {
  const service = createEmailOtpService({
    authClient: createAuthClientMock({ verifyOtpThrows: new Error("network down") })
  });

  const result = await service.verifyLoginOtp({ email: "user@example.com", token: "000000" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LOGIN_OTP_VERIFY_FAILED");
});
