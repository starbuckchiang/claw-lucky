document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("page-ready");
  initGiftPage();
});

const refs = {
  redeemButtons: [],

  pointCountEl:
    document.getElementById("pointCount") ||
    document.getElementById("points"),

  ticketCountEl:
    document.getElementById("ticketCount") ||
    document.getElementById("tickets"),

  coinCountEl:
    document.getElementById("coinCount") ||
    document.getElementById("coins"),

  giftListEl:
    document.getElementById("giftList") ||
    document.getElementById("giftGrid"),

  giftStatusEl:
    document.getElementById("giftStatus")
};

let giftCache = [];

function getApi() {
  if (!window.Api) {
    throw new Error("Api 尚未初始化，請確認 api.js 已載入");
  }
  return window.Api;
}

function getUserProfile() {
  return window.UserStore?.getUserProfile
    ? window.UserStore.getUserProfile()
    : { userId: "", nickname: "" };
}

function setStatus(message) {
  if (refs.giftStatusEl) {
    refs.giftStatusEl.textContent = message;
  }
}

function normalizeGift(gift) {
  return {
    id: String(gift?.id || ""),
    name: String(gift?.name || "未命名禮物"),
    description: String(gift?.description || ""),
    image: String(gift?.image || ""),
    pointsCost: Number(gift?.points_cost || 0),
    ticketsCost: Number(gift?.tickets_cost || 0),
    coinsCost: Number(gift?.coins_cost || 0),
    stock: Number(gift?.stock || 0)
  };
}

async function fetchRemoteUser() {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error("找不到 userId");
  }

  const user = await getApi().getUser(profile.userId);

  if (!user) {
    throw new Error("Supabase 找不到這個使用者");
  }

  return user;
}

function renderTopbar(user) {
  const points = Number(user?.points || 0);
  const tickets = Number(user?.tickets || 0);
  const coins = Number(user?.coins || 0);

  if (refs.pointCountEl) {
    refs.pointCountEl.textContent = points;
  }

  if (refs.ticketCountEl) {
    refs.ticketCountEl.textContent = tickets;
  }

  if (refs.coinCountEl) {
    refs.coinCountEl.textContent = coins;
  }

  console.log("[gift debug] renderTopbar =", {
    points,
    tickets,
    coins,
    pointEl: refs.pointCountEl,
    ticketEl: refs.ticketCountEl
  });
}
async function refreshTopbarFromRemote() {
  const user = await fetchRemoteUser();
  renderTopbar(user);
  return user;
}

async function fetchGiftList() {
  const gifts = await getApi().getGiftList();
  giftCache = Array.isArray(gifts) ? gifts.map(normalizeGift) : [];
  return giftCache;
}

function buildGiftCard(gift) {
  const costItems = [];

  if (gift.pointsCost > 0) costItems.push(`<span>💎 ${gift.pointsCost}</span>`);
  if (gift.ticketsCost > 0) costItems.push(`<span>🎟 ${gift.ticketsCost}</span>`);
  if (gift.coinsCost > 0) costItems.push(`<span>🪙 ${gift.coinsCost}</span>`);

  if (!costItems.length) {
    costItems.push(`<span>免費</span>`);
  }

  return `
    <article class="soft-card gift-card">
      <div class="gift-card-media">
        ${
          gift.image
            ? `<img class="gift-card-image" src="${gift.image}" alt="${gift.name}" loading="lazy" />`
            : `<div class="gift-card-placeholder">${gift.name}</div>`
        }
      </div>

      <div class="gift-card-body">
        <h3 class="gift-card-title">${gift.name}</h3>
        <p class="gift-card-desc">${gift.description}</p>

        <div class="gift-card-meta">
          ${costItems.join("")}
          <span>庫存 ${gift.stock}</span>
        </div>

        <div class="gift-card-actions">
          <button
            class="btn btn-start redeem-btn"
            type="button"
            data-gift-id="${gift.id}"
            ${gift.stock <= 0 ? "disabled" : ""}
          >
            ${gift.stock <= 0 ? "已兌換完" : "立即兌換"}
          </button>
        </div>
      </div>
    </article>
  `;
}

async function renderGiftList() {
  if (!refs.giftListEl) return;

  setStatus("正在讀取禮物資料...");

  const gifts = await fetchGiftList();

  if (!gifts.length) {
    refs.giftListEl.innerHTML = `
      <div class="notice-box">目前沒有可兌換的禮物。</div>
    `;
    return;
  }

  refs.giftListEl.innerHTML = gifts.map(buildGiftCard).join("");

  refs.redeemButtons = Array.from(document.querySelectorAll(".redeem-btn"));

  refs.redeemButtons.forEach((button) => {
    button.addEventListener("click", handleRedeemClick);
  });
}

function setRedeemButtonsDisabled(disabled) {
  refs.redeemButtons.forEach((button) => {
    button.disabled = Boolean(disabled);
  });
}

async function redeemGift(gift) {
  try {
    if (!gift) {
      throw new Error("找不到禮物資料");
    }

    const profile = getUserProfile();

    if (!profile.userId) {
      throw new Error("找不到 userId");
    }

    setRedeemButtonsDisabled(true);
    setStatus(`正在兌換「${gift.name}」...`);

    const user = await fetchRemoteUser();

    const currentPoints = Number(user?.points || 0);
    const currentTickets = Number(user?.tickets || 0);
    const currentCoins = Number(user?.coins || 0);

    if (currentPoints < gift.pointsCost) {
      throw new Error(`點數不足，現在只有 ${currentPoints} 點，需要 ${gift.pointsCost} 點`);
    }

    if (currentTickets < gift.ticketsCost) {
      throw new Error(`兌換券不足，現在只有 ${currentTickets} 張，需要 ${gift.ticketsCost} 張`);
    }

    if (currentCoins < gift.coinsCost) {
      throw new Error(`金幣不足，現在只有 ${currentCoins} 枚，需要 ${gift.coinsCost} 枚`);
    }

    const result = await getApi().redeemGift({
      userId: profile.userId,
      nickname: profile.nickname || "",
      giftId: gift.id,
      giftName: gift.name,
      pointsCost: gift.pointsCost,
      ticketsCost: gift.ticketsCost,
      coinsCost: gift.coinsCost,
      note: `兌換禮物：${gift.name}`
    });

    await getApi().decreaseGiftStock(gift.id, 1);

    renderTopbar(result.user);

    await renderGiftList();

    setStatus(`兌換成功：${gift.name}`);
    alert(`兌換成功：${gift.name}`);
  } catch (error) {
    console.error("[gift debug] redeemGift error =", error);
    setStatus(`兌換失敗：${error.message}`);
    alert(`兌換失敗：${error.message}`);
  } finally {
    setRedeemButtonsDisabled(false);
  }
}

function handleRedeemClick(event) {
  const button = event.currentTarget;
  const giftId = String(button.dataset.giftId || "");

  const gift = giftCache.find((item) => String(item.id) === giftId);

  redeemGift(gift);
}

async function initGiftPage() {
  try {
    setStatus("正在初始化禮物頁...");
    await renderGiftList();

    setStatus("正在讀取帳戶資料...");
    await refreshTopbarFromRemote();

    setStatus("請選擇想兌換的禮物。");
  } catch (error) {
    console.error("[gift debug] initGiftPage error =", error);
    setStatus(`初始化失敗：${error.message}`);
  }
}
