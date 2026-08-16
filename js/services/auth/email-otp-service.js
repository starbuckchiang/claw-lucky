"use strict";

/**
 * Email OTP Upgrade Service (P-AUTH-02)
 *
 * Upgrades an Anonymous User (Supabase Anonymous Auth) to an Official User
 * via Email OTP, per specs/003-spec-auth-subscription.md Sections 4-6:
 *
 *   Anonymous Auth -> updateUser({ email }) sends OTP -> verifyOtp() ->
 *   Email verified -> Anonymous Upgrade -> Official User
 *
 * Uses Supabase's OFFICIAL anonymous-upgrade mechanism (calling
 * `auth.updateUser({ email })` / `auth.verifyOtp()` on the EXISTING
 * anonymous session) so the Auth UUID is preserved and NO new Auth User is
 * ever created (Section 5, UUID Preservation) for the upgrade path —
 * `sendUpgradeOtp`/`verifyUpgradeOtp` never call `signUp`/`signInWithOtp`,
 * which would create a separate identity.
 *
 * This module does its own I/O via an injected `authClient` (dependency
 * injection, matching the style of the other `js/services/**` modules,
 * e.g. generation-repository.js's injected supabaseClient) so it stays
 * unit-testable under `node --test` without a real Supabase project.
 *
 * Hotfix (P-AUTH-04.2): when `sendUpgradeOtp` targets an email that already
 * belongs to a DIFFERENT, already-registered account, Supabase's
 * `updateUser({ email })` call fails with an "already registered" error —
 * previously this raw English error was surfaced directly to the UI and
 * the flow simply broke. `sendUpgradeOtp` now detects this case and returns
 * `EMAIL_ALREADY_REGISTERED`; the caller should then use the new
 * `sendLoginOtp`/`verifyLoginOtp` pair below (Existing Account Login, spec
 * Section 7) instead, which uses `signInWithOtp({ shouldCreateUser: false })`
 * so it can NEVER create a duplicate Auth User.
 *
 * Still explicitly OUT of scope for this module: Subscription Checkout,
 * Payment, Webhook, and the actual Existing Account Data MERGE (Cart/
 * Mascot/Gift/Points/Subscription per spec Section 7) — logging in via
 * `sendLoginOtp`/`verifyLoginOtp` only authenticates the existing account;
 * it never touches or merges the anonymous user's data (see
 * subscription-entry-guard.js's `EXISTING_ACCOUNT_MERGE_REQUIRED`).
 */

// Node/tests: `require` is available. Browser: no `require()` exists, so
// auth-service.js must be loaded via its own <script> tag BEFORE this file
// (registers `window.AuthService`). This keeps the module usable both ways
// without a bundler, matching the dual CJS/browser export pattern below.
//
// NAMED `resolveAuthStateFn` (not `resolveAuthState`) deliberately: classic
// (non-module) <script> tags share ONE global lexical scope, and
// auth-service.js already declares a top-level `function resolveAuthState`
// (which also becomes a global binding). Reusing the same name here as a
// top-level `const` would throw `SyntaxError: Identifier 'resolveAuthState'
// has already been declared` the moment both scripts are loaded on the same
// page — a parse-time error that silently prevents this ENTIRE file from
// executing, leaving `window.EmailOtpService` undefined (P-AUTH-04 hotfix).
const resolveAuthStateFn = (function loadResolveAuthState() {
  if (typeof module !== "undefined" && module.exports) {
    return require("./auth-service").resolveAuthState;
  }

  if (typeof window !== "undefined" && window.AuthService) {
    return window.AuthService.resolveAuthState;
  }

  throw new Error("email-otp-service.js requires auth-service.js to be loaded first.");
})();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Hotfix (P-AUTH-04.2): all user-facing messages must be zh-TW friendly
// text — the raw Supabase/GoTrue error string is NEVER shown to the UI
// directly (it is kept only under `details.rawMessage` for logs/debugging).
const FRIENDLY_MESSAGES = Object.freeze({
  INVALID_EMAIL: "請輸入正確的 Email 格式。",
  OTP_SEND_FAILED: "驗證碼寄送失敗，請稍後再試。",
  EMAIL_ALREADY_REGISTERED: "此 Email 已經有帳號，請改用驗證碼登入既有帳號。",
  INVALID_OTP: "請輸入 6～8 碼數字驗證碼。",
  OTP_VERIFY_FAILED: "驗證碼錯誤或已逾期，請重新輸入或重新寄送。",
  AUTH_UUID_MISMATCH: "身份升級發生異常，請重新整理頁面後再試一次。",
  LOGIN_OTP_SEND_FAILED: "登入驗證碼寄送失敗，請稍後再試。",
  LOGIN_OTP_VERIFY_FAILED: "登入驗證碼錯誤或已逾期，請重新輸入或重新寄送。"
});

function errorDto(code, message, details = null) {
  return {
    ok: false,
    error: {
      code: String(code),
      message: String(message),
      details: details || null
    }
  };
}

function isValidEmail(email) {
  return typeof email === "string" && EMAIL_PATTERN.test(email.trim());
}

// Supabase's Email OTP token length is NOT fixed at 6 digits in every
// project configuration — it can be 6 to 8 digits depending on the Auth
// project's OTP settings. This is only a cheap client-side SHAPE check
// (numeric, 6-8 digits) to fail fast on obviously-wrong input (empty,
// letters, way too short/long) before making a network call; the actual
// correctness of the code is always determined by Supabase's own
// `verifyOtp()` call, never guessed or hardcoded here.
const OTP_TOKEN_PATTERN = /^\d{6,8}$/;

function isValidOtpToken(token) {
  return typeof token === "string" && OTP_TOKEN_PATTERN.test(token.trim());
}

// Detects the specific Supabase Auth failure that happens when
// `updateUser({ email })` (Anonymous Upgrade) is called with an email that
// already belongs to a DIFFERENT, already-registered account. Supabase
// returns this as an error rather than throwing, with either a dedicated
// `code` (newer GoTrue versions: "email_exists") or only an English message
// (older versions: e.g. "A user with this email address has already been
// registered") — both shapes are checked since the exact shape isn't
// guaranteed across Supabase versions.
function isEmailAlreadyRegisteredError(error) {
  if (!error) {
    return false;
  }

  if (error.code === "email_exists" || error.code === "user_already_exists") {
    return true;
  }

  const message = String(error.message || "").toLowerCase();
  return message.includes("already") && (message.includes("registered") || message.includes("exists"));
}

// UUID Preservation check (spec Section 5): the upgraded user's id MUST be
// byte-for-byte the same as the anonymous user's id BEFORE upgrade. Kept as
// its own exported function so it has a single, independently-testable home.
function isUuidPreserved(previousAuthUserId, upgradedAuthUserId) {
  const previous = String(previousAuthUserId || "").trim();
  const upgraded = String(upgradedAuthUserId || "").trim();
  return Boolean(previous) && Boolean(upgraded) && previous === upgraded;
}

function createEmailOtpService({ authClient }) {
  if (
    !authClient ||
    typeof authClient.updateUser !== "function" ||
    typeof authClient.verifyOtp !== "function" ||
    typeof authClient.refreshSession !== "function" ||
    typeof authClient.getSession !== "function" ||
    typeof authClient.signInWithOtp !== "function"
  ) {
    throw new Error(
      "createEmailOtpService requires authClient.updateUser(...), authClient.verifyOtp(...), authClient.refreshSession(...), authClient.getSession(...) and authClient.signInWithOtp(...)."
    );
  }

  // Sends the OTP to the given email against the CURRENT (anonymous)
  // session. Must be called while already signed in anonymously — Supabase
  // attaches the email to the existing Auth UUID rather than creating a
  // new user.
  async function sendUpgradeOtp({ email } = {}) {
    const normalizedEmail = String(email || "").trim();

    if (!isValidEmail(normalizedEmail)) {
      return errorDto("INVALID_EMAIL", FRIENDLY_MESSAGES.INVALID_EMAIL);
    }

    let result;
    try {
      result = await authClient.updateUser({ email: normalizedEmail });
    } catch (error) {
      // Hotfix-of-hotfix (P-AUTH-04.2 E2E finding): some supabase-js
      // versions/environments THROW an AuthApiError instead of resolving
      // with `{ data, error }` for this exact "already registered" case —
      // the "already registered" detection must run here too, not only on
      // the resolved-with-error branch below, otherwise it silently
      // degrades to a useless generic OTP_SEND_FAILED and the user is
      // never routed to the Existing Account Login flow.
      if (isEmailAlreadyRegisteredError(error)) {
        return errorDto(
          "EMAIL_ALREADY_REGISTERED",
          FRIENDLY_MESSAGES.EMAIL_ALREADY_REGISTERED,
          { requiresLogin: true, rawMessage: error?.message || null }
        );
      }

      // TEMPORARY diagnostic (P-AUTH-04.2 E2E investigation): logs the raw
      // thrown error's shape so the ACTUAL Supabase error code/message can
      // be inspected in the browser console when isEmailAlreadyRegisteredError
      // doesn't match what's expected. Never shown in the UI. Remove once
      // the exact error shape is confirmed.
      console.warn("[EmailOtpService] sendUpgradeOtp: updateUser() threw", {
        name: error?.name || null,
        code: error?.code || null,
        status: error?.status || null,
        message: error?.message || null
      });

      return errorDto("OTP_SEND_FAILED", FRIENDLY_MESSAGES.OTP_SEND_FAILED, { rawMessage: error?.message || null });
    }

    if (result?.error) {
      // Existing Account (spec Section 7): the email already belongs to a
      // different, already-registered user. Anonymous Upgrade MUST NOT
      // proceed here (it would fail again anyway) and MUST NOT create a
      // duplicate account — the caller (Subscription Entry Guard/UI) is
      // signalled via this dedicated code to switch to the Email OTP LOGIN
      // flow (`sendLoginOtp`/`verifyLoginOtp`) instead.
      if (isEmailAlreadyRegisteredError(result.error)) {
        return errorDto(
          "EMAIL_ALREADY_REGISTERED",
          FRIENDLY_MESSAGES.EMAIL_ALREADY_REGISTERED,
          { requiresLogin: true, rawMessage: result.error.message || null }
        );
      }

      // TEMPORARY diagnostic (P-AUTH-04.2 E2E investigation): same as above,
      // for the resolved-with-error shape.
      console.warn("[EmailOtpService] sendUpgradeOtp: updateUser() resolved with error", {
        code: result.error.code || null,
        status: result.error.status || null,
        message: result.error.message || null
      });

      return errorDto("OTP_SEND_FAILED", FRIENDLY_MESSAGES.OTP_SEND_FAILED, { rawMessage: result.error.message || null });
    }

    // Hotfix (P-AUTH-04 hotfix): `updateUser({ email })` triggers Supabase's
    // "email_change" OTP flow, NOT the "email" (sign-in) OTP flow used by
    // `signInWithOtp()`. The verify step MUST use the matching `type`, so
    // this is returned here and threaded through the whole round trip
    // (resend re-derives it the same way; verify receives it explicitly)
    // instead of being hardcoded/guessed at the verify call site.
    return {
      ok: true,
      data: { email: normalizedEmail, otpPurpose: "email_change" }
    };
  }

  // Verifies the OTP and completes the Anonymous Upgrade. `previousAuthUserId`
  // is the Auth UUID captured BEFORE this call (e.g. from
  // AuthService.resolveAuthState()/ClawUser.getAuthUser()) — required to
  // enforce UUID Preservation (spec Section 5). `otpPurpose` MUST be the
  // exact value returned by `sendUpgradeOtp()` ("email_change") — never
  // hardcoded here, since a mismatched `type` causes Supabase to reject an
  // otherwise-correct OTP code as invalid/expired.
  async function verifyUpgradeOtp({ email, token, previousAuthUserId, otpPurpose } = {}) {
    const normalizedEmail = String(email || "").trim();
    const normalizedToken = String(token || "").trim();
    const purpose = String(otpPurpose || "email_change").trim();

    if (!isValidEmail(normalizedEmail)) {
      return errorDto("INVALID_EMAIL", FRIENDLY_MESSAGES.INVALID_EMAIL);
    }

    if (!isValidOtpToken(normalizedToken)) {
      return errorDto("INVALID_OTP", FRIENDLY_MESSAGES.INVALID_OTP);
    }

    let result;
    try {
      result = await authClient.verifyOtp({
        email: normalizedEmail,
        token: normalizedToken,
        type: purpose
      });
    } catch (error) {
      return errorDto("OTP_VERIFY_FAILED", FRIENDLY_MESSAGES.OTP_VERIFY_FAILED, { rawMessage: error?.message || null });
    }

    if (result?.error) {
      return errorDto("OTP_VERIFY_FAILED", FRIENDLY_MESSAGES.OTP_VERIFY_FAILED, { rawMessage: result.error.message || null });
    }

    const session = result?.data?.session || null;
    const user = result?.data?.user || null;
    const upgradedAuthUserId = String(user?.id || "").trim();

    if (!upgradedAuthUserId) {
      return errorDto("OTP_VERIFY_FAILED", FRIENDLY_MESSAGES.OTP_VERIFY_FAILED);
    }

    if (previousAuthUserId && !isUuidPreserved(previousAuthUserId, upgradedAuthUserId)) {
      return errorDto(
        "AUTH_UUID_MISMATCH",
        FRIENDLY_MESSAGES.AUTH_UUID_MISMATCH,
        { previousAuthUserId: String(previousAuthUserId), upgradedAuthUserId }
      );
    }

    // Hotfix (P-AUTH-02-hotfix): the browser's existing session cache still
    // holds the PRE-upgrade JWT immediately after verifyOtp() resolves
    // (E2E-observed: is_anonymous stayed true until a manual
    // refreshSession()). Force a refresh and re-read the session so the
    // Authentication State returned below is always built from the
    // freshest post-upgrade JWT/user, never the stale one.
    let refreshResult;
    try {
      refreshResult = await authClient.refreshSession();
    } catch (error) {
      return errorDto("OTP_VERIFY_FAILED", FRIENDLY_MESSAGES.OTP_VERIFY_FAILED, { rawMessage: error?.message || null });
    }

    if (refreshResult?.error) {
      return errorDto("OTP_VERIFY_FAILED", FRIENDLY_MESSAGES.OTP_VERIFY_FAILED, { rawMessage: refreshResult.error.message || null });
    }

    let sessionResult;
    try {
      sessionResult = await authClient.getSession();
    } catch (error) {
      return errorDto("OTP_VERIFY_FAILED", FRIENDLY_MESSAGES.OTP_VERIFY_FAILED, { rawMessage: error?.message || null });
    }

    if (sessionResult?.error) {
      return errorDto("OTP_VERIFY_FAILED", FRIENDLY_MESSAGES.OTP_VERIFY_FAILED, { rawMessage: sessionResult.error.message || null });
    }

    const latestSession = sessionResult?.data?.session || session;
    const latestUser = latestSession?.user || user;

    return {
      ok: true,
      data: {
        authUserId: upgradedAuthUserId,
        authState: resolveAuthStateFn({ session: latestSession, user: latestUser })
      }
    };
  }

  // Existing Account Login (specs/003-spec-auth-subscription.md Section 7):
  // used when `sendUpgradeOtp` reports EMAIL_ALREADY_REGISTERED. Uses
  // Supabase's normal Email OTP sign-in against the EXISTING account, with
  // `shouldCreateUser: false` so it can NEVER create a duplicate Auth User
  // for this email (requirement: 禁止建立重複帳號). This intentionally does
  // NOT touch the current anonymous session/UUID — merging the anonymous
  // user's data into this existing account is a separate, not-yet-built
  // mechanism (see subscription-entry-guard.js `EXISTING_ACCOUNT_MERGE_REQUIRED`).
  //
  // Hotfix-of-hotfix (P-AUTH-04.2 E2E finding #2): unlike `updateUser()`
  // (an authenticated PATCH on the current user, not subject to Captcha),
  // `signInWithOtp()` is a PUBLIC sign-in entrypoint and this project has
  // Supabase Auth Captcha (Cloudflare Turnstile) protection enabled — see
  // `js/user.js`'s `signInAnonymously({ options: { captchaToken } })`.
  // Without a `captchaToken`, Supabase rejects the request with
  // `400 Bad Request` ("captcha protection: request disallowed"). The
  // caller (subscription-entry.js) must obtain a fresh token (e.g. via
  // `window.UserStore.verifyTurnstile()`) and pass it through here.
  async function sendLoginOtp({ email, captchaToken } = {}) {
    const normalizedEmail = String(email || "").trim();

    if (!isValidEmail(normalizedEmail)) {
      return errorDto("INVALID_EMAIL", FRIENDLY_MESSAGES.INVALID_EMAIL);
    }

    let result;
    try {
      result = await authClient.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: false, captchaToken }
      });
    } catch (error) {
      console.warn("[EmailOtpService] sendLoginOtp: signInWithOtp() threw", {
        name: error?.name || null,
        code: error?.code || null,
        status: error?.status || null,
        message: error?.message || null
      });

      return errorDto("LOGIN_OTP_SEND_FAILED", FRIENDLY_MESSAGES.LOGIN_OTP_SEND_FAILED, { rawMessage: error?.message || null });
    }

    if (result?.error) {
      console.warn("[EmailOtpService] sendLoginOtp: signInWithOtp() resolved with error", {
        code: result.error.code || null,
        status: result.error.status || null,
        message: result.error.message || null
      });

      return errorDto("LOGIN_OTP_SEND_FAILED", FRIENDLY_MESSAGES.LOGIN_OTP_SEND_FAILED, { rawMessage: result.error.message || null });
    }

    return {
      ok: true,
      data: { email: normalizedEmail, otpPurpose: "email" }
    };
  }

  // Verifies the login OTP for an Existing Account (see sendLoginOtp above).
  // Deliberately does NOT enforce UUID Preservation — the whole point of
  // this path is that the resulting session belongs to a DIFFERENT,
  // pre-existing Auth UUID than the anonymous user who started the flow.
  // `otpPurpose` MUST be the value returned by `sendLoginOtp()` ("email") —
  // never hardcoded here, for the same reason as `verifyUpgradeOtp` above.
  async function verifyLoginOtp({ email, token, otpPurpose } = {}) {
    const normalizedEmail = String(email || "").trim();
    const normalizedToken = String(token || "").trim();
    const purpose = String(otpPurpose || "email").trim();

    if (!isValidEmail(normalizedEmail)) {
      return errorDto("INVALID_EMAIL", FRIENDLY_MESSAGES.INVALID_EMAIL);
    }

    if (!isValidOtpToken(normalizedToken)) {
      return errorDto("INVALID_OTP", FRIENDLY_MESSAGES.INVALID_OTP);
    }

    let result;
    try {
      result = await authClient.verifyOtp({
        email: normalizedEmail,
        token: normalizedToken,
        type: purpose
      });
    } catch (error) {
      return errorDto("LOGIN_OTP_VERIFY_FAILED", FRIENDLY_MESSAGES.LOGIN_OTP_VERIFY_FAILED, { rawMessage: error?.message || null });
    }

    if (result?.error) {
      return errorDto("LOGIN_OTP_VERIFY_FAILED", FRIENDLY_MESSAGES.LOGIN_OTP_VERIFY_FAILED, { rawMessage: result.error.message || null });
    }

    const session = result?.data?.session || null;
    const user = result?.data?.user || session?.user || null;
    const authUserId = String(user?.id || "").trim();

    if (!authUserId) {
      return errorDto("LOGIN_OTP_VERIFY_FAILED", FRIENDLY_MESSAGES.LOGIN_OTP_VERIFY_FAILED);
    }

    return {
      ok: true,
      data: {
        authUserId,
        authState: resolveAuthStateFn({ session, user })
      }
    };
  }

  return {
    sendUpgradeOtp,
    verifyUpgradeOtp,
    sendLoginOtp,
    verifyLoginOtp
  };
}

const emailOtpServiceApi = {
  createEmailOtpService,
  isUuidPreserved,
  isEmailAlreadyRegisteredError,
  isValidOtpToken
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = emailOtpServiceApi;
}

if (typeof window !== "undefined") {
  window.EmailOtpService = emailOtpServiceApi;
}
