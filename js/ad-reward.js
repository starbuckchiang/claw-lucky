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
        maxDailyAdRewards: 3
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
    const config = getAdConfig();
    const storage = getAdStorage();

    const state = storage.getState();
    const remaining = storage.getRemaining();

    if (remaining <= 0) {
      alert("今日補給次數已用完。");
      renderRemaining({ refs, isDrawing });
      return null;
    }

    const profile = getUserProfile();

    if (!profile.userId) {
      throw new Error("找不到 userId");
    }

    try {
      await getApi().adjustBalance({
        userId: profile.userId,
        nickname: profile.nickname,
        coinsDelta: Number(config.adRewardCoins || 20),
        source: "watch_ad",
        note: "觀看廣告獎勵",
        actionType: "watch_ad"
      });

      state.count += 1;
      storage.saveState(state);

      const remoteUser =
        typeof refreshTopbar === "function"
          ? await refreshTopbar()
          : null;

      renderRemaining({ refs, isDrawing });

      alert(`補給成功！獲得 ${config.adRewardCoins} 好運幣`);

      return remoteUser;
    } catch (error) {
      console.error("[AdReward] grantReward failed =", error);
      alert("補給失敗，請稍後再試。");
      return null;
    }
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
