"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createSubscriptionEntryGuard, ACTION } = require("../subscription-entry-guard");

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
  return { session: { user, access_token: "token", expires_at: futureExpiry() }, user };
}

function anonymousSessionAndUser(uuid = ANON_UUID) {
  const user = { id: uuid, is_anonymous: true };
  return { session: { user, access_token: "token", expires_at: futureExpiry() }, user };
}

function createEmailOtpServiceMock({
  sendResult = { ok: true, data: { email: "user@example.com" } },
  verifyResult,
  loginSendResult = { ok: true, data: { email: "user@example.com" } },
  loginVerifyResult
} = {}) {
  return {
    async sendUpgradeOtp(_input) {
      return sendResult;
    },
    async verifyUpgradeOtp(_input) {
      return verifyResult;
    },
    async sendLoginOtp(_input) {
      return loginSendResult;
    },
    async verifyLoginOtp(_input) {
      return loginVerifyResult;
    }
  };
}

// P-AUTH-05B-1: fake Account Merge Service so guard-level tests can prove
// the FULL contract (success auto-resumes Checkout, retryable failure
// preserves pending, claimToken forwarded unchanged) without depending on
// a real Edge Function.
function createAccountMergeServiceMock({
  mergeResult = { ok: true, data: { merged: true } },
  beginResult = { ok: true, data: { claimToken: "raw-claim-token", expiresAt: "2026-01-01T00:15:00.000Z" } }
} = {}) {
  const calls = [];
  const beginCalls = [];
  return {
    calls,
    beginCalls,
    async beginAccountMerge(input) {
      beginCalls.push(input);
      return beginResult;
    },
    async mergeAnonymousIntoExistingAccount(input) {
      calls.push(input);
      return mergeResult;
    }
  };
}

test("createSubscriptionEntryGuard requires authService.resolveAuthState and emailOtpService methods", () => {
  // No emailOtpService at all -> throws (authService falls back to the
  // real P-AUTH-01 default, so only emailOtpService is missing here).
  assert.throws(() => createSubscriptionEntryGuard({}));

  // Explicit but invalid authService (no resolveAuthState) -> throws.
  assert.throws(() => createSubscriptionEntryGuard({
    authService: {},
    emailOtpService: createEmailOtpServiceMock()
  }));

  // emailOtpService missing verifyUpgradeOtp/sendUpgradeOtp -> throws.
  assert.throws(() => createSubscriptionEntryGuard({
    authService: { resolveAuthState: () => ({}) },
    emailOtpService: {}
  }));

  // emailOtpService missing sendLoginOtp/verifyLoginOtp -> throws.
  assert.throws(() => createSubscriptionEntryGuard({
    authService: { resolveAuthState: () => ({}) },
    emailOtpService: {
      sendUpgradeOtp: async () => ({}),
      verifyUpgradeOtp: async () => ({})
    }
  }));

  // accountMergeService missing beginAccountMerge/mergeAnonymousIntoExistingAccount -> throws.
  assert.throws(() => createSubscriptionEntryGuard({
    authService: { resolveAuthState: () => ({}) },
    emailOtpService: createEmailOtpServiceMock(),
    accountMergeService: {}
  }));
  assert.throws(() => createSubscriptionEntryGuard({
    authService: { resolveAuthState: () => ({}) },
    emailOtpService: createEmailOtpServiceMock(),
    accountMergeService: { mergeAnonymousIntoExistingAccount: async () => ({}) } // missing beginAccountMerge
  }));
});

test("evaluateSubscriptionEntry: Official User -> enter_checkout, preserving checkoutContext", () => {
  const guard = createSubscriptionEntryGuard({ emailOtpService: createEmailOtpServiceMock() });
  const { session, user } = officialSessionAndUser();

  const result = guard.evaluateSubscriptionEntry({ session, user, checkoutContext: { planId: "pro-monthly" } });

  assert.equal(result.action, ACTION.ENTER_CHECKOUT);
  assert.equal(result.authState.isOfficialUser, true);
  assert.deepEqual(result.checkoutContext, { planId: "pro-monthly" });
});

test("evaluateSubscriptionEntry: Anonymous User -> start_email_otp_upgrade, carrying pending.checkoutContext", () => {
  const guard = createSubscriptionEntryGuard({ emailOtpService: createEmailOtpServiceMock() });
  const { session, user } = anonymousSessionAndUser();

  const result = guard.evaluateSubscriptionEntry({ session, user, checkoutContext: { planId: "pro-monthly" } });

  assert.equal(result.action, ACTION.START_EMAIL_OTP_UPGRADE);
  assert.equal(result.authState.isOfficialUser, false);
  assert.deepEqual(result.pending, { checkoutContext: { planId: "pro-monthly" } });
});

test("evaluateSubscriptionEntry: Visitor (no session) -> start_email_otp_upgrade", () => {
  const guard = createSubscriptionEntryGuard({ emailOtpService: createEmailOtpServiceMock() });

  const result = guard.evaluateSubscriptionEntry({ session: null, user: null, checkoutContext: null });

  assert.equal(result.action, ACTION.START_EMAIL_OTP_UPGRADE);
  assert.equal(result.authState.userType, "visitor");
});

test("startUpgrade: delegates to emailOtpService.sendUpgradeOtp unchanged", async () => {
  const sendResult = { ok: true, data: { email: "user@example.com" } };
  const guard = createSubscriptionEntryGuard({ emailOtpService: createEmailOtpServiceMock({ sendResult }) });

  const result = await guard.startUpgrade({ email: "user@example.com" });

  assert.deepEqual(result, sendResult);
});

test("completeUpgradeAndResume: success + Official -> resumes with the original checkoutContext (Return-to-Checkout Flow)", async () => {
  const { session, user } = officialSessionAndUser();
  const verifyResult = {
    ok: true,
    data: {
      authUserId: ANON_UUID,
      authState: require("../auth-service").resolveAuthState({ session, user })
    }
  };
  const guard = createSubscriptionEntryGuard({ emailOtpService: createEmailOtpServiceMock({ verifyResult }) });

  const result = await guard.completeUpgradeAndResume({
    email: "user@example.com",
    token: "123456",
    previousAuthUserId: ANON_UUID,
    pending: { checkoutContext: { planId: "pro-monthly" } }
  });

  assert.equal(result.action, ACTION.ENTER_CHECKOUT);
  assert.deepEqual(result.checkoutContext, { planId: "pro-monthly" });
  assert.equal(result.authState.isOfficialUser, true);
});

// P-AUTH-04 hotfix: otpPurpose ("email_change") must be threaded through
// unchanged from the caller into emailOtpService.verifyUpgradeOtp — never
// dropped or re-derived inside the guard.
test("completeUpgradeAndResume: forwards otpPurpose unchanged to emailOtpService.verifyUpgradeOtp", async () => {
  const { session, user } = officialSessionAndUser();
  const verifyResult = {
    ok: true,
    data: {
      authUserId: ANON_UUID,
      authState: require("../auth-service").resolveAuthState({ session, user })
    }
  };
  let capturedInput = null;
  const emailOtpService = createEmailOtpServiceMock({ verifyResult });
  emailOtpService.verifyUpgradeOtp = async (input) => {
    capturedInput = input;
    return verifyResult;
  };
  const guard = createSubscriptionEntryGuard({ emailOtpService });

  await guard.completeUpgradeAndResume({
    email: "user@example.com",
    token: "123456",
    previousAuthUserId: ANON_UUID,
    pending: { checkoutContext: { planId: "pro-monthly" } },
    otpPurpose: "email_change"
  });

  assert.equal(capturedInput.otpPurpose, "email_change");
});

test("completeUpgradeAndResume: verify failure -> upgrade_failed, pending preserved for retry", async () => {
  const verifyResult = { ok: false, error: { code: "OTP_VERIFY_FAILED", message: "invalid token" } };
  const guard = createSubscriptionEntryGuard({ emailOtpService: createEmailOtpServiceMock({ verifyResult }) });

  const result = await guard.completeUpgradeAndResume({
    email: "user@example.com",
    token: "000000",
    pending: { checkoutContext: { planId: "pro-monthly" } }
  });

  assert.equal(result.action, ACTION.UPGRADE_FAILED);
  assert.equal(result.error.code, "OTP_VERIFY_FAILED");
  assert.deepEqual(result.pending, { checkoutContext: { planId: "pro-monthly" } });
});

test("completeUpgradeAndResume: verify succeeds but resulting state is still not Official -> upgrade_incomplete (never forces Checkout)", async () => {
  const { session, user } = anonymousSessionAndUser();
  const verifyResult = {
    ok: true,
    data: {
      authUserId: ANON_UUID,
      authState: require("../auth-service").resolveAuthState({ session, user })
    }
  };
  const guard = createSubscriptionEntryGuard({ emailOtpService: createEmailOtpServiceMock({ verifyResult }) });

  const result = await guard.completeUpgradeAndResume({
    email: "user@example.com",
    token: "123456",
    pending: { checkoutContext: { planId: "pro-monthly" } }
  });

  assert.equal(result.action, ACTION.UPGRADE_INCOMPLETE);
  assert.equal(result.authState.isOfficialUser, false);
  assert.deepEqual(result.pending, { checkoutContext: { planId: "pro-monthly" } });
});

// --- Existing Account Login (P-AUTH-04.2 hotfix, spec Section 7) ---

const EXISTING_UUID = "33333333-3333-3333-3333-333333333333";

test("startUpgrade: EMAIL_ALREADY_REGISTERED is passed through unchanged so the caller can switch to startLoginOtp", async () => {
  const sendResult = { ok: false, error: { code: "EMAIL_ALREADY_REGISTERED", message: "此 Email 已經有帳號，請改用驗證碼登入既有帳號。" } };
  const guard = createSubscriptionEntryGuard({ emailOtpService: createEmailOtpServiceMock({ sendResult }) });

  const result = await guard.startUpgrade({ email: "user@example.com" });

  assert.deepEqual(result, sendResult);
});

test("startLoginOtp: delegates to emailOtpService.sendLoginOtp unchanged, forwarding captchaToken", async () => {
  const loginSendResult = { ok: true, data: { email: "user@example.com" } };
  let capturedInput = null;
  const emailOtpService = createEmailOtpServiceMock({ loginSendResult });
  emailOtpService.sendLoginOtp = async (input) => {
    capturedInput = input;
    return loginSendResult;
  };
  const guard = createSubscriptionEntryGuard({ emailOtpService });

  const result = await guard.startLoginOtp({ email: "user@example.com", captchaToken: "turnstile-token-abc" });

  assert.deepEqual(result, loginSendResult);
  assert.deepEqual(capturedInput, { email: "user@example.com", captchaToken: "turnstile-token-abc" });
});

test("beginAccountMerge: delegates to accountMergeService.beginAccountMerge unchanged (P-AUTH-05B-1, must be called BEFORE startLoginOtp per requirement 3)", async () => {
  const accountMergeService = createAccountMergeServiceMock({
    beginResult: { ok: true, data: { claimToken: "raw-claim-token", expiresAt: "2026-01-01T00:15:00.000Z" } }
  });
  const guard = createSubscriptionEntryGuard({ emailOtpService: createEmailOtpServiceMock(), accountMergeService });

  const result = await guard.beginAccountMerge({ email: "user@example.com" });

  assert.deepEqual(result, { ok: true, data: { claimToken: "raw-claim-token", expiresAt: "2026-01-01T00:15:00.000Z" } });
  assert.deepEqual(accountMergeService.beginCalls[0], { email: "user@example.com" });
});

test("completeLoginAndResume: successful login to a DIFFERENT existing account, but NO merge Edge Function configured yet (real default) -> existing_account_merge_required, NEVER auto-resumes Checkout, reports non-retryable MERGE_NOT_SUPPORTED", async () => {
  const { session, user } = officialSessionAndUser(EXISTING_UUID);
  const loginVerifyResult = {
    ok: true,
    data: {
      authUserId: EXISTING_UUID,
      authState: require("../auth-service").resolveAuthState({ session, user })
    }
  };
  const guard = createSubscriptionEntryGuard({ emailOtpService: createEmailOtpServiceMock({ loginVerifyResult }) });

  const result = await guard.completeLoginAndResume({
    email: "user@example.com",
    token: "123456",
    pending: { checkoutContext: { planId: "pro-monthly" } },
    claimToken: "raw-claim-token"
  });

  assert.equal(result.action, ACTION.EXISTING_ACCOUNT_MERGE_REQUIRED);
  assert.equal(result.authState.isOfficialUser, true);
  assert.notEqual(result.action, ACTION.ENTER_CHECKOUT);
  assert.equal(result.checkoutContext, undefined);
  assert.equal(result.retryable, false);
  assert.equal(result.mergeError.code, "MERGE_NOT_SUPPORTED");
  assert.deepEqual(result.pending, { checkoutContext: { planId: "pro-monthly" } });
});

test("completeLoginAndResume: merge succeeds (real Edge Function) -> auto-resumes the ORIGINAL pending Checkout, forwarding claimToken unchanged (P-AUTH-05B-1)", async () => {
  const { session, user } = officialSessionAndUser(EXISTING_UUID);
  const loginVerifyResult = {
    ok: true,
    data: {
      authUserId: EXISTING_UUID,
      authState: require("../auth-service").resolveAuthState({ session, user })
    }
  };
  const accountMergeService = createAccountMergeServiceMock({ mergeResult: { ok: true, data: { merged: true, mergeId: "m-1" } } });
  const guard = createSubscriptionEntryGuard({
    emailOtpService: createEmailOtpServiceMock({ loginVerifyResult }),
    accountMergeService
  });

  const result = await guard.completeLoginAndResume({
    email: "user@example.com",
    token: "123456",
    pending: { checkoutContext: { planId: "pro-monthly" } },
    claimToken: "raw-claim-token"
  });

  assert.equal(result.action, ACTION.ENTER_CHECKOUT);
  assert.deepEqual(result.checkoutContext, { planId: "pro-monthly" });
  assert.equal(result.authState.isOfficialUser, true);
  assert.equal(accountMergeService.calls.length, 1);
  assert.deepEqual(accountMergeService.calls[0], { claimToken: "raw-claim-token" });
});

test("completeLoginAndResume: merge fails but is retryable (transient failure) -> existing_account_merge_required with retryable:true, pending preserved", async () => {
  const { session, user } = officialSessionAndUser(EXISTING_UUID);
  const loginVerifyResult = {
    ok: true,
    data: {
      authUserId: EXISTING_UUID,
      authState: require("../auth-service").resolveAuthState({ session, user })
    }
  };
  const accountMergeService = createAccountMergeServiceMock({
    mergeResult: { ok: false, error: { code: "MERGE_FAILED", message: "合併資料時發生錯誤，請稍後再試一次。", retryable: true, rawMessage: null } }
  });
  const guard = createSubscriptionEntryGuard({
    emailOtpService: createEmailOtpServiceMock({ loginVerifyResult }),
    accountMergeService
  });

  const result = await guard.completeLoginAndResume({
    email: "user@example.com",
    token: "123456",
    pending: { checkoutContext: { planId: "pro-monthly" } },
    claimToken: "raw-claim-token"
  });

  assert.equal(result.action, ACTION.EXISTING_ACCOUNT_MERGE_REQUIRED);
  assert.equal(result.retryable, true);
  assert.equal(result.mergeError.code, "MERGE_FAILED");
  assert.deepEqual(result.pending, { checkoutContext: { planId: "pro-monthly" } });
});

test("completeLoginAndResume: retrying with the SAME claimToken forwards the SAME token on every attempt (safe retry, P-AUTH-05A.1)", async () => {
  const { session, user } = officialSessionAndUser(EXISTING_UUID);
  const loginVerifyResult = {
    ok: true,
    data: {
      authUserId: EXISTING_UUID,
      authState: require("../auth-service").resolveAuthState({ session, user })
    }
  };
  const accountMergeService = createAccountMergeServiceMock({
    mergeResult: { ok: false, error: { code: "MERGE_FAILED", message: "...", retryable: true } }
  });
  const guard = createSubscriptionEntryGuard({
    emailOtpService: createEmailOtpServiceMock({ loginVerifyResult }),
    accountMergeService
  });

  await guard.completeLoginAndResume({
    email: "user@example.com",
    token: "123456",
    pending: { checkoutContext: { planId: "pro-monthly" } },
    claimToken: "raw-claim-token"
  });
  await guard.completeLoginAndResume({
    email: "user@example.com",
    token: "123456",
    pending: { checkoutContext: { planId: "pro-monthly" } },
    claimToken: "raw-claim-token"
  });

  assert.equal(accountMergeService.calls.length, 2);
  assert.equal(accountMergeService.calls[0].claimToken, accountMergeService.calls[1].claimToken);
});

test("completeLoginAndResume: verify failure -> login_failed, pending preserved for retry", async () => {
  const loginVerifyResult = { ok: false, error: { code: "LOGIN_OTP_VERIFY_FAILED", message: "驗證碼錯誤或已逾期，請重新輸入或重新寄送。" } };
  const guard = createSubscriptionEntryGuard({ emailOtpService: createEmailOtpServiceMock({ loginVerifyResult }) });

  const result = await guard.completeLoginAndResume({
    email: "user@example.com",
    token: "000000",
    pending: { checkoutContext: { planId: "pro-monthly" } }
  });

  assert.equal(result.action, ACTION.LOGIN_FAILED);
  assert.equal(result.error.code, "LOGIN_OTP_VERIFY_FAILED");
  assert.deepEqual(result.pending, { checkoutContext: { planId: "pro-monthly" } });
});

// P-AUTH-04 hotfix: otpPurpose ("email") must be threaded through unchanged
// from the caller into emailOtpService.verifyLoginOtp too.
test("completeLoginAndResume: forwards otpPurpose unchanged to emailOtpService.verifyLoginOtp", async () => {
  const loginVerifyResult = { ok: false, error: { code: "LOGIN_OTP_VERIFY_FAILED", message: "..." } };
  let capturedInput = null;
  const emailOtpService = createEmailOtpServiceMock({ loginVerifyResult });
  emailOtpService.verifyLoginOtp = async (input) => {
    capturedInput = input;
    return loginVerifyResult;
  };
  const guard = createSubscriptionEntryGuard({ emailOtpService });

  await guard.completeLoginAndResume({
    email: "user@example.com",
    token: "000000",
    pending: { checkoutContext: { planId: "pro-monthly" } },
    otpPurpose: "email"
  });

  assert.equal(capturedInput.otpPurpose, "email");
});
