document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("page-ready");
  initGiftPage();
});

const API_URL = "https://script.google.com/macros/s/AKfycbx4rw8EjTdp265gei6ke8teYbwD6ESactOT2WtX02wdQsplpDIAF3kr_JDimH_oMd4/exec";

const refs = {
  redeemButtons: [],
  pointCountEl: document.getElementById("pointCount"),
  ticketCountEl: document.getElementById("ticketCount"),
  giftListEl: document.getElementById("giftList"),
  giftStatusEl: document.getElementById("giftStatus")
};

function getUserProfile() {
  return window.UserStore?.getUserProfile
    ? window.UserStore.getUserProfile()
    : { userId: "", nickname: "" };
}

function getGiftData() {
  return window.GIFT_DATA || window.GiftData || [];
}

function setStatus(message) {
  if (refs.giftStatusEl) {
    refs.giftStatusEl.textContent = message;
  }
}

async function postApi(payload) {
  console.log("[gift debug] postApi payload =", payload);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  console.log("[gift debug] response status =", response.status, response.statusText);
  console.log("[gift debug] response ok =", response.ok);

  const text = await response.text();
  console.log("[gift debug] raw response text =", text);

  if (/<!DOCTYPE html>/i.test(text) || /<html/i.test(text)) {
    throw new Error("Apps Script 回傳 HTML 頁面，不是 JSON。可能是後端異常、網址錯誤，或 Google 暫時不穩。");
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    console.error("[gift debug] JSON parse failed =", error);
    throw new Error(`API 回傳不是有效 JSON：${text}`);
  }

  console.log("[gift debug] parsed response =", data);
  return data;
}

async function fetchRemoteUser() {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error("找不到 userId");
  }

  const payload = {
    action: "getUser",
    userId: profile.userId
  };

  console.log("[gift debug] fetchRemoteUser payload =", payload);

  const response = await postApi(payload);

  if (!response.ok) {
    throw new Error(response.message || "getUser 失敗");
  }

  console.log("[gift debug] fetchRemoteUser response.user =", response.user);
  return response.user;
}

function renderTopbar(remoteUser) {
  const points = Number(remoteUser?.points || 0);
  const tickets = Number(remoteUser?.tickets || 0);

  if (refs.pointCountEl) {
    refs.pointCountEl.textContent = points;
  }

  if (refs.ticketCountEl) {
    refs.ticketCountEl.textContent = tickets;
  }

  console.log("[gift debug] renderTopbar =", { points, tickets });
}

async function refreshTopbarFromRemote() {
  try {
    const remoteUser = await fetchRemoteUser();
    renderTopbar(remoteUser);
    return remoteUser;
  } catch (error) {
    console.error("[gift debug] refreshTopbarFromRemote failed =", error);
    setStatus(`讀取帳戶資料失敗：${error.message}`);
    throw error;
  }
}

async function adjustRemoteBalance({ pointsDelta = 0, ticketsDelta = 0, note = "", giftId = "", giftName = "" }) {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error("找不到 userId");
  }

  const payload = {
    action: "adjustBalance",
    userId: profile.userId,
    nickname: profile.nickname || "",
    pointsDelta: Number(pointsDelta || 0),
    ticketsDelta: Number(ticketsDelta || 0),
    source: "gift_page",
    operator: "system",
    note: note || giftName || "",
    giftId: giftId || "",
    giftName: giftName || ""
  };

  console.log("[gift debug] adjustRemoteBalance payload =", payload);

  const response = await postApi(payload);

  console.log("[gift debug] adjustRemoteBalance response =", response);

  if (!response.ok) {
    throw new Error(response.message || "adjustRemoteBalance 失敗");
  }

  return response;
}

function buildGiftCard(gift) {
  const id = String(gift?.id || "");
  const name = String(gift?.name || "未命名禮物");
  const desc = String(gift?.description || "");
  const image = String(gift?.image || "");
  const pointsCost = Number(gift?.pointsCost || 0);
  const ticketsCost = Number(gift?.ticketsCost || 0);

  return `
    <article class="soft-card gift-card">
      <div class="gift-card-media">
        ${
          image
            ? `<img class="gift-card-image" src="${image}" alt="${name}" loading="lazy" />`
            : `<div class="gift-card-placeholder">${name}</div>`
        }
      </div>

      <div class="gift-card-body">
        <h3 class="gift-card-title">${name}</h3>
        <p class="gift-card-desc">${desc}</p>

        <div class="gift-card-meta">
          <span>💎 ${pointsCost}</span>
          <span>🎟 ${ticketsCost}</span>
        </div>

        <div class="gift-card-actions">
          <button
            class="btn btn-start redeem-btn"
            type="button"
            data-gift-id="${id}"
          >
            立即兌換
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderGiftList() {
  if (!refs.giftListEl) return;

  const gifts = getGiftData();

  if (!Array.isArray(gifts) || !gifts.length) {
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
    console.log("[gift debug] redeemGift input gift =", gift);

    if (!gift) {
      throw new Error("找不到禮物資料");
    }

    const pointsCost = Number(gift.pointsCost || 0);
    const ticketsCost = Number(gift.ticketsCost || 0);

    setRedeemButtonsDisabled(true);
    setStatus(`正在兌換「${gift.name}」...`);

    const remoteUser = await fetchRemoteUser();
    console.log("[gift debug] redeemGift remoteUser =", remoteUser);

    const currentPoints = Number(remoteUser?.points || 0);
    const currentTickets = Number(remoteUser?.tickets || 0);

    if (currentPoints < pointsCost) {
      throw new Error(`點數不足，現在只有 ${currentPoints} 點，需要 ${pointsCost} 點`);
    }

    if (currentTickets < ticketsCost) {
      throw new Error(`兌換券不足，現在只有 ${currentTickets} 張，需要 ${ticketsCost} 張`);
    }

    const balanceResponse = await adjustRemoteBalance({
      pointsDelta: -pointsCost,
      ticketsDelta: -ticketsCost,
      note: `兌換禮物：${gift.name}`,
      giftId: gift.id,
      giftName: gift.name
    });

    console.log("[gift debug] balanceResponse =", balanceResponse);

    await refreshTopbarFromRemote();
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
  const gifts = getGiftData();
  const gift = Array.isArray(gifts) ? gifts.find((item) => String(item.id) === giftId) : null;

  redeemGift(gift);
}

async function initGiftPage() {
  try {
    renderGiftList();
    setStatus("正在讀取帳戶資料...");
    await refreshTopbarFromRemote();
    setStatus("請選擇想兌換的禮物。");
  } catch (error) {
    console.error("[gift debug] initGiftPage error =", error);
    setStatus(`初始化失敗：${error.message}`);
  }
}
