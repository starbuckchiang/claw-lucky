/* ============================================================
   Gacha Page
   ------------------------------------------------------------
   負責：
   1. 抽蛋頁初始化
   2. 抽蛋按鈕流程
   3. 廣告獎勵流程
   4. Event Binding
   5. 呼叫 Topbar / Engine / UI / Storage 模組
   ============================================================ */


/* ============================================================
   Bootstrap
   ------------------------------------------------------------
   頁面載入完成後：
   - 加上 page-ready 樣式
   - 初始化 UserStore
   - 初始化抽蛋頁
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  document.body.classList.add("page-ready");

  await window.UserStore.initUser();
  await initGachaPage();
});


/* ============================================================
   DOM References
   ------------------------------------------------------------
   統一管理本頁會用到的 DOM 元素
   ============================================================ */

const refs = {
  drawBtnEl: document.getElementById("drawBtn"),
  drawBtnAltEl: document.getElementById("drawBtnAlt"),

  dropZoneEl: document.getElementById("dropZone"),
  gachaResultEl: document.getElementById("gachaResult"),
  recentDrawListEl: document.getElementById("recentDrawList"),

  coinCountEl: document.getElementById("coinCount"),
  pointCountEl: document.getElementById("pointCount"),
  ticketCountEl: document.getElementById("ticketCount"),
  collectionCountEl: document.getElementById("collectionCount"),

  watchAdBtnEl: document.getElementById("watchAdBtn"),
  adRemainingEl: document.getElementById("adRemaining"),

  machineEl: document.getElementById("gachaMachine")
};


/* ============================================================
   Runtime State
   ------------------------------------------------------------
   isDrawing:
   - 防止連點抽蛋
   eventsBound:
   - 防止事件重複綁定
   ============================================================ */

let isDrawing = false;
let eventsBound = false;


/* ============================================================
   Module Accessors
   ------------------------------------------------------------
   統一取得全域模組，避免在流程中直接散落 window.xxx
   ============================================================ */

function getUI() {
  return window.GachaUI || null;
}

function getEngine() {
  return window.GachaEngine || null;
}

function getStorage() {
  return window.GachaStorage || null;
}

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


/* ============================================================
   Topbar Wrapper
   ------------------------------------------------------------
   Topbar 實際邏輯已拆到：
   js/ui/topbar.js

   gacha.js 只保留 wrapper，避免其他流程大改。
   ============================================================ */

function renderTopbar(remoteUser) {
  window.Topbar.render(remoteUser, refs);
}

async function refreshTopbarFromRemote() {
  return window.Topbar.refresh(refs);
}


/* ============================================================
   Drawing State UI
   ------------------------------------------------------------
   控制抽蛋中狀態：
   - 禁用抽蛋按鈕
   - 禁用廣告按鈕
   - 切換機台動畫狀態
   ============================================================ */

function setDrawingState(drawing) {
  const ui = getUI();
  const drawButtons = [refs.drawBtnEl, refs.drawBtnAltEl].filter(Boolean);

  isDrawing = Boolean(drawing);

  drawButtons.forEach((button) => {
    button.disabled = isDrawing;
    button.textContent = isDrawing ? "轉動中..." : "轉一次";
  });

  const remaining = window.AdStorage?.getRemaining
    ? window.AdStorage.getRemaining()
    : 0;

  if (refs.watchAdBtnEl) {
    refs.watchAdBtnEl.disabled = isDrawing || remaining <= 0;
  }

  if (ui?.setMachineDrawing) {
    ui.setMachineDrawing(refs.machineEl, isDrawing);
  }
}


/* ============================================================
   Draw Failure
   ------------------------------------------------------------
   抽蛋失敗時：
   - 顯示錯誤訊息
   - 將掉落區恢復待機狀態
   ============================================================ */

function handleDrawFailure(response) {
  const ui = getUI();

  const message =
    response?.message || "目前無法抽取，請稍後再試。";

  if (ui?.renderMessageResult) {
    ui.renderMessageResult(
      refs.gachaResultEl,
      message,
      "error"
    );
  } else {
    alert(message);
  }

  if (ui?.renderDropZoneIdle) {
    ui.renderDropZoneIdle(refs.dropZoneEl);
  }
}


/* ============================================================
   Draw Success
   ------------------------------------------------------------
   抽蛋成功時：
   - 將結果寫入收藏 / 最近抽卡
   - 顯示膠囊
   - 顯示抽卡結果
   - 更新最近抽卡清單
   ============================================================ */

function handleDrawSuccess(result) {
  const ui = getUI();
  const storage = getStorage();
  const engine = getEngine();

  if (!ui || !result) return;

  engine?.commitDrawResult?.(result);

  if (ui.renderDropZoneCapsule) {
    ui.renderDropZoneCapsule(refs.dropZoneEl, result.rarity);
  }

  if (ui.renderDrawResult) {
    ui.renderDrawResult(refs.gachaResultEl, result);
  }

  if (storage?.getRecentDraws && ui.renderRecentDraws) {
    ui.renderRecentDraws(
      storage.getRecentDraws(),
      refs.recentDrawListEl
    );
  }
}


/* ============================================================
   Draw Click
   ------------------------------------------------------------
   抽蛋主要流程：

   1. 防止連點
   2. 從 Supabase 讀取目前 coins
   3. 交給 GachaEngine 抽出結果
   4. 用 Api.adjustBalance 扣 coins、加 points/tickets
   5. 成功後更新 UI 與 Topbar

   注意：
   - coins / points / tickets 以 Supabase 為唯一資料來源
   - localStorage 只保存 collection / recentDraws
   ============================================================ */

function handleDrawClick() {
  const ui = getUI();
  const engine = getEngine();

  if (isDrawing) return;

  if (!ui || !engine?.drawOnce) {
    console.warn("GachaUI 或 GachaEngine 尚未載入完成");
    return;
  }

  setDrawingState(true);

  if (ui.renderDropZoneLoading) {
    ui.renderDropZoneLoading(refs.dropZoneEl);
  }

  if (ui.renderLoadingResult) {
    ui.renderLoadingResult(refs.gachaResultEl);
  }

  window.setTimeout(async () => {
    try {
      const profile = getUserProfile();

      const remoteUser = await getApi().getUser(profile.userId);

      if (!remoteUser) {
        throw new Error("找不到使用者資料");
      }

      const currentCoins = Number(remoteUser.coins || 0);

      const response = engine.drawOnce({
        currentCoins
      });

      if (!response?.ok) {
        handleDrawFailure(response);
        return;
      }

      const result = response.result;

      const updatedUser = await getApi().adjustBalance({
        userId: profile.userId,
        nickname: profile.nickname,
        coinsDelta: -1,
        pointsDelta: Number(result.pointsEarned || 0),
        ticketsDelta: Number(result.ticketsEarned || 0),
        source: "gacha_draw",
        note: `抽到 ${result.name}`,
        actionType: "gacha_draw"
      });

      handleDrawSuccess(result);

      renderTopbar(updatedUser);
    } catch (error) {
      console.error("抽卡流程失敗", error);
      alert(`抽卡失敗：${error.message}`);
    } finally {
      setDrawingState(false);
      renderAdRemaining();
    }
  }, 600);
}


/* ============================================================
   Event Binding
   ------------------------------------------------------------
   綁定頁面事件。
   使用 eventsBound 避免重複初始化造成重複綁定。
   ============================================================ */

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  if (refs.drawBtnEl) {
    refs.drawBtnEl.addEventListener("click", handleDrawClick);
  }

  if (refs.drawBtnAltEl) {
    refs.drawBtnAltEl.addEventListener("click", handleDrawClick);
  }

  if (refs.watchAdBtnEl) {
    refs.watchAdBtnEl.addEventListener("click", handleWatchAdClick);
  }
}


/* ============================================================
   Ad Remaining
   ------------------------------------------------------------
   顯示今日剩餘廣告補給次數，並控制廣告按鈕狀態。
   實際每日次數邏輯由：
   js/storage/ad-storage.js
   負責。
   ============================================================ */

function renderAdRemaining() {
  const remaining = window.AdStorage?.getRemaining
    ? window.AdStorage.getRemaining()
    : 0;

  if (refs.adRemainingEl) {
    refs.adRemainingEl.textContent = remaining;
  }

  if (refs.watchAdBtnEl) {
    refs.watchAdBtnEl.disabled = isDrawing || remaining <= 0;

    refs.watchAdBtnEl.textContent =
      remaining <= 0
        ? "今日已領完"
        : "觀看獎勵影片";
  }
}


/* ============================================================
   Ad Reward
   ------------------------------------------------------------
   廣告補給流程：

   1. 檢查今日剩餘次數
   2. 透過 Api.adjustBalance 增加 coins
   3. 更新本地每日廣告次數
   4. 重新讀取 Supabase user
   5. 更新 Topbar
   ============================================================ */

async function rewardAdBonus() {
  const config = window.AdConfig.getAdConfig();
  const state = window.AdStorage.getState();
  const remaining = window.AdStorage.getRemaining();

  if (remaining <= 0) {
    alert("今日補給次數已用完。");
    renderAdRemaining();
    return;
  }

  const profile = getUserProfile();

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
    window.AdStorage.saveState(state);

    const remoteUser = await refreshTopbarFromRemote();

    renderAdRemaining();

    alert(`補給成功！獲得 ${config.adRewardCoins} 好運幣`);

    return remoteUser;
  } catch (error) {
    console.error("[rewardAdBonus]", error);
    alert("補給失敗，請稍後再試。");
  }
}


/* ============================================================
   Watch Ad Button
   ------------------------------------------------------------
   點擊觀看廣告：
   - 若 AdModal 存在，開啟 modal
   - 若 AdModal 尚未載入，直接走補給流程
   ============================================================ */

function handleWatchAdClick() {
  if (!window.AdModal?.open) {
    console.warn("AdModal 尚未載入，直接發放獎勵");
    rewardAdBonus();
    return;
  }

  window.AdModal.open(async () => {
    await rewardAdBonus();
  });
}


/* ============================================================
   Page Init
   ------------------------------------------------------------
   初始化頁面：

   1. 確認 GachaUI 已載入
   2. 初始化 localStorage cache
      - collection
      - recentDraws
   3. 初始化抽蛋 UI
   4. 渲染最近抽卡
   5. 從 Supabase 讀取 Topbar
   6. 渲染廣告剩餘次數
   7. 綁定事件
   ============================================================ */

async function initGachaPage() {
  const ui = getUI();
  const storage = getStorage();

  if (!ui) {
    console.warn("GachaUI 尚未載入完成");
    return;
  }

  if (storage?.ensureDefaults) {
    storage.ensureDefaults({
      collection: [],
      recentDraws: []
    });
  }

  if (ui.renderDropZoneIdle) {
    ui.renderDropZoneIdle(refs.dropZoneEl);
  }

  if (ui.renderIdleResult) {
    ui.renderIdleResult(refs.gachaResultEl);
  } else if (ui.renderMessageResult) {
    ui.renderMessageResult(
      refs.gachaResultEl,
      "準備好了就轉一次，看看今天的好運會掉下什麼。",
      "info"
    );
  }

  if (storage?.getRecentDraws && ui.renderRecentDraws) {
    ui.renderRecentDraws(
      storage.getRecentDraws(),
      refs.recentDrawListEl
    );
  }

  await refreshTopbarFromRemote();

  renderAdRemaining();

  bindEvents();
}
