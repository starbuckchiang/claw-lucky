(function () {
  const authService = window.AuthService;
  const emailOtpServiceApi = window.EmailOtpService;
  const accountMergeServiceApi = window.AccountMergeService;
  const guardApi = window.SubscriptionEntryGuard;
  const paypalSubscriptionServiceApi = window.PaypalSubscriptionService;
  const flow = window.PaypalSubscriptionFlow;

  if (!paypalSubscriptionServiceApi || !flow) {
    console.error("[subscription-entry] missing PaypalSubscriptionService or PaypalSubscriptionFlow");
    return;
  }

  const refs = {
    planSection: document.getElementById("planSection"),
    planButtons: Array.from(document.querySelectorAll("[data-plan-id]")),
    otpPanel: document.getElementById("otpPanel"),
    otpStep1: document.getElementById("otpStep1"),
    otpStep2: document.getElementById("otpStep2"),
    emailInput: document.getElementById("otpEmailInput"),
    termsConsentCheckbox: document.getElementById("termsConsentCheckbox"),
    paymentConsentCheckbox: document.getElementById("paymentConsentCheckbox"),
    sendOtpBtn: document.getElementById("sendOtpBtn"),
    sendOtpStatus: document.getElementById("sendOtpStatus"),
    tokenInput: document.getElementById("otpTokenInput"),
    verifyOtpBtn: document.getElementById("verifyOtpBtn"),
    resendOtpBtn: document.getElementById("resendOtpBtn"),
    readyPanel: document.getElementById("readyPanel"),
    readyPlanLabel: document.getElementById("readyPlanLabel"),
    paypalButtonsMount: document.getElementById("paypalButtonsMount"),
    paymentStatusText: document.getElementById("paymentStatusText"),
    statusPanel: document.getElementById("statusPanel"),
    statusBadge: document.getElementById("statusBadge"),
    statusHeadline: document.getElementById("statusHeadline"),
    statusDetail: document.getElementById("statusDetail"),
    statusMeta: document.getElementById("statusMeta"),
    statusPlanCode: document.getElementById("statusPlanCode"),
    statusValue: document.getElementById("statusValue"),
    statusNextBilling: document.getElementById("statusNextBilling"),
    statusPaidThrough: document.getElementById("statusPaidThrough"),
    cancelRow: document.getElementById("cancelRow"),
    cancelSubscriptionBtn: document.getElementById("cancelSubscriptionBtn"),
    statusActionText: document.getElementById("statusActionText"),
    errorPanel: document.getElementById("errorPanel"),
    errorMessage: document.getElementById("errorMessage"),
    retryBtn: document.getElementById("retryBtn"),
    otpPanelTitle: document.getElementById("otpPanelTitle"),
    otpPanelDesc: document.getElementById("otpPanelDesc")
  };

  let pendingGuard = null;
  let pendingPreviousAuthUserId = "";
  let pendingEmail = "";
  let pendingMode = "upgrade";
  let pendingOtpPurpose = null;
  let pendingClaimToken = null;
  let activePlanId = "";
  let paypalSdkPromise = null;
  let statusPoller = null;
  // WEB-HOME-01A: page-level consent idempotency keys — created once per
  // consent attempt, KEPT across retries (server write is idempotent on
  // the same key), never regenerated on a retryable failure.
  let upgradeConsentIdempotencyKey = null;
  let upgradeConsentRecorded = false;
  let checkoutConsentIdempotencyKey = null;
  let checkoutConsentRecorded = false;
  const paymentLock = flow.createBusyLock();
  const cancelLock = flow.createBusyLock();

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

  // WEB-HOME-01: the upgrade/login OTP flow must not start until the
  // UNCHECKED terms/privacy consent checkbox is actively checked.
  function hasTermsConsent() {
    return Boolean(refs.termsConsentCheckbox?.checked);
  }

  function hasPaymentConsent() {
    return Boolean(refs.paymentConsentCheckbox?.checked);
  }

  function recordTermsConsent(userId) {
    const consentApi = window.TermsConsent;
    if (!consentApi) return;
    try {
      consentApi.saveTermsConsentRecord(
        window.localStorage,
        consentApi.buildTermsConsentRecord({ userId })
      );
    } catch (_error) {
      // NON-AUTHORITATIVE local trace only (WEB-HOME-01A): the
      // authoritative record is the server-side user_consents row.
    }
  }

  // WEB-HOME-01A: server-side consent write (the authoritative record).
  function createConsentService() {
    const api = window.ConsentWriteService;
    return api.createConsentWriteService({
      invokeFunction: api.createConsentOpsInvoker({ supabaseClient: window.supabaseClient })
    });
  }

  // Returns true only when the account_upgrade consent row is confirmed
  // written server-side. Reuses the SAME idempotency key across retries.
  async function ensureUpgradeConsentRecorded() {
    if (upgradeConsentRecorded) return true;
    if (!upgradeConsentIdempotencyKey) {
      upgradeConsentIdempotencyKey = crypto.randomUUID();
    }
    try {
      const result = await createConsentService().recordConsent({
        consentScope: "account_upgrade",
        source: "account_upgrade_form",
        idempotencyKey: upgradeConsentIdempotencyKey
      });
      if (result?.ok) {
        upgradeConsentRecorded = true;
        return true;
      }
      return false;
    } catch (_error) {
      return false;
    }
  }

  async function ensureCheckoutConsentRecorded() {
    if (checkoutConsentRecorded) return true;
    if (!checkoutConsentIdempotencyKey) {
      checkoutConsentIdempotencyKey = crypto.randomUUID();
    }
    try {
      const result = await createConsentService().recordConsent({
        consentScope: "checkout",
        source: "subscription_page",
        idempotencyKey: checkoutConsentIdempotencyKey
      });
      if (result?.ok) {
        checkoutConsentRecorded = true;
        return true;
      }
      return false;
    } catch (_error) {
      return false;
    }
  }

  function setPlanButtonsDisabled(disabled) {
    refs.planButtons.forEach((btn) => {
      btn.disabled = Boolean(disabled);
    });
  }

  function setPlanSectionVisible(visible) {
    if (refs.planSection) {
      refs.planSection.hidden = !visible;
    }
  }

  function setPaymentStatus(text) {
    if (refs.paymentStatusText) {
      refs.paymentStatusText.textContent = text || "";
    }
  }

  function setStatusActionText(text) {
    if (refs.statusActionText) {
      refs.statusActionText.textContent = text || "";
    }
  }

  function stopStatusPolling() {
    if (statusPoller) {
      statusPoller.stop();
      statusPoller = null;
    }
  }

  function hideTransientPanels() {
    if (refs.otpPanel) refs.otpPanel.hidden = true;
    if (refs.otpStep2) refs.otpStep2.hidden = true;
    if (refs.readyPanel) refs.readyPanel.hidden = true;
    if (refs.errorPanel) refs.errorPanel.hidden = true;
  }

  function showError(message) {
    stopStatusPolling();
    hideTransientPanels();
    setPlanButtonsDisabled(false);
    paymentLock.release();
    if (refs.errorPanel) refs.errorPanel.hidden = false;
    if (refs.errorMessage) {
      refs.errorMessage.textContent = flow.sanitizeUserError(
        { message },
        "發生未預期的錯誤，請重試。"
      );
    }
  }

  function showAuthExpired() {
    stopStatusPolling();
    paymentLock.release();
    cancelLock.release();
    showError("登入已過期，請重新登入後再繼續訂閱。");
  }

  function renderStatusView(subscription) {
    const ui = flow.resolveSubscriptionUiState(subscription);

    if (refs.statusPanel) {
      refs.statusPanel.hidden = ui.mode === "none";
    }

    if (ui.mode !== "none") {
      if (refs.statusBadge) refs.statusBadge.textContent = ui.status || ui.mode;
      if (refs.statusHeadline) refs.statusHeadline.textContent = ui.headline;
      if (refs.statusDetail) refs.statusDetail.textContent = ui.detail;
      if (refs.statusMeta) {
        const showMeta = Boolean(ui.planCode || ui.status || ui.paidThroughLocal || ui.nextBillingLocal);
        refs.statusMeta.hidden = !showMeta;
      }
      if (refs.statusPlanCode) {
        refs.statusPlanCode.textContent = ui.planCode
          ? planLabel(ui.planCode)
          : "—";
      }
      if (refs.statusValue) refs.statusValue.textContent = ui.status || "—";
      if (refs.statusNextBilling) {
        refs.statusNextBilling.textContent = ui.nextBillingLocal || "—";
      }
      if (refs.statusPaidThrough) {
        refs.statusPaidThrough.textContent = ui.paidThroughLocal || "—";
      }
      if (refs.cancelRow) refs.cancelRow.hidden = !ui.showCancelButton;
    }

    setPlanSectionVisible(ui.showPlanButtons);
    setPlanButtonsDisabled(!ui.allowNewSubscription);
    return ui;
  }

  function showReady(checkoutContext) {
    hideTransientPanels();
    if (refs.statusPanel) refs.statusPanel.hidden = true;
    activePlanId = String(checkoutContext?.planId || "");
    setPlanSectionVisible(true);
    setPlanButtonsDisabled(true);
    if (refs.readyPanel) refs.readyPanel.hidden = false;
    if (refs.readyPlanLabel) refs.readyPlanLabel.textContent = planLabel(activePlanId);
    setPaymentStatus("");
    mountPaypalButtons(activePlanId);
  }

  function setOtpPanelMode(mode) {
    const isLogin = mode === "login";
    if (refs.otpPanelTitle) {
      refs.otpPanelTitle.textContent = isLogin ? "既有帳號登入" : "Email 驗證升級";
    }
    if (refs.otpPanelDesc) {
      refs.otpPanelDesc.textContent = isLogin
        ? "此 Email 已註冊過帳號。請輸入信箱內的驗證碼完成登入。"
        : "升級為正式使用者後，將自動繼續你原本選擇的訂閱方案。";
    }
  }

  function showOtpStep1() {
    hideTransientPanels();
    setOtpPanelMode(pendingMode === "login" ? "login" : "upgrade");
    if (refs.otpPanel) refs.otpPanel.hidden = false;
    if (refs.otpStep1) refs.otpStep1.hidden = false;
    if (refs.otpStep2) refs.otpStep2.hidden = true;
    if (refs.sendOtpStatus) refs.sendOtpStatus.textContent = "";
  }

  function showOtpStep2() {
    setOtpPanelMode(pendingMode === "login" ? "login" : "upgrade");
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

  // Upgrade OTP uses updateUser() and account-merge needs an anonymous
  // session. subscription.html does not call initUser on boot, so visitors
  // often have no session — which surfaces as "Auth session missing!" and
  // never reaches EMAIL_ALREADY_REGISTERED → Existing Account Login OTP.
  async function ensureAnonymousSession() {
    let { session, user } = await getCurrentSessionAndUser();
    if (session?.user?.id) {
      return { session, user };
    }

    if (!window.UserStore?.initUser) {
      throw new Error("無法建立訪客登入，請重新整理頁面後再試。");
    }

    await window.UserStore.initUser();
    ({ session, user } = await getCurrentSessionAndUser());

    if (!session?.user?.id) {
      throw new Error("無法建立訪客登入（請完成畫面驗證後再試），請重新整理頁面後再試一次。");
    }

    return { session, user };
  }

  // After Official auth (upgrade or existing-account login), prefer showing
  // an already-entitled subscription instead of opening a second PayPal checkout.
  async function resumeOfficialCheckout(checkoutContext) {
    hideTransientPanels();
    if (refs.readyPanel) refs.readyPanel.hidden = true;

    const subscription = await refreshStatusFromServer({ startPolling: true });
    const ui = flow.resolveSubscriptionUiState(subscription);

    if (subscription && !ui.allowNewSubscription) {
      setPlanSectionVisible(ui.showPlanButtons);
      setPlanButtonsDisabled(!ui.allowNewSubscription);
      return;
    }

    showReady(checkoutContext);
  }

  async function invokePaypalSubscription(body) {
    const { data, error } = await window.supabaseClient.functions.invoke("paypal-subscription", {
      body
    });

    if (error) {
      try {
        const parsedBody = await error.context?.json?.();
        if (parsedBody && typeof parsedBody === "object") {
          if (flow.isAuthExpiredError(parsedBody) || error.context?.status === 401) {
            return {
              ok: false,
              error: { code: "AUTH_EXPIRED", message: "登入已過期，請重新登入。" }
            };
          }
          return parsedBody;
        }
      } catch (_parseError) {
        // fall through
      }
      if (error.context?.status === 401 || /jwt|unauthorized|session/i.test(String(error.message || ""))) {
        return {
          ok: false,
          error: { code: "AUTH_EXPIRED", message: "登入已過期，請重新登入。" }
        };
      }
      return {
        ok: false,
        error: {
          code: "PAYPAL_SUBSCRIPTION_FAILED",
          message: flow.sanitizeUserError(error, "訂閱請求失敗，請稍後再試。")
        }
      };
    }

    return data;
  }

  function createPaypalService() {
    return paypalSubscriptionServiceApi.createPaypalSubscriptionService({
      invokeFunction: invokePaypalSubscription
    });
  }

  function loadPaypalSdk() {
    const clientId = String(window.PAYPAL_CLIENT_ID || "").trim();
    if (!clientId) {
      return Promise.reject(new Error("PAYPAL_CLIENT_ID 尚未在 config.js 設定（Sandbox Client ID）。"));
    }

    if (paypalSdkPromise) {
      return paypalSdkPromise;
    }

    paypalSdkPromise = flow.loadPaypalSubscriptionSdk({
      clientId,
      documentRef: document,
      existingPaypal: window.paypal
    }).catch((error) => {
      paypalSdkPromise = null;
      throw error;
    });

    return paypalSdkPromise;
  }

  async function refreshStatusFromServer({ startPolling = false } = {}) {
    const svc = createPaypalService();
    const result = await svc.getStatus();

    if (flow.isAuthExpiredError(result)) {
      showAuthExpired();
      return null;
    }

    if (!result?.ok) {
      // Non-auth failure: keep plans usable when possible.
      return null;
    }

    const ui = renderStatusView(result.subscription);
    if (startPolling && ui.mode === "awaiting_first_payment") {
      beginPaidThroughPolling();
    }
    return result.subscription;
  }

  function beginPaidThroughPolling() {
    stopStatusPolling();
    const svc = createPaypalService();
    statusPoller = flow.createStatusPoller({
      getStatus: async () => {
        const result = await svc.getStatus();
        if (flow.isAuthExpiredError(result)) {
          return { ok: false, error: { code: "AUTH_EXPIRED" }, subscription: null };
        }
        return {
          ok: Boolean(result?.ok),
          subscription: result?.subscription ?? null,
          error: result?.error
        };
      },
      onTick: (result) => {
        if (result?.subscription) {
          renderStatusView(result.subscription);
        }
      }
    });

    statusPoller.run().then((outcome) => {
      if (outcome?.authExpired) {
        showAuthExpired();
        return;
      }
      if (outcome?.subscription) {
        const ui = renderStatusView(outcome.subscription);
        if (ui.mode === "active") {
          setStatusActionText("訂閱使用中");
        } else if (outcome.timedOut) {
          setStatusActionText("仍在確認首期付款，請稍後重新整理頁面。");
        }
      }
    }).catch(() => {
      setStatusActionText("狀態更新失敗，請稍後重新整理。");
    });
  }

  async function mountPaypalButtons(planId) {
    if (!refs.paypalButtonsMount) return;
    refs.paypalButtonsMount.innerHTML = "";
    setPaymentStatus("");

    if (!planId) {
      setPaymentStatus("缺少方案代碼。");
      return;
    }

    if (String(window.PAYPAL_ENV || "sandbox").toLowerCase() !== "sandbox") {
      setPaymentStatus("僅允許 PayPal Sandbox。");
      return;
    }

    try {
      const paypal = await loadPaypalSdk();
      const svc = createPaypalService();
      const handlers = flow.createSubscriptionButtonHandlers({
        subscriptionService: svc,
        planCode: planId,
        busyLock: paymentLock,
        onSessionCreated: () => {
          setPaymentStatus("等待 PayPal 核准自動續訂…");
        },
        onAuthExpired: () => {
          showAuthExpired();
        },
        onSafeError: (msg) => {
          setPaymentStatus(msg);
          setPlanButtonsDisabled(false);
        }
      });

      paypal.Buttons({
        style: { layout: "vertical", shape: "rect", label: "subscribe" },
        onClick: (_data, actions) => {
          if (!hasPaymentConsent()) {
            setPaymentStatus("請先勾選「我已閱讀並同意服務條款」再進行付款。");
            return actions.reject();
          }
          if (paymentLock.isBusy()) {
            return actions.reject();
          }
          setPlanButtonsDisabled(true);
          setPaymentStatus("建立訂閱工作階段…");
          return actions.resolve();
        },
        // WEB-HOME-01A: the checkout consent row must be confirmed written
        // server-side BEFORE any PayPal subscription session is created
        // (and therefore before any local subscription slot is acquired —
        // a consent failure here means createSession is never called, so
        // there is no slot to release and no pending session left behind).
        createSubscription: async (data, actions) => {
          const consentWritten = await ensureCheckoutConsentRecorded();
          if (!consentWritten) {
            setPaymentStatus("同意紀錄儲存失敗，請再試一次。");
            setPlanButtonsDisabled(false);
            throw new Error("CONSENT_RECORD_FAILED");
          }
          return handlers.createSubscription(data, actions);
        },
        onApprove: async (data) => {
          setPaymentStatus("訂閱已核准，正在確認首期付款");
          hideTransientPanels();
          if (refs.readyPanel) refs.readyPanel.hidden = true;
          try {
            const result = await handlers.onApprove(data);
            if (result?.authExpired) {
              showAuthExpired();
              return;
            }
            if (!result?.ok) {
              setPaymentStatus(
                flow.sanitizeUserError(result, "訂閱確認失敗，請稍後再試。")
              );
              setPlanButtonsDisabled(false);
              return;
            }

            // Never claim entitlement here — wait for paid_through.
            const sub = result.subscription || {
              plan_code: planId,
              status: result.status || "APPROVED",
              paid_through: null,
              access_blocked: false
            };
            renderStatusView(sub);
            setStatusActionText("訂閱已核准，正在確認首期付款");
            beginPaidThroughPolling();
          } catch (error) {
            setPaymentStatus(flow.sanitizeUserError(error, "訂閱確認失敗，請稍後再試。"));
            setPlanButtonsDisabled(false);
          }
        },
        onCancel: () => {
          const info = handlers.onCancel();
          setPlanButtonsDisabled(false);
          setPaymentStatus(`${info.message}。${info.hint}`);
        },
        onError: () => {
          const info = handlers.onError();
          setPlanButtonsDisabled(false);
          setPaymentStatus(info.message);
        }
      }).render(refs.paypalButtonsMount);
    } catch (error) {
      setPaymentStatus(flow.sanitizeUserError(error, "無法載入 PayPal 按鈕。"));
      setPlanButtonsDisabled(false);
      paymentLock.release();
    }
  }

  async function invokeAccountMergeFunction(path, body) {
    const { data, error } = await window.supabaseClient.functions.invoke(`account-merge/${path}`, { body });

    if (error) {
      try {
        const parsedBody = await error.context?.json?.();
        if (parsedBody && typeof parsedBody === "object" && parsedBody.error) {
          return { ok: false, error: parsedBody.error };
        }
      } catch (_parseError) {
        // Fall through
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
    hideTransientPanels();
    setPlanButtonsDisabled(true);

    try {
      let { session, user } = await getCurrentSessionAndUser();
      const guard = createGuard();
      const result = guard.evaluateSubscriptionEntry({
        session,
        user,
        checkoutContext: { planId }
      });

      if (result.action === guardApi.ACTION.ENTER_CHECKOUT) {
        // Official user only — prefer existing entitlement over a second checkout.
        await resumeOfficialCheckout(result.checkoutContext);
        return;
      }

      // Mint / restore anonymous session before Email OTP upgrade or
      // Existing Account Login (both require a live auth session).
      ({ session, user } = await ensureAnonymousSession());

      resetPendingOtpState();
      pendingGuard = result.pending;
      pendingPreviousAuthUserId = String(user?.id || "");
      pendingMode = "upgrade";
      setPlanButtonsDisabled(false);
      showOtpStep1();
    } catch (error) {
      setPlanButtonsDisabled(false);
      showError(error?.message);
    }
  }

  async function handleSendOtp() {
    if (!hasTermsConsent()) {
      if (refs.sendOtpStatus) {
        refs.sendOtpStatus.textContent = "請先勾選「我已閱讀並同意服務條款與隱私權政策」。";
      }
      return;
    }

    const email = String(refs.emailInput?.value || "").trim();
    pendingEmail = email;

    if (refs.sendOtpStatus) refs.sendOtpStatus.textContent = "寄送中...";

    try {
      const { user } = await ensureAnonymousSession();
      if (!pendingPreviousAuthUserId) {
        pendingPreviousAuthUserId = String(user?.id || "");
      }

      // WEB-HOME-01A: the authoritative account_upgrade consent row must
      // be confirmed written server-side BEFORE any OTP is sent — a
      // localStorage trace alone never counts as consent.
      const consentWritten = await ensureUpgradeConsentRecorded();
      if (!consentWritten) {
        if (refs.sendOtpStatus) {
          refs.sendOtpStatus.textContent = "同意紀錄儲存失敗，請再試一次。";
        }
        return;
      }

      recordTermsConsent(user?.id);

      const guard = createGuard();
      const result = await guard.startUpgrade({ email });

      if (!result.ok) {
        if (result.error?.code === "EMAIL_ALREADY_REGISTERED") {
          pendingMode = "login";
          setOtpPanelMode("login");

          const beginResult = await guard.beginAccountMerge({ email });
          pendingClaimToken = beginResult.ok ? beginResult.data.claimToken : null;

          let captchaToken;
          try {
            // Always mint a fresh Turnstile token for signInWithOtp — do not
            // reuse the token spent by ensureAnonymousSession / initUser.
            captchaToken = await window.UserStore.verifyTurnstile({ forceFresh: true });
          } catch (captchaError) {
            if (refs.sendOtpStatus) {
              refs.sendOtpStatus.textContent = captchaError?.message
                || "驗證失敗，請重新整理頁面後再試一次。";
            }
            return;
          }

          const loginResult = await guard.startLoginOtp({ email, captchaToken });

          if (!loginResult.ok) {
            if (refs.sendOtpStatus) {
              const raw = String(loginResult.error?.details?.rawMessage || "").trim();
              const safeRaw = raw
                ? `（${raw.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 140)}）`
                : "";
              refs.sendOtpStatus.textContent =
                (loginResult.error?.message || "寄送驗證碼失敗，請稍後再試。") + safeRaw;
            }
            return;
          }

          pendingOtpPurpose = loginResult.data.otpPurpose;
          if (refs.sendOtpStatus) {
            refs.sendOtpStatus.textContent =
              `此 Email 已註冊過帳號，登入用驗證碼已寄至 ${loginResult.data.email}`;
          }
          showOtpStep2();
          return;
        }

        if (refs.sendOtpStatus) {
          refs.sendOtpStatus.textContent = result.error?.message
            || "寄送驗證碼失敗，請確認 Email 是否正確。";
        }
        return;
      }

      pendingMode = "upgrade";
      setOtpPanelMode("upgrade");
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
          try {
            // Existing-account login switches to a DIFFERENT auth uid. The
            // pre-OTP consent row belongs to the anonymous uid; write one
            // more row under the NEW session's own JWT-derived uid (same
            // idempotency key, per-user unique constraint). Best-effort:
            // the original consent row already exists, so a failure here
            // never blocks checkout. No cross-uid migration is performed
            // (WEB-HOME-01A section 7).
            upgradeConsentRecorded = false;
            await ensureUpgradeConsentRecorded();
            const { user: officialUser } = await getCurrentSessionAndUser();
            recordTermsConsent(officialUser?.id);
          } catch (_consentError) {
            // best-effort; consent was already recorded at OTP send time
          }
          await resumeOfficialCheckout(result.checkoutContext);
          return;
        }

        if (result.action === guardApi.ACTION.EXISTING_ACCOUNT_MERGE_REQUIRED) {
          resetPendingOtpState();
          showError("登入成功，但資料合併尚未完成，請重新點擊方案按鈕以此帳號繼續操作，或稍後再試一次。");
          return;
        }

        if (result.action === guardApi.ACTION.UPGRADE_INCOMPLETE) {
          showError("Email 已驗證，但身份尚未完全通過驗證（例如尚未完成 Google 驗證），暫時無法進入訂閱流程。");
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
        try {
          const { user: officialUser } = await getCurrentSessionAndUser();
          recordTermsConsent(officialUser?.id);
        } catch (_consentError) {
          // best-effort; consent was already recorded at OTP send time
        }
        await resumeOfficialCheckout(result.checkoutContext);
        return;
      }

      if (result.action === guardApi.ACTION.UPGRADE_INCOMPLETE) {
        showError("Email 已驗證，但身份尚未完全通過驗證（例如尚未完成 Google 驗證），暫時無法進入訂閱流程。");
        return;
      }

      showError(result.error?.message || "驗證碼錯誤或已逾期，請重新寄送。");
    } catch (error) {
      showError(error?.message);
    }
  }

  async function handleCancelSubscription() {
    if (!cancelLock.tryAcquire()) return;

    const confirmed = window.confirm(flow.CANCEL_CONFIRM_MESSAGE);
    if (!confirmed) {
      cancelLock.release();
      return;
    }

    if (refs.cancelSubscriptionBtn) refs.cancelSubscriptionBtn.disabled = true;
    setStatusActionText("取消中…");

    try {
      const svc = createPaypalService();
      const result = await svc.cancelSubscription();

      if (flow.isAuthExpiredError(result)) {
        showAuthExpired();
        return;
      }

      if (!result?.ok) {
        setStatusActionText(
          flow.sanitizeUserError(result, "取消失敗，請稍後再試。")
        );
        return;
      }

      // Do not mark cancelled until API succeeded — then refresh status.
      const refreshed = await svc.getStatus();
      if (refreshed?.ok) {
        renderStatusView(refreshed.subscription);
        setStatusActionText("已取消自動續訂。");
      } else if (result.subscription) {
        renderStatusView(result.subscription);
        setStatusActionText("已取消自動續訂。");
      }
    } catch (error) {
      setStatusActionText(flow.sanitizeUserError(error, "取消失敗，請稍後再試。"));
    } finally {
      cancelLock.release();
      if (refs.cancelSubscriptionBtn) refs.cancelSubscriptionBtn.disabled = false;
    }
  }

  function handleRetry() {
    resetPendingOtpState();
    showOtpStep1();
  }

  async function bootstrap() {
    try {
      const { session, user } = await getCurrentSessionAndUser();
      if (!session || !user) return;

      const authState = authService.resolveAuthState({ session, user });
      if (!authState?.isOfficialUser) return;

      await refreshStatusFromServer({ startPolling: true });
    } catch (_error) {
      // Soft-fail: plans remain usable.
    }
  }

  refs.planButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (paymentLock.isBusy() || button.disabled) return;
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

  if (refs.cancelSubscriptionBtn) {
    refs.cancelSubscriptionBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleCancelSubscription();
    });
  }

  bootstrap();
})();
