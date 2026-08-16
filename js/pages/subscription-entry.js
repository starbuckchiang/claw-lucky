(function () {
  const authService = window.AuthService;
  const emailOtpServiceApi = window.EmailOtpService;
  const accountMergeServiceApi = window.AccountMergeService;
  const guardApi = window.SubscriptionEntryGuard;

  const refs = {
    planButtons: Array.from(document.querySelectorAll("[data-plan-id]")),
    otpPanel: document.getElementById("otpPanel"),
    otpStep1: document.getElementById("otpStep1"),
    otpStep2: document.getElementById("otpStep2"),
    emailInput: document.getElementById("otpEmailInput"),
    sendOtpBtn: document.getElementById("sendOtpBtn"),
    sendOtpStatus: document.getElementById("sendOtpStatus"),
    tokenInput: document.getElementById("otpTokenInput"),
    verifyOtpBtn: document.getElementById("verifyOtpBtn"),
    resendOtpBtn: document.getElementById("resendOtpBtn"),
    readyPanel: document.getElementById("readyPanel"),
    readyPlanLabel: document.getElementById("readyPlanLabel"),
    errorPanel: document.getElementById("errorPanel"),
    errorMessage: document.getElementById("errorMessage"),
    retryBtn: document.getElementById("retryBtn")
  };

  // Round-trip state carried across the Email OTP Upgrade (never persisted
  // to localStorage/reload — kept in memory only, since the whole point is
  // "no page reload / no state loss" within a single page session).
  let pendingGuard = null;
  let pendingPreviousAuthUserId = "";
  // aka "pendingNewEmail" for the Anonymous Upgrade (email_change) path —
  // captured once at send-time and reused verbatim for verify, never
  // re-read from a live input (the input is hidden during Step 2 anyway).
  let pendingEmail = "";
  // Hotfix (P-AUTH-04.2): "upgrade" (new email, Anonymous Upgrade) vs
  // "login" (email already belongs to an Existing Account, spec Section 7)
  // — decides which guard methods handleVerifyOtp() calls next.
  let pendingMode = "upgrade";
  // Hotfix (P-AUTH-04 hotfix): the exact Supabase OTP `type` used when the
  // code was actually SENT — "email_change" for Anonymous Upgrade
  // (updateUser), "email" for Existing Account Login (signInWithOtp). MUST
  // be threaded into the matching verify call unchanged; a mismatched type
  // causes Supabase to reject an otherwise-correct code as invalid/expired.
  let pendingOtpPurpose = null;
  // P-AUTH-05B-1: the RAW Account Merge claimToken returned by
  // `guard.beginAccountMerge()`, held ONLY in this page-scoped in-memory
  // variable — never written to localStorage/sessionStorage (requirement
  // 3). Cleared on reset/retry; null whenever Begin hasn't been called yet
  // or failed (a failed Begin never blocks the login flow itself — see
  // handleSendOtp below).
  let pendingClaimToken = null;

  function resetPendingOtpState() {
    pendingGuard = null;
    pendingEmail = "";
    pendingOtpPurpose = null;
    pendingMode = "upgrade";
    pendingClaimToken = null;
  }

  function planLabel(planId) {
    const button = refs.planButtons.find((btn) => btn.dataset.planId === planId);
    return button?.dataset.planLabel || planId;
  }

  function hideAll() {
    if (refs.otpPanel) refs.otpPanel.hidden = true;
    if (refs.otpStep2) refs.otpStep2.hidden = true;
    if (refs.readyPanel) refs.readyPanel.hidden = true;
    if (refs.errorPanel) refs.errorPanel.hidden = true;
  }

  function showError(message) {
    hideAll();
    if (refs.errorPanel) refs.errorPanel.hidden = false;
    if (refs.errorMessage) refs.errorMessage.textContent = message || "發生未預期的錯誤，請重試。";
  }

  function showReady(checkoutContext) {
    hideAll();
    if (refs.readyPanel) refs.readyPanel.hidden = false;
    if (refs.readyPlanLabel) refs.readyPlanLabel.textContent = planLabel(checkoutContext?.planId);
  }

  function showOtpStep1() {
    hideAll();
    if (refs.otpPanel) refs.otpPanel.hidden = false;
    if (refs.otpStep1) refs.otpStep1.hidden = false;
    if (refs.sendOtpStatus) refs.sendOtpStatus.textContent = "";
  }

  function showOtpStep2() {
    if (refs.otpPanel) refs.otpPanel.hidden = false;
    if (refs.otpStep1) refs.otpStep1.hidden = true;
    if (refs.otpStep2) refs.otpStep2.hidden = false;
  }

  async function getCurrentSessionAndUser() {
    if (window.userReadyPromise) {
      await window.userReadyPromise;
    }

    const { data, error } = await window.supabaseClient.auth.getSession();
    if (error) {
      throw error;
    }

    return { session: data?.session || null, user: data?.session?.user || null };
  }

  // P-AUTH-05B-1: thin `functions.invoke()` wrappers for the real
  // `account-merge/{begin,finalize}` Edge Function (supabase/functions/
  // account-merge/index.ts). Per this repo's Supabase rules, the merge
  // itself must never be performed by the browser directly (it spans two
  // different Auth UUIDs and needs the service-role key) — these wrappers
  // only carry an authenticated HTTP request; all privileged work happens
  // server-side in the Edge Function.
  //
  // supabase-js's `functions.invoke()` treats any non-2xx response as a
  // thrown-away `error` (`FunctionsHttpError`) — it does NOT surface this
  // app's own `{ok:false, error:{code,message}}` JSON body in `data` for
  // that case. The real body must be read back from `error.context` (the
  // raw `Response` object) by calling `.json()` on it, with a safe
  // generic fallback if that parsing itself fails for any reason.
  async function invokeAccountMergeFunction(path, body) {
    const { data, error } = await window.supabaseClient.functions.invoke(`account-merge/${path}`, { body });

    if (error) {
      try {
        const parsedBody = await error.context?.json?.();
        if (parsedBody && typeof parsedBody === "object" && parsedBody.error) {
          return { ok: false, error: parsedBody.error };
        }
      } catch (_parseError) {
        // Fall through to the generic fallback below — never let a body-
        // parsing failure surface as an unhandled rejection here.
      }

      return {
        ok: false,
        error: { code: "MERGE_REQUEST_FAILED", message: error.message || "請求失敗，請稍後再試一次。" }
      };
    }

    return data;
  }

  async function beginMergeApiClient({ email } = {}) {
    return invokeAccountMergeFunction("begin", { targetEmail: email });
  }

  async function finalizeMergeApiClient({ claimToken } = {}) {
    return invokeAccountMergeFunction("finalize", { claimToken });
  }

  function createGuard() {
    const emailOtpService = emailOtpServiceApi.createEmailOtpService({
      authClient: window.supabaseClient.auth
    });
    const accountMergeService = accountMergeServiceApi.createAccountMergeService({
      beginMergeApiClient,
      finalizeMergeApiClient
    });

    return guardApi.createSubscriptionEntryGuard({
      authService,
      emailOtpService,
      accountMergeService
    });
  }

  async function handlePlanClick(planId) {
    hideAll();

    try {
      const { session, user } = await getCurrentSessionAndUser();
      const guard = createGuard();
      const result = guard.evaluateSubscriptionEntry({
        session,
        user,
        checkoutContext: { planId }
      });

      if (result.action === guardApi.ACTION.ENTER_CHECKOUT) {
        showReady(result.checkoutContext);
        return;
      }

      // start_email_otp_upgrade — keep the ORIGINAL plan intent (pending)
      // so it can be resumed automatically once the upgrade succeeds.
      resetPendingOtpState();
      pendingGuard = result.pending;
      pendingPreviousAuthUserId = String(user?.id || "");
      showOtpStep1();
    } catch (error) {
      showError(error?.message);
    }
  }

  async function handleSendOtp() {
    const email = String(refs.emailInput?.value || "").trim();
    pendingEmail = email;

    if (refs.sendOtpStatus) refs.sendOtpStatus.textContent = "寄送中...";

    try {
      const guard = createGuard();
      const result = await guard.startUpgrade({ email });

      if (!result.ok) {
        // Existing Account (spec Section 7): this email already belongs to a
        // different, already-registered account. Anonymous Upgrade must not
        // retry (it would just fail the same way again) — switch to the
        // Existing Account Login OTP flow instead, never creating a
        // duplicate account.
        if (result.error?.code === "EMAIL_ALREADY_REGISTERED") {
          pendingMode = "login";

          // P-AUTH-05B-1 requirement 3: Begin must be called while still
          // holding the ANONYMOUS session, AFTER updateUser() has just
          // confirmed the email already exists but BEFORE signInWithOtp()
          // (via startLoginOtp() below) sends the Existing Account Login
          // OTP. If Begin fails (merge infra not deployed/configured yet,
          // or a transient network issue), login still proceeds
          // (pendingClaimToken stays null) — a merge outage must never
          // block the base login capability; the later Finalize call will
          // fail gracefully via completeLoginAndResume's existing
          // EXISTING_ACCOUNT_MERGE_REQUIRED blocker instead.
          const beginResult = await guard.beginAccountMerge({ email });
          pendingClaimToken = beginResult.ok ? beginResult.data.claimToken : null;

          // Existing Account Login hits Supabase's public `signInWithOtp`
          // endpoint, which this project's Captcha (Cloudflare Turnstile)
          // protection covers — unlike Anonymous Upgrade's `updateUser()`.
          // Reuse the same Turnstile helper `js/user.js` already uses for
          // `signInAnonymously()`, so this doesn't duplicate widget logic.
          let captchaToken;
          try {
            captchaToken = await window.UserStore.verifyTurnstile();
          } catch (captchaError) {
            if (refs.sendOtpStatus) refs.sendOtpStatus.textContent = captchaError?.message || "驗證失敗，請重新整理頁面後再試一次。";
            return;
          }

          const loginResult = await guard.startLoginOtp({ email, captchaToken });

          if (!loginResult.ok) {
            if (refs.sendOtpStatus) refs.sendOtpStatus.textContent = loginResult.error?.message || "寄送驗證碼失敗，請稍後再試。";
            return;
          }

          // Hotfix (P-AUTH-04 hotfix): save the purpose the send flow
          // actually used ("email" for signInWithOtp) so verify uses the
          // matching Supabase OTP `type` — never hardcoded/guessed.
          pendingOtpPurpose = loginResult.data.otpPurpose;
          if (refs.sendOtpStatus) refs.sendOtpStatus.textContent = `此 Email 已註冊過帳號，登入用驗證碼已寄至 ${loginResult.data.email}`;
          showOtpStep2();
          return;
        }

        if (refs.sendOtpStatus) refs.sendOtpStatus.textContent = result.error?.message || "寄送驗證碼失敗，請確認 Email 是否正確。";
        return;
      }

      pendingMode = "upgrade";
      // Hotfix (P-AUTH-04 hotfix): save the purpose the send flow actually
      // used ("email_change" for updateUser) so verify uses the matching
      // Supabase OTP `type` — never hardcoded/guessed. Resending (the same
      // button handler, re-run from the top) naturally re-derives and saves
      // the same purpose again, so it always stays consistent.
      pendingOtpPurpose = result.data.otpPurpose;
      if (refs.sendOtpStatus) refs.sendOtpStatus.textContent = `驗證碼已寄至 ${result.data.email}`;
      showOtpStep2();
    } catch (error) {
      if (refs.sendOtpStatus) refs.sendOtpStatus.textContent = error?.message || "寄送驗證碼失敗。";
    }
  }

  async function handleVerifyOtp() {
    const token = String(refs.tokenInput?.value || "").trim();

    try {
      const guard = createGuard();

      // Existing Account Login (spec Section 7): a successful login here
      // authenticates a DIFFERENT, already-existing account — it auto-
      // resumes the pending Checkout ONLY if the Account Merge (Begin was
      // already called in handleSendOtp above; Finalize runs inside
      // completeLoginAndResume via the claimToken) also succeeds. Any
      // merge failure is a blocker (EXISTING_ACCOUNT_MERGE_REQUIRED),
      // never a silent/implicit merge (see subscription-entry-guard.js).
      if (pendingMode === "login") {
        const result = await guard.completeLoginAndResume({
          email: pendingEmail,
          token,
          pending: pendingGuard,
          claimToken: pendingClaimToken,
          otpPurpose: pendingOtpPurpose
        });

        if (result.action === guardApi.ACTION.ENTER_CHECKOUT) {
          resetPendingOtpState();
          showReady(result.checkoutContext);
          return;
        }

        if (result.action === guardApi.ACTION.EXISTING_ACCOUNT_MERGE_REQUIRED) {
          // The user's session IS now the existing official account (login
          // succeeded); clicking "訂閱" again re-evaluates from a clean
          // state and resolves straight to ENTER_CHECKOUT via that account
          // (see handlePlanClick), so resetting here is safe.
          resetPendingOtpState();
          showError("登入成功，但資料合併尚未完成，請重新點擊「訂閱」按鈕以此帳號繼續操作，或稍後再試一次。");
          return;
        }

        if (result.action === guardApi.ACTION.UPGRADE_INCOMPLETE) {
          showError("Email 已驗證，但身份尚未完全通過驗證（例如尚未完成 Google 驗證），暫時無法進入 Checkout。");
          return;
        }

        showError(result.error?.message || "驗證碼錯誤或已逾期，請重新寄送。");
        return;
      }

      const result = await guard.completeUpgradeAndResume({
        email: pendingEmail,
        token,
        previousAuthUserId: pendingPreviousAuthUserId,
        pending: pendingGuard,
        otpPurpose: pendingOtpPurpose
      });

      if (result.action === guardApi.ACTION.ENTER_CHECKOUT) {
        resetPendingOtpState();
        showReady(result.checkoutContext);
        return;
      }

      if (result.action === guardApi.ACTION.UPGRADE_INCOMPLETE) {
        showError("Email 已驗證，但身份尚未完全通過驗證（例如尚未完成 Google 驗證），暫時無法進入 Checkout。");
        return;
      }

      showError(result.error?.message || "驗證碼錯誤或已逾期，請重新寄送。");
    } catch (error) {
      showError(error?.message);
    }
  }

  function handleRetry() {
    resetPendingOtpState();
    showOtpStep1();
  }

  refs.planButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      handlePlanClick(button.dataset.planId);
    });
  });

  if (refs.sendOtpBtn) {
    refs.sendOtpBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleSendOtp();
    });
  }

  if (refs.resendOtpBtn) {
    refs.resendOtpBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleSendOtp();
    });
  }

  if (refs.verifyOtpBtn) {
    refs.verifyOtpBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleVerifyOtp();
    });
  }

  if (refs.retryBtn) {
    refs.retryBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleRetry();
    });
  }
})();
