(function () {
  const authService = window.AuthService;
  const emailOtpServiceApi = window.EmailOtpService;
  const accountMergeServiceApi = window.AccountMergeService;
  const guardApi = window.SubscriptionEntryGuard;
  const paypalSubscriptionServiceApi = window.PaypalSubscriptionService;
  const paypalCheckoutServiceApi = window.PaypalCheckoutService;
  const flow = window.PaypalSubscriptionFlow;

  if (!paypalSubscriptionServiceApi || !flow) {
    console.error("[subscription-entry] missing PaypalSubscriptionService or PaypalSubscriptionFlow");
    return;
  }

  const refs = {
    planSection: document.getElementById("planSection"),
    planButtons: Array.from(document.querySelectorAll("[data-plan-id]")),
    memberLoginLink: document.getElementById("memberLoginLink"),
    loggedInEmailText: document.getElementById("loggedInEmailText"),
    logoutBtn: document.getElementById("logoutBtn"),
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
    paypalSdkErrorActions: document.getElementById("paypalSdkErrorActions"),
    paypalSdkRetryBtn: document.getElementById("paypalSdkRetryBtn"),
    paypalSdkBackBtn: document.getElementById("paypalSdkBackBtn"),
    statusPanel: document.getElementById("statusPanel"),
    statusBadge: document.getElementById("statusBadge"),
    statusHeadline: document.getElementById("statusHeadline"),
    statusDetail: document.getElementById("statusDetail"),
    statusMeta: document.getElementById("statusMeta"),
    statusPlanCodeRow: document.getElementById("statusPlanCodeRow"),
    statusPlanCode: document.getElementById("statusPlanCode"),
    statusValueRow: document.getElementById("statusValueRow"),
    statusValue: document.getElementById("statusValue"),
    statusNextBillingRow: document.getElementById("statusNextBillingRow"),
    statusNextBilling: document.getElementById("statusNextBilling"),
    statusPaidThroughRow: document.getElementById("statusPaidThroughRow"),
    statusPaidThrough: document.getElementById("statusPaidThrough"),
    manageSubscriptionPanel: document.getElementById("manageSubscriptionPanel"),
    cancelRow: document.getElementById("cancelRow"),
    cancelSubscriptionBtn: document.getElementById("cancelSubscriptionBtn"),
    refundRow: document.getElementById("refundRow"),
    serviceEntryRow: document.getElementById("serviceEntryRow"),
    reauthorizeRow: document.getElementById("reauthorizeRow"),
    reauthorizeBtn: document.getElementById("reauthorizeBtn"),
    backToMemberBtn: document.getElementById("backToMemberBtn"),
    statusActionText: document.getElementById("statusActionText"),
    statusRequeryRow: document.getElementById("statusRequeryRow"),
    statusRequeryBtn: document.getElementById("statusRequeryBtn"),
    errorPanel: document.getElementById("errorPanel"),
    errorMessage: document.getElementById("errorMessage"),
    retryBtn: document.getElementById("retryBtn"),
    otpPanelTitle: document.getElementById("otpPanelTitle"),
    otpPanelDesc: document.getElementById("otpPanelDesc"),
    openRefundFormBtn: document.getElementById("openRefundFormBtn"),
    refundForm: document.getElementById("refundForm"),
    refundReasonInput: document.getElementById("refundReasonInput"),
    submitRefundBtn: document.getElementById("submitRefundBtn"),
    cancelRefundFormBtn: document.getElementById("cancelRefundFormBtn"),
    refundResult: document.getElementById("refundResult"),
    refundSubAmount: document.getElementById("refundSubAmount"),
    refundShipAmount: document.getElementById("refundShipAmount"),
    refundGiftReturn: document.getElementById("refundGiftReturn"),
    giftPanel: document.getElementById("giftPanel"),
    giftHeadline: document.getElementById("giftHeadline"),
    giftDetail: document.getElementById("giftDetail"),
    giftHoldNotice: document.getElementById("giftHoldNotice"),
    giftAddressForm: document.getElementById("giftAddressForm"),
    giftRecipientName: document.getElementById("giftRecipientName"),
    giftRecipientPhone: document.getElementById("giftRecipientPhone"),
    giftAddressLine1: document.getElementById("giftAddressLine1"),
    giftAddressLine2: document.getElementById("giftAddressLine2"),
    giftCity: document.getElementById("giftCity"),
    giftRegion: document.getElementById("giftRegion"),
    giftPostalCode: document.getElementById("giftPostalCode"),
    giftCountry: document.getElementById("giftCountry"),
    submitGiftAddressBtn: document.getElementById("submitGiftAddressBtn"),
    giftAddressStatusText: document.getElementById("giftAddressStatusText"),
    giftFeeMeta: document.getElementById("giftFeeMeta"),
    giftFeeAmount: document.getElementById("giftFeeAmount"),
    giftFeeNote: document.getElementById("giftFeeNote"),
    giftFeeButtonsMount: document.getElementById("giftFeeButtonsMount"),
    giftFeeStatusText: document.getElementById("giftFeeStatusText"),
    giftDeclineSection: document.getElementById("giftDeclineSection"),
    declineGiftBtn: document.getElementById("declineGiftBtn"),
    giftDeclineStatusText: document.getElementById("giftDeclineStatusText"),
    giftTrackingMeta: document.getElementById("giftTrackingMeta"),
    giftTrackingNumber: document.getElementById("giftTrackingNumber")
  };

  // PROD-FIX-2026-10-14: `?return=admin` lets admin.html send an
  // unauthenticated admin here to log in, then come straight back —
  // without this, a plain login had no way to distinguish "just log in"
  // from "I want to buy a plan" (see redirectIfReturnTarget/
  // resumeOfficialCheckout below). Guarded: test/non-browser environments
  // may not provide window.location at all.
  const returnTarget = (function resolveReturnTarget() {
    try {
      return new URLSearchParams(window.location.search).get("return");
    } catch (_error) {
      return null;
    }
  })();

  function redirectIfReturnTarget() {
    if (returnTarget === "admin" && window.location && typeof window.location.replace === "function") {
      window.location.replace("./admin.html");
      return true;
    }
    return false;
  }

  let pendingGuard = null;
  let pendingPreviousAuthUserId = "";
  let pendingEmail = "";
  let pendingMode = "upgrade";
  let pendingOtpPurpose = null;
  let pendingClaimToken = null;
  let activePlanId = "";
  // PROD-FIX-2026-10-14: remembers the plan_code of the last rendered
  // subscription (any status) so "重新授權" can resume the SAME pending
  // session without the user re-selecting a plan.
  let lastKnownPlanCode = null;
  let paypalSdkPromise = null;
  let statusPoller = null;
  let giftFeeButtonsMounted = false;
  // WEB-HOME-01A: page-level consent idempotency keys — created once per
  // consent attempt, KEPT across retries (server write is idempotent on
  // the same key), never regenerated on a retryable failure.
  let upgradeConsentIdempotencyKey = null;
  let upgradeConsentRecorded = false;
  let checkoutConsentIdempotencyKey = null;
  let checkoutConsentRecorded = false;
  const paymentLock = flow.createBusyLock();
  const cancelLock = flow.createBusyLock();
  const giftFeePaymentLock = flow.createBusyLock();
  let giftFeeSdkPromise = null;

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

  // 2026-10-14 visual fix: raw backend status codes (APPROVAL_PENDING etc.)
  // must never be the primary on-screen text — this maps ui.mode to a short
  // zh-TW chip label; the full sentence always lives in ui.headline/detail.
  const STATUS_BADGE_LABEL = {
    active: "使用中",
    cancelled_with_access: "已取消續訂",
    approval_pending: "待授權",
    processing: "確認中",
    awaiting_first_payment: "確認中",
    suspended: "已暫停",
    access_blocked: "已暫停",
    expired: "已結束",
    unknown: "狀態更新中"
  };

  function statusBadgeLabel(ui) {
    return STATUS_BADGE_LABEL[ui.mode] || ui.headline || "";
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

  // PROD-FIX-2026-10-14: requirement 4 — waiting for first-payment
  // confirmation must never be an unbounded, dead-end wait. Shown only
  // once createStatusPoller's own maxAttempts is exhausted or a poll
  // request itself fails; re-querying always re-reads real server state,
  // never assumes success/failure locally.
  function setStatusRequeryVisible(visible) {
    if (refs.statusRequeryRow) refs.statusRequeryRow.hidden = !visible;
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

  // PROD-FIX-2026-10-14: requirement 2/3 — reauthorize the SAME pending
  // subscription (never silently marks anything paid/active locally; the
  // backend's own acquire_subscription_slot decides whether to reuse the
  // still-valid pending session or require a fresh one).
  function handleReauthorizeClick() {
    if (!lastKnownPlanCode) {
      showError("找不到原訂閱方案，請返回會員頁重新選擇方案。");
      return;
    }
    showReady({ planId: lastKnownPlanCode });
  }

  function handleBackToMemberClick() {
    hideTransientPanels();
    if (refs.readyPanel) refs.readyPanel.hidden = true;
    refreshStatusFromServer({ startPolling: true });
  }

  function handleStatusRequeryClick() {
    setStatusRequeryVisible(false);
    beginPaidThroughPolling();
  }

  function renderStatusView(subscription) {
    const ui = flow.resolveSubscriptionUiState(subscription);
    if (ui.planCode) lastKnownPlanCode = ui.planCode;

    if (refs.statusPanel) {
      refs.statusPanel.hidden = ui.mode === "none";
    }

    if (ui.mode !== "none") {
      if (refs.statusBadge) refs.statusBadge.textContent = statusBadgeLabel(ui);
      if (refs.statusHeadline) refs.statusHeadline.textContent = ui.headline;
      if (refs.statusDetail) refs.statusDetail.textContent = ui.detail;
      if (refs.statusMeta) {
        const showMeta = Boolean(ui.planCode || ui.status || ui.paidThroughLocal || ui.nextBillingLocal);
        refs.statusMeta.hidden = !showMeta;
      }
      if (refs.statusPlanCodeRow) refs.statusPlanCodeRow.hidden = !ui.planCode;
      if (refs.statusPlanCode) refs.statusPlanCode.textContent = ui.planCode ? planLabel(ui.planCode) : "";
      if (refs.statusValueRow) refs.statusValueRow.hidden = !ui.mode;
      if (refs.statusValue) refs.statusValue.textContent = statusBadgeLabel(ui);
      // Empty 下次扣款／可使用至 fields are hidden entirely, never shown as
      // a blank dash — only render the row when the backend actually gave
      // a real timestamp for it.
      if (refs.statusNextBillingRow) refs.statusNextBillingRow.hidden = !ui.nextBillingLocal;
      if (refs.statusNextBilling) refs.statusNextBilling.textContent = ui.nextBillingLocal || "";
      if (refs.statusPaidThroughRow) refs.statusPaidThroughRow.hidden = !ui.paidThroughLocal;
      if (refs.statusPaidThrough) refs.statusPaidThrough.textContent = ui.paidThroughLocal || "";

      if (refs.cancelRow) refs.cancelRow.hidden = !ui.showCancelButton;
      if (refs.refundRow) refs.refundRow.hidden = !ui.showRefundButton;
      if (refs.manageSubscriptionPanel) {
        refs.manageSubscriptionPanel.hidden = !(ui.showCancelButton || ui.showRefundButton);
      }
      if (refs.serviceEntryRow) {
        refs.serviceEntryRow.hidden = !(ui.mode === "active" || ui.mode === "cancelled_with_access");
      }
      if (refs.reauthorizeRow) refs.reauthorizeRow.hidden = !ui.showReauthorize;
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

  // PROD-FIX-2026-10-14: shows which account is currently logged in (the
  // "我的會員" entry point otherwise gives no visible confirmation of this).
  // Only ever reads the already-verified session's own email — never
  // accepts/derives it from anywhere else.
  function updateLoggedInEmailDisplay(user) {
    const email = user && !user.is_anonymous ? String(user.email || "").trim() : "";
    if (refs.loggedInEmailText) {
      refs.loggedInEmailText.textContent = email ? `已登入：${email}` : "";
      refs.loggedInEmailText.hidden = !email;
    }
    if (refs.logoutBtn) refs.logoutBtn.hidden = !email;
  }

  // 2026-10-14: logout only ends the current Auth session and clears
  // local/in-memory UI state (pending plan, return path, polling) — never
  // touches the PayPal subscription, never requests a refund, never
  // deletes the account. A failed signOut must never be shown as success.
  async function handleLogoutClick() {
    if (refs.logoutBtn) refs.logoutBtn.disabled = true;
    try {
      stopStatusPolling();
      const { error } = await window.supabaseClient.auth.signOut();
      if (error) {
        showError(flow.sanitizeUserError({ message: error.message }, "登出失敗，請稍後再試。"));
        return;
      }
      window.location.href = "./claw-lucky-home.html";
    } catch (error) {
      showError(flow.sanitizeUserError(error, "登出失敗，請稍後再試。"));
    } finally {
      if (refs.logoutBtn) refs.logoutBtn.disabled = false;
    }
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
  // PROD-FIX-2026-10-14: only force the "確認自動續訂" checkout panel when the
  // caller explicitly chose a plan (`checkoutContext.planId` set via a plan
  // button click). A plain login (no plan chosen — e.g. the member-login
  // link, or returning here from admin.html) must ALWAYS land on the
  // member/plan-selection view instead, even for an expired/never-subscribed
  // account — never force payment just because someone logged in.
  async function resumeOfficialCheckout(checkoutContext) {
    if (redirectIfReturnTarget()) return;

    hideTransientPanels();
    if (refs.readyPanel) refs.readyPanel.hidden = true;

    const { user } = await getCurrentSessionAndUser();
    updateLoggedInEmailDisplay(user);

    const subscription = await refreshStatusFromServer({ startPolling: true });
    const ui = flow.resolveSubscriptionUiState(subscription);
    const hasExplicitPlanIntent = Boolean(checkoutContext?.planId);

    if (!hasExplicitPlanIntent || (subscription && !ui.allowNewSubscription)) {
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

  async function invokePaypalCheckout(body) {
    const { data, error } = await window.supabaseClient.functions.invoke("paypal-checkout", {
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
          code: "PAYPAL_CHECKOUT_FAILED",
          message: flow.sanitizeUserError(error, "運費付款請求失敗，請稍後再試。")
        }
      };
    }

    return data;
  }

  function createCheckoutService() {
    if (!paypalCheckoutServiceApi) return null;
    return paypalCheckoutServiceApi.createPaypalCheckoutService({
      invokeFunction: invokePaypalCheckout
    });
  }

  function createPaypalService() {
    return paypalSubscriptionServiceApi.createPaypalSubscriptionService({
      invokeFunction: invokePaypalSubscription
    });
  }

  function loadPaypalSdk() {
    const clientId = String(window.PAYPAL_CLIENT_ID || "").trim();
    if (!clientId) {
      return Promise.reject(new Error("PAYPAL_CLIENT_ID 尚未在 config.js 設定。"));
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

  // PROD-RELEASE-DAY3C (line 151-198): a SEPARATE Orders v2 CAPTURE SDK
  // load, used ONLY for the NT$44 gift shipping-fee payment — never loaded
  // at the same time as the subscription SDK (loadPaypalOrdersCaptureSdk
  // replaces it in place). By the time this runs the user is already an
  // official paying subscriber, so the subscription SDK is no longer needed.
  function loadGiftFeeSdk() {
    const clientId = String(window.PAYPAL_CLIENT_ID || "").trim();
    if (!clientId) {
      return Promise.reject(new Error("PAYPAL_CLIENT_ID 尚未在 config.js 設定。"));
    }

    if (giftFeeSdkPromise) {
      return giftFeeSdkPromise;
    }

    giftFeeSdkPromise = flow.loadPaypalOrdersCaptureSdk({
      clientId,
      currency: "TWD",
      documentRef: document,
      existingPaypal: window.paypal
    }).catch((error) => {
      giftFeeSdkPromise = null;
      throw error;
    });

    return giftFeeSdkPromise;
  }

  function setGiftFeeStatus(text) {
    if (refs.giftFeeStatusText) {
      refs.giftFeeStatusText.textContent = text || "";
    }
  }

  async function mountGiftFeeButtons() {
    if (!refs.giftFeeButtonsMount) return;
    const checkoutService = createCheckoutService();
    if (!checkoutService) {
      setGiftFeeStatus("運費付款功能尚未可用，請稍後再試。");
      return;
    }
    refs.giftFeeButtonsMount.innerHTML = "";
    setGiftFeeStatus("");

    try {
      const paypal = await loadGiftFeeSdk();
      const subscriptionService = createPaypalService();
      const handlers = flow.createGiftShippingFeeButtonHandlers({
        checkoutService,
        subscriptionService,
        busyLock: giftFeePaymentLock,
        onOrderCreated: () => {
          setGiftFeeStatus("等待 PayPal 核准運費付款…");
        },
        onAuthExpired: () => {
          showAuthExpired();
        },
        onSafeError: (msg) => {
          setGiftFeeStatus(msg);
        }
      });

      paypal.Buttons({
        style: { layout: "vertical", shape: "rect", label: "pay" },
        createOrder: async (_data, _actions) => {
          setGiftFeeStatus("建立運費付款訂單…");
          return handlers.createOrder();
        },
        onApprove: async (data) => {
          setGiftFeeStatus("付款已核准，正在確認…");
          try {
            const result = await handlers.onApprove(data);
            if (result?.authExpired) {
              showAuthExpired();
              return;
            }
            if (!result?.ok) {
              setGiftFeeStatus(flow.sanitizeUserError(result, "運費付款確認失敗，請稍後再試。"));
              return;
            }
            setGiftFeeStatus("運費已付款，準備出貨中。");
            if (result.gift) renderGiftStatus(result.gift);
          } catch (error) {
            setGiftFeeStatus(flow.sanitizeUserError(error, "運費付款確認失敗，請稍後再試。"));
          }
        },
        onCancel: () => {
          const info = handlers.onCancel();
          setGiftFeeStatus(`${info.message}。${info.hint}`);
        },
        onError: () => {
          const info = handlers.onError();
          setGiftFeeStatus(info.message);
        }
      }).render(refs.giftFeeButtonsMount);
    } catch (error) {
      setGiftFeeStatus(flow.sanitizeUserError(error, "無法載入運費付款按鈕。"));
    }
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
    loadGiftStatus();
    return result.subscription;
  }

  const GIFT_STATUS_TEXT = {
    granted: "恭喜獲得首購贈品！請填寫收件資料。",
    fee_quoted: "收件資料已送出，運費已確認。",
    fee_paid: "運費已付款，準備出貨中。",
    awaiting_shipment: "商品準備中，即將出貨。",
    shipped: "商品已出貨。",
    declined: "已放棄本次首購贈品。"
  };

  async function loadGiftStatus() {
    if (!refs.giftPanel) return;
    try {
      const svc = createPaypalService();
      const result = await svc.getGiftStatus();
      if (!result?.ok || !result.gift) {
        refs.giftPanel.hidden = true;
        return;
      }
      renderGiftStatus(result.gift);
    } catch (_error) {
      // Soft-fail: gift panel just stays hidden.
    }
  }

  function renderGiftStatus(gift) {
    refs.giftPanel.hidden = false;
    if (refs.giftHeadline) {
      refs.giftHeadline.textContent = GIFT_STATUS_TEXT[gift.status] || "實體贈品";
    }
    if (refs.giftDetail) {
      refs.giftDetail.textContent = GIFT_STATUS_TEXT[gift.status] || "";
    }
    if (refs.giftHoldNotice) refs.giftHoldNotice.hidden = !gift.on_hold;

    const needsAddress = gift.status === "granted";
    if (refs.giftAddressForm) refs.giftAddressForm.hidden = !needsAddress;
    if (needsAddress && refs.giftRecipientName) {
      refs.giftRecipientName.value = gift.recipient_name || "";
      refs.giftRecipientPhone.value = gift.recipient_phone || "";
      refs.giftAddressLine1.value = gift.address_line1 || "";
      refs.giftAddressLine2.value = gift.address_line2 || "";
      refs.giftCity.value = gift.city || "";
      refs.giftRegion.value = gift.region || "";
      refs.giftPostalCode.value = gift.postal_code || "";
    }

    const feeKnown = gift.shipping_fee_amount != null;
    if (refs.giftFeeMeta) refs.giftFeeMeta.hidden = !feeKnown;
    if (refs.giftFeeAmount) {
      refs.giftFeeAmount.textContent = feeKnown
        ? `NT$${gift.shipping_fee_amount} (${gift.shipping_fee_currency || "TWD"})`
        : "—";
    }
    if (refs.giftFeeNote) {
      refs.giftFeeNote.hidden = !(gift.status === "fee_quoted");
    }

    const needsFeePayment = gift.status === "fee_quoted";
    if (refs.giftFeeButtonsMount) {
      refs.giftFeeButtonsMount.hidden = !needsFeePayment;
    }
    if (needsFeePayment && !giftFeeButtonsMounted) {
      giftFeeButtonsMounted = true;
      mountGiftFeeButtons();
    }
    if (!needsFeePayment) {
      giftFeeButtonsMounted = false;
      if (refs.giftFeeButtonsMount) refs.giftFeeButtonsMount.innerHTML = "";
      setGiftFeeStatus("");
    }

    const canDecline = gift.status === "granted" || gift.status === "fee_quoted";
    if (refs.giftDeclineSection) refs.giftDeclineSection.hidden = !canDecline;
    if (!canDecline && refs.giftDeclineStatusText) refs.giftDeclineStatusText.textContent = "";

    if (refs.giftTrackingMeta) refs.giftTrackingMeta.hidden = !gift.tracking_number;
    if (refs.giftTrackingNumber) refs.giftTrackingNumber.textContent = gift.tracking_number || "";
  }

  async function handleSubmitGiftAddress() {
    if (!refs.giftRecipientName) return;
    if (refs.giftAddressStatusText) refs.giftAddressStatusText.textContent = "送出中…";
    if (refs.submitGiftAddressBtn) refs.submitGiftAddressBtn.disabled = true;
    try {
      const svc = createPaypalService();
      const result = await svc.submitGiftAddress({
        recipientName: refs.giftRecipientName.value,
        recipientPhone: refs.giftRecipientPhone.value,
        addressLine1: refs.giftAddressLine1.value,
        addressLine2: refs.giftAddressLine2.value,
        city: refs.giftCity.value,
        region: refs.giftRegion.value,
        postalCode: refs.giftPostalCode.value,
        country: "台灣"
      });
      if (flow.isAuthExpiredError(result)) {
        showAuthExpired();
        return;
      }
      if (!result?.ok) {
        if (refs.giftAddressStatusText) {
          refs.giftAddressStatusText.textContent = flow.sanitizeUserError(result, "送出失敗，請稍後再試。");
        }
        return;
      }
      if (refs.giftAddressStatusText) refs.giftAddressStatusText.textContent = "收件資料已送出。";
      if (result.gift) renderGiftStatus(result.gift);
    } catch (error) {
      if (refs.giftAddressStatusText) {
        refs.giftAddressStatusText.textContent = flow.sanitizeUserError(error, "送出失敗，請稍後再試。");
      }
    } finally {
      if (refs.submitGiftAddressBtn) refs.submitGiftAddressBtn.disabled = false;
    }
  }

  async function handleDeclineGift() {
    if (!refs.declineGiftBtn) return;
    if (!window.confirm("這是一次性的幸運小禮物，若放棄之後不會再補發，確定要放棄嗎？")) {
      return;
    }
    if (refs.giftDeclineStatusText) refs.giftDeclineStatusText.textContent = "處理中…";
    refs.declineGiftBtn.disabled = true;
    try {
      const svc = createPaypalService();
      const result = await svc.declineGift();
      if (flow.isAuthExpiredError(result)) {
        showAuthExpired();
        return;
      }
      if (!result?.ok) {
        if (refs.giftDeclineStatusText) {
          refs.giftDeclineStatusText.textContent = flow.sanitizeUserError(result, "放棄失敗，請稍後再試。");
        }
        return;
      }
      if (result.gift) renderGiftStatus(result.gift);
    } catch (error) {
      if (refs.giftDeclineStatusText) {
        refs.giftDeclineStatusText.textContent = flow.sanitizeUserError(error, "放棄失敗，請稍後再試。");
      }
    } finally {
      refs.declineGiftBtn.disabled = false;
    }
  }

  function showRefundForm() {
    if (refs.refundForm) refs.refundForm.hidden = false;
    if (refs.refundResult) refs.refundResult.hidden = true;
  }

  function hideRefundForm() {
    if (refs.refundForm) refs.refundForm.hidden = true;
  }

  async function handleSubmitRefund() {
    if (refs.submitRefundBtn) refs.submitRefundBtn.disabled = true;
    setStatusActionText("送出中…");
    try {
      const svc = createPaypalService();
      const result = await svc.requestRefund({
        reason: refs.refundReasonInput ? refs.refundReasonInput.value : ""
      });
      if (flow.isAuthExpiredError(result)) {
        showAuthExpired();
        return;
      }
      if (!result?.ok) {
        setStatusActionText(flow.sanitizeUserError(result, "退款申請送出失敗，請稍後再試。"));
        return;
      }
      hideRefundForm();
      if (refs.refundResult) refs.refundResult.hidden = false;
      const r = result.refund_request || {};
      if (refs.refundSubAmount) {
        refs.refundSubAmount.textContent = `${r.subscription_refund_amount ?? "—"} ${r.subscription_refund_currency || ""}`;
      }
      if (refs.refundShipAmount) {
        refs.refundShipAmount.textContent = `${r.shipping_refund_amount ?? "—"} ${r.shipping_refund_currency || ""}`;
      }
      if (refs.refundGiftReturn) {
        refs.refundGiftReturn.textContent = r.gift_return_required ? "需要" : "不需要";
      }
      setStatusActionText("退款申請已送出，待人工審核。");
      loadGiftStatus();
    } catch (error) {
      setStatusActionText(flow.sanitizeUserError(error, "退款申請送出失敗，請稍後再試。"));
    } finally {
      if (refs.submitRefundBtn) refs.submitRefundBtn.disabled = false;
    }
  }

  function beginPaidThroughPolling() {
    stopStatusPolling();
    setStatusRequeryVisible(false);
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
          setStatusActionText("仍在確認首期付款，可點擊下方「重新查詢」確認最新狀態。");
          setStatusRequeryVisible(true);
        }
      }
    }).catch(() => {
      setStatusActionText("狀態更新失敗，請點擊下方「重新查詢」再試一次。");
      setStatusRequeryVisible(true);
    });
  }

  async function mountPaypalButtons(planId) {
    if (!refs.paypalButtonsMount) return;
    refs.paypalButtonsMount.innerHTML = "";
    setPaymentStatus("");
    if (refs.paypalSdkErrorActions) refs.paypalSdkErrorActions.hidden = true;

    if (!planId) {
      setPaymentStatus("缺少方案代碼。");
      return;
    }

    const paypalEnv = String(window.PAYPAL_ENV || "").toLowerCase();
    if (paypalEnv !== "sandbox" && paypalEnv !== "live") {
      setPaymentStatus("付款功能尚未設定完成，請稍後再試。");
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
          handlers.onCancel();
          setPlanButtonsDisabled(false);
          setPaymentStatus("授權未完成，訂閱尚未啟用。");
          if (refs.paypalSdkErrorActions) refs.paypalSdkErrorActions.hidden = false;
        },
        onError: () => {
          handlers.onError();
          setPlanButtonsDisabled(false);
          setPaymentStatus("授權未完成，訂閱尚未啟用。");
          if (refs.paypalSdkErrorActions) refs.paypalSdkErrorActions.hidden = false;
        }
      }).render(refs.paypalButtonsMount);
    } catch (error) {
      setPaymentStatus(flow.sanitizeUserError(error, "無法載入 PayPal 按鈕，請重試或稍後再試。"));
      setPlanButtonsDisabled(false);
      paymentLock.release();
      if (refs.paypalSdkErrorActions) refs.paypalSdkErrorActions.hidden = false;
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

  // PROD-FIX-2026-10-14: a plain "登入" entry (member-login link, or
  // admin.html's return link) that carries NO plan intent at all — unlike
  // handlePlanClick, `checkoutContext` stays null end-to-end, so
  // resumeOfficialCheckout() never opens the "確認自動續訂" checkout panel
  // for this path, regardless of subscription state.
  async function handleLoginOnlyClick() {
    hideTransientPanels();

    try {
      let { session, user } = await getCurrentSessionAndUser();
      const guard = createGuard();
      const result = guard.evaluateSubscriptionEntry({
        session,
        user,
        checkoutContext: null
      });

      if (result.action === guardApi.ACTION.ENTER_CHECKOUT) {
        await resumeOfficialCheckout(result.checkoutContext);
        return;
      }

      ({ session, user } = await ensureAnonymousSession());

      resetPendingOtpState();
      pendingGuard = result.pending;
      pendingPreviousAuthUserId = String(user?.id || "");
      pendingMode = "upgrade";
      showOtpStep1();
    } catch (error) {
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

      if (redirectIfReturnTarget()) return;

      updateLoggedInEmailDisplay(user);
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

  if (refs.memberLoginLink) {
    refs.memberLoginLink.addEventListener("click", (event) => {
      event.preventDefault();
      if (paymentLock.isBusy()) return;
      handleLoginOnlyClick();
    });
  }

  if (refs.logoutBtn) {
    refs.logoutBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleLogoutClick();
    });
  }

  if (refs.paypalSdkRetryBtn) {
    refs.paypalSdkRetryBtn.addEventListener("click", (event) => {
      event.preventDefault();
      mountPaypalButtons(activePlanId);
    });
  }

  if (refs.paypalSdkBackBtn) {
    refs.paypalSdkBackBtn.addEventListener("click", (event) => {
      event.preventDefault();
      resumeOfficialCheckout(null);
    });
  }

  if (refs.cancelSubscriptionBtn) {
    refs.cancelSubscriptionBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleCancelSubscription();
    });
  }

  if (refs.reauthorizeBtn) {
    refs.reauthorizeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleReauthorizeClick();
    });
  }

  if (refs.backToMemberBtn) {
    refs.backToMemberBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleBackToMemberClick();
    });
  }

  if (refs.statusRequeryBtn) {
    refs.statusRequeryBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleStatusRequeryClick();
    });
  }

  if (refs.openRefundFormBtn) {
    refs.openRefundFormBtn.addEventListener("click", (event) => {
      event.preventDefault();
      showRefundForm();
    });
  }

  if (refs.cancelRefundFormBtn) {
    refs.cancelRefundFormBtn.addEventListener("click", (event) => {
      event.preventDefault();
      hideRefundForm();
    });
  }

  if (refs.submitRefundBtn) {
    refs.submitRefundBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleSubmitRefund();
    });
  }

  if (refs.submitGiftAddressBtn) {
    refs.submitGiftAddressBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleSubmitGiftAddress();
    });
  }
  if (refs.declineGiftBtn) {
    refs.declineGiftBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleDeclineGift();
    });
  }

  bootstrap();
})();
