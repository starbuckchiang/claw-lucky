(function () {
  const state = {
    gifts: [],
    user: null,
    redeemHistory: [],
    isRedeeming: false
  };

  const refs = {};
  let hasInitialized = false;

  function cacheDom() {
    refs.giftPageStatus = document.getElementById("giftPageStatus");
    refs.pointsValue = document.getElementById("pointsValue");
    refs.ticketsValue = document.getElementById("ticketsValue");
    refs.giftLoading = document.getElementById("giftLoading");
    refs.giftError = document.getElementById("giftError");
    refs.giftEmpty = document.getElementById("giftEmpty");
    refs.giftGrid = document.getElementById("giftGrid");
    refs.historyLoading = document.getElementById("historyLoading");
    refs.historyError = document.getElementById("historyError");
    refs.historyEmpty = document.getElementById("historyEmpty");
    refs.historyList = document.getElementById("historyList");
    refs.historySection = document.getElementById("historySection");
  }

  function getApi() {
    if (!window.Api) {
      throw new Error("Api 尚未初始化，請確認 api.js 已載入");
    }

    return window.Api;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }

    try {
      return new Date(value).toLocaleString("zh-TW");
    } catch {
      return "";
    }
  }

  function showStatus(message, tone = "info") {
    if (!refs.giftPageStatus) {
      return;
    }

    refs.giftPageStatus.textContent = message;
    refs.giftPageStatus.dataset.tone = tone;
  }

  function setHidden(element, hidden) {
    if (!element) {
      return;
    }

    element.classList.toggle("hidden", hidden);
  }

  function normalizeGift(gift) {
    const imageValue =
      gift?.image ||
      gift?.image_url ||
      gift?.cover ||
      gift?.thumbnail ||
      "";

    return {
      ...gift,
      id: String(gift?.id || ""),
      name: String(gift?.name || "未命名商品"),
      description: String(gift?.description || ""),
      image: String(imageValue || ""),
      points_cost: Number(gift?.points_cost || 0),
      tickets_cost: Number(gift?.tickets_cost || 0),
      coins_cost: Number(gift?.coins_cost || 0),
      stock: Number(gift?.stock || 0),
      enabled: Boolean(gift?.enabled !== false),
      sort_order: Number(gift?.sort_order || 0)
    };
  }

  function normalizeUser(user) {
    return {
      ...user,
      user_id: String(user?.user_id || "").trim(),
      nickname: String(user?.nickname || "").trim(),
      points: Number(user?.points || 0),
      tickets: Number(user?.tickets || 0),
      coins: Number(user?.coins || 0)
    };
  }

  function bindStaticEvents() {
    if (!refs.giftGrid) {
      return;
    }

    refs.giftGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='redeem']");
      if (!button) {
        return;
      }

      const giftId = String(button.dataset.giftId || "").trim();
      if (!giftId) {
        return;
      }

      handleRedeem(giftId);
    });
  }

  async function loadPublicGifts() {
    setHidden(refs.giftLoading, false);
    setHidden(refs.giftError, true);
    setHidden(refs.giftEmpty, true);
    refs.giftGrid.innerHTML = "";

    try {
      const gifts = await getApi().getGiftList();
      state.gifts = Array.isArray(gifts) ? gifts.map(normalizeGift) : [];
      setHidden(refs.giftLoading, true);
      renderGifts();

      if (!state.gifts.length) {
        setHidden(refs.giftEmpty, false);
      }

      return state.gifts;
    } catch (error) {
      console.error("[gift] load gifts failed", error);
      state.gifts = [];
      refs.giftGrid.innerHTML = "";
      setHidden(refs.giftLoading, true);
      setHidden(refs.giftError, false);
      showStatus("商品載入失敗，請稍後再試", "error");
      return [];
    }
  }

  async function loadUserData() {
    if (!window.userReadyPromise && window.UserStore?.initUser) {
      window.userReadyPromise = window.UserStore.initUser();
    }

    const readyUser = window.userReadyPromise
      ? await window.userReadyPromise
      : null;

    const userId = String(readyUser?.user_id || "").trim();
    if (!userId) {
      throw new Error("找不到 auth user id");
    }

    const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }

    const sessionUserId = String(sessionData?.session?.user?.id || "").trim();
    if (!sessionUserId || sessionUserId !== userId) {
      throw new Error("auth userId 與 session.user.id 不一致");
    }

    const remoteUser = await getApi().getUser(userId);
    state.user = normalizeUser(remoteUser || readyUser);
    renderWallet();
    renderGifts();
    return state.user;
  }

  async function loadRedeemHistory() {
    setHidden(refs.historyLoading, false);
    setHidden(refs.historyError, true);
    setHidden(refs.historyEmpty, true);
    refs.historyList.innerHTML = "";

    try {
      if (!state.user?.user_id) {
        throw new Error("找不到使用者資料");
      }

      const history = await getApi().getRedeemHistory(state.user.user_id);
      state.redeemHistory = Array.isArray(history) ? history : [];
      setHidden(refs.historyLoading, true);
      renderHistory();
      return state.redeemHistory;
    } catch (error) {
      console.error("[gift] load redeem history failed", error);
      state.redeemHistory = [];
      refs.historyList.innerHTML = "";
      setHidden(refs.historyLoading, true);
      setHidden(refs.historyError, false);
      return [];
    }
  }

  function renderWallet() {
    refs.pointsValue.textContent = state.user ? String(state.user.points) : "--";
    refs.ticketsValue.textContent = state.user ? String(state.user.tickets) : "--";
  }

  function getGiftAvailability(gift, user) {
    if (!user) {
      return { canRedeem: false, reason: "帳戶載入中" };
    }

    if (Number(gift.stock || 0) <= 0) {
      return { canRedeem: false, reason: "已兌換完畢" };
    }

    if (Number(user.points || 0) < Number(gift.points_cost || 0)) {
      return { canRedeem: false, reason: "點數不足" };
    }

    if (Number(user.tickets || 0) < Number(gift.tickets_cost || 0)) {
      return { canRedeem: false, reason: "兌換券不足" };
    }

    return { canRedeem: true, reason: "" };
  }

  function getCostText(gift) {
    const parts = [];

    if (Number(gift.points_cost || 0) > 0) {
      parts.push(`${gift.points_cost} 點數`);
    }

    if (Number(gift.tickets_cost || 0) > 0) {
      parts.push(`${gift.tickets_cost} 張兌換券`);
    }

    return parts.length ? parts.join("・") : "免費兌換";
  }

  function renderGiftImage(gift) {
    if (gift.image) {
      return `
        <img
          class="gift-card-image"
          src="${escapeHtml(gift.image)}"
          alt="${escapeHtml(gift.name)}"
          loading="lazy"
        />
      `;
    }

    return `
      <div class="gift-card-placeholder">
        <span>${escapeHtml(gift.name)}</span>
      </div>
    `;
  }

  function renderGifts() {
    if (!refs.giftGrid) {
      return;
    }

    if (!state.gifts.length) {
      refs.giftGrid.innerHTML = "";
      return;
    }

    const html = state.gifts.map((gift) => {
      const availability = getGiftAvailability(gift, state.user);
      const disabled = state.isRedeeming || !availability.canRedeem;

      return `
        <article class="gift-card">
          <div class="gift-card-visual">
            ${renderGiftImage(gift)}
          </div>

          <div class="gift-card-body">
            <h3 class="gift-card-title">${escapeHtml(gift.name)}</h3>
            <p class="gift-card-desc">${escapeHtml(gift.description || "這份禮物正在等你把它帶回家。")}</p>

            <dl class="gift-card-meta">
              <div class="gift-card-meta-row">
                <dt>剩餘庫存</dt>
                <dd>${escapeHtml(gift.stock)}</dd>
              </div>
              <div class="gift-card-meta-row">
                <dt>兌換成本</dt>
                <dd>${escapeHtml(getCostText(gift))}</dd>
              </div>
              <div class="gift-card-meta-row">
                <dt>點數</dt>
                <dd>${escapeHtml(gift.points_cost)}</dd>
              </div>
              <div class="gift-card-meta-row">
                <dt>兌換券</dt>
                <dd>${escapeHtml(gift.tickets_cost)}</dd>
              </div>
            </dl>

            <div class="gift-card-footer">
              <button
                class="gift-card-button"
                type="button"
                data-action="redeem"
                data-gift-id="${escapeHtml(gift.id)}"
                ${disabled ? "disabled" : ""}
              >
                ${state.isRedeeming ? "處理中" : availability.canRedeem ? "立即兌換" : "暫時不可兌換"}
              </button>
              <p class="gift-card-reason">${escapeHtml(availability.reason || "可立即兌換")}</p>
            </div>
          </div>
        </article>
      `;
    }).join("");

    refs.giftGrid.innerHTML = html;
  }

  function renderHistory() {
    refs.historyList.innerHTML = "";
    setHidden(refs.historyEmpty, true);

    if (!state.redeemHistory.length) {
      setHidden(refs.historyEmpty, false);
      return;
    }

    const html = state.redeemHistory.map((item) => {
      const costParts = [];

      if (Number(item.points_cost || 0) > 0) {
        costParts.push(`${Number(item.points_cost || 0)} 點數`);
      }

      if (Number(item.tickets_cost || 0) > 0) {
        costParts.push(`${Number(item.tickets_cost || 0)} 張兌換券`);
      }

      return `
        <article class="gift-history-card">
          <div class="gift-history-head">
            <h3 class="gift-history-title">${escapeHtml(item.gift_name || "未命名禮物")}</h3>
            <span class="gift-history-time">${escapeHtml(formatDateTime(item.created_at) || "")}</span>
          </div>
          <p class="gift-history-line">數量：${escapeHtml(Number(item.quantity || 1))}</p>
          <p class="gift-history-line">消耗：${escapeHtml(costParts.join("・") || "免費兌換")}</p>
          <p class="gift-history-line">備註：${escapeHtml(item.note || "-")}</p>
        </article>
      `;
    }).join("");

    refs.historyList.innerHTML = html;
  }

  async function handleRedeem(giftId) {
    if (state.isRedeeming) {
      return;
    }

    const gift = state.gifts.find((item) => String(item.id) === String(giftId));
    if (!gift) {
      showStatus("找不到商品資料", "error");
      return;
    }

    if (!state.user?.user_id) {
      showStatus("帳戶資料載入失敗", "error");
      return;
    }

    const availability = getGiftAvailability(gift, state.user);
    if (!availability.canRedeem) {
      showStatus(availability.reason, "warn");
      return;
    }

    const confirmed = window.confirm(`確定要兌換「${gift.name}」嗎？`);
    if (!confirmed) {
      showStatus("已取消兌換", "info");
      return;
    }

    state.isRedeeming = true;
    renderGifts();
    showStatus(`正在兌換「${gift.name}」...`, "info");

    try {
      const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }

      const sessionUserId = String(sessionData?.session?.user?.id || "").trim();
      if (!sessionUserId || sessionUserId !== state.user.user_id) {
        throw new Error("auth userId 與 session.user.id 不一致");
      }

      const latestUser = normalizeUser(await getApi().getUser(state.user.user_id));
      const latestGift = normalizeGift(await getApi().getGiftById(gift.id));
      const latestAvailability = getGiftAvailability(latestGift, latestUser);

      if (!latestAvailability.canRedeem) {
        throw new Error(latestAvailability.reason || "目前不可兌換");
      }

      await getApi().redeemGift({
        userId: latestUser.user_id,
        nickname: latestUser.nickname || "",
        giftId: latestGift.id,
        giftName: latestGift.name,
        pointsCost: latestGift.points_cost,
        ticketsCost: latestGift.tickets_cost,
        coinsCost: 0,
        note: `兌換禮物：${latestGift.name}`
      });

      await getApi().decreaseGiftStock(latestGift.id, 1);

      await loadUserData();
      await loadPublicGifts();
      await loadRedeemHistory();
      showStatus(`兌換成功：${latestGift.name}`, "success");
    } catch (error) {
      console.error("[gift] redeem failed", error);
      showStatus("兌換失敗，請重新整理後再試", "error");
    } finally {
      state.isRedeeming = false;
      renderGifts();
    }
  }

  async function initGiftPage() {
    bindStaticEvents();
    renderWallet();
    renderHistory();
    showStatus("正在初始化兌換頁...", "info");

    const publicGiftPromise = loadPublicGifts();

    try {
      await loadUserData();
      showStatus("帳戶資料已載入", "success");
    } catch (error) {
      console.warn("[gift] user data unavailable", error);
      showStatus("帳戶資料載入失敗", "warn");
      setHidden(refs.historyLoading, true);
      setHidden(refs.historyError, false);
    }

    if (state.user?.user_id) {
      await loadRedeemHistory();
    }

    await publicGiftPromise;

    if (state.gifts.length && state.user?.user_id) {
      setHidden(refs.giftPageStatus, true);
    } else if (state.gifts.length) {
      showStatus("商品已載入，帳戶資料讀取失敗", "warn");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (hasInitialized) {
      return;
    }

    hasInitialized = true;
    cacheDom();
    initGiftPage();
  }, { once: true });
})();
