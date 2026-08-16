"use strict";

/**
 * Subscription Entry Guard (P-AUTH-03)
 *
 * Implements specs/003-spec-auth-subscription.md Section 8 (Subscription
 * Flow) up to — but NOT including — Checkout creation itself:
 *
 *   Visitor/Anonymous -> click "Subscribe" -> isOfficialUser()? ->
 *     Yes -> enter Checkout
 *     No  -> Email OTP -> Upgrade -> resume original Checkout intent
 *
 * This module is a pure orchestrator: it makes NO Supabase calls itself and
 * touches no DOM/localStorage. It composes the already-reviewed P-AUTH-01
 * Auth Service (`resolveAuthState`, which internally calls `isOfficialUser`)
 * and P-AUTH-02 Email OTP Service (`sendUpgradeOtp`/`verifyUpgradeOtp`) via
 * dependency injection, matching the style of the other `js/services/**`
 * orchestrators (e.g. generation-orchestrator.js composing smaller
 * services). This keeps it unit-testable and reusable from the browser via
 * the same dual-export pattern.
 *
 * "不重整頁面" (no page reload) / "保留目前頁面與操作狀態": this module never
 * navigates or reloads anything — it only returns a plain `action` result
 * describing what the caller (frontend) should do next. The ORIGINAL
 * subscription intent (`checkoutContext`, e.g. which plan was clicked) is
 * carried through the whole Upgrade round-trip via the returned `pending`
 * object, so the caller can resume Checkout with the exact same context
 * once `completeUpgradeAndResume()` succeeds (Return-to-Checkout Flow).
 *
 * Hotfix (P-AUTH-04.2, Existing Account Login): if the email the user
 * enters already belongs to a DIFFERENT, already-registered account,
 * `startUpgrade()` returns `EMAIL_ALREADY_REGISTERED` instead of upgrading
 * (never creates a duplicate account). The caller should then use
 * `beginAccountMerge()` (BEFORE `startLoginOtp()`, per requirement 3) then
 * `startLoginOtp()`/`completeLoginAndResume()`, which log into that
 * EXISTING account (spec Section 7) via OTP with `shouldCreateUser: false`.
 * A successful Existing Account Login auto-resumes the pending Checkout
 * ONLY if the merge (P-AUTH-05B-1's Begin/Finalize contract) also
 * succeeds — any merge failure (including "not deployed/configured yet")
 * returns `EXISTING_ACCOUNT_MERGE_REQUIRED` as a blocker instead, never a
 * silent/implicit merge.
 *
 * Explicitly OUT of scope for this module (per prompts-auth-03.md):
 * Payment, Webhook, actual Subscription activation, Existing Account Merge
 * (spec Section 7) — those all happen strictly AFTER Checkout is entered.
 */

// Node/tests: `require` is available. Browser: no `require()` exists, so
// auth-service.js must be loaded via its own <script> tag BEFORE this file
// (registers `window.AuthService`). This keeps the module usable both ways
// without a bundler, matching the dual CJS/browser export pattern below.
const authServiceDefault = (function loadDefaultAuthService() {
  if (typeof module !== "undefined" && module.exports) {
    return require("./auth-service");
  }

  if (typeof window !== "undefined" && window.AuthService) {
    return window.AuthService;
  }

  return null;
})();

// Same dual-load pattern as authServiceDefault above. Defaults to the
// "no mergeRpcClient configured" instance (see account-merge-service.js),
// which ALWAYS honestly reports MERGE_NOT_SUPPORTED until a real merge
// RPC/Edge Function exists (ADR-009) — never a silent no-op success.
const accountMergeServiceDefault = (function loadDefaultAccountMergeService() {
  if (typeof module !== "undefined" && module.exports) {
    return require("./account-merge-service").createAccountMergeService();
  }

  if (typeof window !== "undefined" && window.AccountMergeService) {
    return window.AccountMergeService.createAccountMergeService();
  }

  return null;
})();

const ACTION = Object.freeze({
  ENTER_CHECKOUT: "enter_checkout",
  START_EMAIL_OTP_UPGRADE: "start_email_otp_upgrade",
  UPGRADE_FAILED: "upgrade_failed",
  UPGRADE_INCOMPLETE: "upgrade_incomplete",
  // Hotfix (P-AUTH-04.2): the email the user entered already belongs to a
  // DIFFERENT, already-registered account — Anonymous Upgrade must not
  // proceed (never create a duplicate account); the caller should switch to
  // `startLoginOtp`/`completeLoginAndResume` (Existing Account Login, spec
  // Section 7) instead.
  START_EMAIL_OTP_LOGIN: "start_email_otp_login",
  LOGIN_FAILED: "login_failed",
  // Login into the Existing Account succeeded (user IS a valid Official
  // User now), but the Cart/Mascot/Gift/Points/Subscription merge
  // (P-AUTH-05B-1's Begin/Finalize contract) did not succeed — either it
  // isn't deployed/configured yet, or the merge itself failed. Per hotfix
  // requirement: NEVER auto-resume Checkout in this case — this is a
  // blocker, not a silent cross-UUID merge.
  EXISTING_ACCOUNT_MERGE_REQUIRED: "existing_account_merge_required"
});

function createSubscriptionEntryGuard({
  authService = authServiceDefault,
  emailOtpService,
  accountMergeService = accountMergeServiceDefault
} = {}) {
  if (!authService || typeof authService.resolveAuthState !== "function") {
    throw new Error("createSubscriptionEntryGuard requires authService.resolveAuthState(...).");
  }

  if (
    !emailOtpService ||
    typeof emailOtpService.sendUpgradeOtp !== "function" ||
    typeof emailOtpService.verifyUpgradeOtp !== "function" ||
    typeof emailOtpService.sendLoginOtp !== "function" ||
    typeof emailOtpService.verifyLoginOtp !== "function"
  ) {
    throw new Error(
      "createSubscriptionEntryGuard requires emailOtpService.sendUpgradeOtp(...), emailOtpService.verifyUpgradeOtp(...), emailOtpService.sendLoginOtp(...) and emailOtpService.verifyLoginOtp(...)."
    );
  }

  if (
    !accountMergeService ||
    typeof accountMergeService.beginAccountMerge !== "function" ||
    typeof accountMergeService.mergeAnonymousIntoExistingAccount !== "function"
  ) {
    throw new Error(
      "createSubscriptionEntryGuard requires accountMergeService.beginAccountMerge(...) and accountMergeService.mergeAnonymousIntoExistingAccount(...)."
    );
  }

  // Step 1: called when the user clicks "Subscribe". Decides whether to go
  // straight to Checkout or start the Email OTP Upgrade flow first.
  function evaluateSubscriptionEntry({ session, user, checkoutContext = null } = {}) {
    const authState = authService.resolveAuthState({ session, user });

    if (authState.isOfficialUser) {
      return {
        action: ACTION.ENTER_CHECKOUT,
        authState,
        checkoutContext
      };
    }

    return {
      action: ACTION.START_EMAIL_OTP_UPGRADE,
      authState,
      pending: { checkoutContext }
    };
  }

  // Step 2: thin passthrough so the Guard stays the single call site the
  // frontend needs, without duplicating P-AUTH-02's own validation/logic.
  async function startUpgrade({ email } = {}) {
    return emailOtpService.sendUpgradeOtp({ email });
  }

  // Step 3: verifies the OTP (delegates UUID Preservation + refreshed
  // Authentication State to P-AUTH-02) and, if the user is now Official,
  // resumes the ORIGINAL subscription intent instead of making the caller
  // re-evaluate/re-click anything. `otpPurpose` MUST be the value returned
  // by `startUpgrade()` (i.e. `sendUpgradeOtp()`'s `data.otpPurpose`,
  // "email_change") — passed through unchanged, never re-derived here.
  async function completeUpgradeAndResume({ email, token, previousAuthUserId, pending = null, otpPurpose } = {}) {
    const verifyResult = await emailOtpService.verifyUpgradeOtp({ email, token, previousAuthUserId, otpPurpose });

    if (!verifyResult.ok) {
      return {
        action: ACTION.UPGRADE_FAILED,
        error: verifyResult.error,
        pending
      };
    }

    const { authState } = verifyResult.data;

    if (!authState.isOfficialUser) {
      // verifyOtp() itself succeeded, but the full Official User definition
      // (spec Section 3) still isn't met (e.g. Google identity missing) —
      // never force Checkout for a non-Official state.
      return {
        action: ACTION.UPGRADE_INCOMPLETE,
        authState,
        pending
      };
    }

    return {
      action: ACTION.ENTER_CHECKOUT,
      authState,
      checkoutContext: pending?.checkoutContext ?? null
    };
  }

  // Existing Account Login (spec Section 7) — Step 2 equivalent for an
  // email that already belongs to a different, already-registered account
  // (`sendUpgradeOtp` returned EMAIL_ALREADY_REGISTERED). Thin passthrough,
  // matching `startUpgrade`'s style. `captchaToken` is required by
  // `sendLoginOtp` (Supabase Captcha protection on the public
  // `signInWithOtp` endpoint) and is passed through unchanged.
  async function startLoginOtp({ email, captchaToken } = {}) {
    return emailOtpService.sendLoginOtp({ email, captchaToken });
  }

  // Begin Merge (P-AUTH-05B-1): MUST be called while the caller still
  // holds its ANONYMOUS session, BEFORE `startLoginOtp()` sends the
  // Existing Account Login OTP (requirement 3) — the resulting
  // `claimToken` is the ONLY thing carried across the login round trip
  // (held in the caller's own in-memory page state, never localStorage/
  // sessionStorage) and later passed to `completeLoginAndResume()` below.
  // Thin passthrough, matching `startLoginOtp`'s style.
  async function beginAccountMerge({ email } = {}) {
    return accountMergeService.beginAccountMerge({ email });
  }

  // Existing Account Login — Step 3 equivalent for completeUpgradeAndResume.
  // Unlike the Upgrade path, a successful login here does NOT immediately
  // resume the pending Checkout: the resulting session belongs to a
  // DIFFERENT Auth UUID than the anonymous user who started the flow, so
  // (per spec Section 7) the anonymous user's Cart/Mascot/Gift/Points data
  // must be safely merged first. `accountMergeService` (P-AUTH-04.3,
  // revised P-AUTH-05B-1) is the single place that attempts this.
  //
  // `claimToken` MUST be the RAW token returned by `beginAccountMerge()`
  // (never a hash, never re-derived here) — P-AUTH-05A.1 removed the
  // caller-supplied idempotency key concept entirely; the Finalize RPC
  // now computes its own canonical idempotency key server-side from the
  // claim + the caller's own verified existing-account id. This guard
  // never computes or forwards any idempotency key itself anymore.
  async function completeLoginAndResume({ email, token, pending = null, otpPurpose, claimToken } = {}) {
    const verifyResult = await emailOtpService.verifyLoginOtp({ email, token, otpPurpose });

    if (!verifyResult.ok) {
      return {
        action: ACTION.LOGIN_FAILED,
        error: verifyResult.error,
        pending
      };
    }

    const { authState } = verifyResult.data;

    if (!authState.isOfficialUser) {
      return {
        action: ACTION.UPGRADE_INCOMPLETE,
        authState,
        pending
      };
    }

    const mergeResult = await accountMergeService.mergeAnonymousIntoExistingAccount({ claimToken });

    if (!mergeResult.ok) {
      // Failure preserves `pending` (the original checkoutContext) so a
      // retry (same claimToken, still held in page memory) is always safe
      // to re-attempt; `retryable` lets the caller distinguish "try again"
      // from "this requires new backend infrastructure, retrying won't
      // help".
      return {
        action: ACTION.EXISTING_ACCOUNT_MERGE_REQUIRED,
        authState,
        pending,
        retryable: mergeResult.error.retryable,
        mergeError: mergeResult.error
      };
    }

    return {
      action: ACTION.ENTER_CHECKOUT,
      authState,
      checkoutContext: pending?.checkoutContext ?? null
    };
  }

  return {
    ACTION,
    evaluateSubscriptionEntry,
    startUpgrade,
    completeUpgradeAndResume,
    startLoginOtp,
    beginAccountMerge,
    completeLoginAndResume
  };
}

const subscriptionEntryGuardApi = {
  ACTION,
  createSubscriptionEntryGuard
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = subscriptionEntryGuardApi;
}

if (typeof window !== "undefined") {
  window.SubscriptionEntryGuard = subscriptionEntryGuardApi;
}
