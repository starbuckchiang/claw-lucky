/* ============================================================
   Ad Reward Module
   ------------------------------------------------------------
   負責：
   1. 顯示今日剩餘廣告補給次數
   2. 開啟廣告 Modal
   3. 發放觀看廣告獎勵
   4. 透過 Supabase 更新 coins
   5. 更新 Topbar
   ============================================================ */

(function () {
  function getApi() {
    if (!window.Api) {
      throw new Error("Api 尚未初始化");
    }

    return window.Api;
  }

  function getUserProfile() {
    return window.UserStore?.getUserProfile
      ? window.UserStore.getUserProfile()
      : { userId: "", nickname: "" };
  }

  function getAdConfig() {
    if (!window.AdConfig?.getAdConfig) {
      return {
        adRewardCoins: 20,
        adRewardBonusPlay: 1,
        maxDailyAdRewards: 99
      };
    }

    return window.AdConfig.getAdConfig();
  }

  function getAdStorage() {
    if (!window.AdStorage) {
      throw new Error("AdStorage 尚未初始化");
    }

    return window.AdStorage;
  }

  function getRemaining() {
    return getAdStorage().getRemaining();
  }

  function renderRemaining({ refs, isDrawing = false }) {
    const remaining = getRemaining();

    if (refs?.adRemainingEl) {
      refs.adRemainingEl.textContent = remaining;
    }

    if (refs?.watchAdBtnEl) {
      refs.watchAdBtnEl.disabled = Boolean(isDrawing) || remaining <= 0;

      refs.watchAdBtnEl.textContent =
        remaining <= 0
          ? "今日已領完"
          : "觀看獎勵影片";
    }

    return remaining;
  }

  async function grantReward({ refs, refreshTopbar, isDrawing = false } = {}) {
    const storage = getAdStorage();
    const remaining = storage.getRemaining();

    if (remaining <= 0) {
      alert("今日補給次數已用完。");
      renderRemaining({ refs, isDrawing });
      return null;
    }

    // P-AUTH-05B-2A hotfix (requirement 4): this flow has NO
    // server-verifiable proof the ad was actually watched — `AdModal`'s
    // "completed" flag is pure client-side JS state set by a `<video>`
    // `ended` event listener, which is trivially fakeable (e.g. calling
    // `window.AdModal.close()` from devtools without ever playing the
    // video). Granting real currency on an unverifiable signal would let
    // anyone mint free coins. This is PAUSED (an explicit, documented
    // blocker — see review-auth-05B-2A-hotfix.md / threat model) until a
    // real server-verifiable ad-completion callback exists (e.g. a signed
    // token from an ad network's server-to-server postback) — NOT
    // implemented in this hotfix. The old `Api.adjustBalance()` call that
    // used to grant coins here has been removed entirely (that method is
    // now a deprecated, always-rejecting stub — see js/api.js) rather than
    // silently kept working.
    alert("好運補給站目前維護中，暫不提供影片獎勵，敬請期待！");
    renderRemaining({ refs, isDrawing });
    return null;
  }

  function handleClick({ refs, refreshTopbar, getIsDrawing } = {}) {
    const isDrawing =
      typeof getIsDrawing === "function"
        ? Boolean(getIsDrawing())
        : false;

    if (!window.AdModal?.open) {
      console.warn("[AdReward] AdModal 尚未載入，直接發放獎勵");

      grantReward({
        refs,
        refreshTopbar,
        isDrawing
      });

      return;
    }

    window.AdModal.open(async () => {
      await grantReward({
        refs,
        refreshTopbar,
        isDrawing:
          typeof getIsDrawing === "function"
            ? Boolean(getIsDrawing())
            : false
      });
    });
  }

  window.AdReward = {
    getRemaining,
    renderRemaining,
    grantReward,
    handleClick
  };
})();
