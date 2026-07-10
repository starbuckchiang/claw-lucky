/* ============================================================
   Gacha Page
   ------------------------------------------------------------
   負責：
   1. 抽蛋頁初始化
   2. 抽蛋按鈕流程
   3. Event Binding
   4. 呼叫 Topbar / Engine / UI / Storage / AdReward 模組

   注意：
   - coins / points / tickets 以 Supabase 為唯一資料來源
   - localStorage 只保存 collection / recentDraws / ad daily state
   - user_mascots 由 Supabase 保存玩家收藏
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  document.body.classList.add("page-ready");

  await window.UserStore.initUser();
  await initGachaPage();
});

/* ============================================================
   DOM References
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
   ============================================================ */

let isDrawing = false;
let eventsBound = false;

/* ============================================================
   Module Accessors
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

async function getAuthProfile() {
  if (!window.userReadyPromise && window.UserStore?.initUser) {
    window.userReadyPromise = window.UserStore.initUser();
  }

  const user = window.userReadyPromise
    ? await window.userReadyPromise
    : null;

  let userId = String(user?.user_id || "").trim();

  if (!userId && window.ClawUser?.getUserId) {
    userId = String(await window.ClawUser.getUserId() || "").trim();
  }

  return {
    userId,
    nickname: String(user?.nickname || "").trim()
  };
}

/* ============================================================
   Topbar Wrapper
   ============================================================ */

function renderTopbar(remoteUser) {
  window.Topbar.render(remoteUser, refs);
}

async function refreshTopbarFromRemote() {
  return window.Topbar.refresh(refs);
}

/* ============================================================
   Ad Reward Wrapper
   ============================================================ */

function renderAdRemaining() {
  window.AdReward.renderRemaining({
    refs,
    isDrawing
  });
}

function handleWatchAdClick() {
  window.AdReward.handleClick({
    refs,
    refreshTopbar: refreshTopbarFromRemote,
    getIsDrawing: () => isDrawing
  });
}

/* ============================================================
   Drawing State UI
   ============================================================ */

function setDrawingState(drawing) {
  const ui = getUI();
  const drawButtons = [refs.drawBtnEl, refs.drawBtnAltEl].filter(Boolean);

  isDrawing = Boolean(drawing);

  drawButtons.forEach((button) => {
    button.disabled = isDrawing;
    button.textContent = isDrawing ? "轉動中..." : "轉一次";
  });

  renderAdRemaining();

  if (ui?.setMachineDrawing) {
    ui.setMachineDrawing(refs.machineEl, isDrawing);
  }
}

/* ============================================================
   Draw Failure
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
   只處理前端 UI / local cache：
   - collection
   - recentDraws
   - 掉落膠囊
   - 結果卡片
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
   抽吉祥物改從supabase抽, 失敗才從本地 GachaData抽。
   ============================================================ */
async function loadMascotsFromSupabase() {
  if (!window.Api?.getMascots) {
    console.warn("Api.getMascots 尚未建立，改用本地 GachaData");
    return;
  }

  const mascots = await window.Api.getMascots();

  if (!Array.isArray(mascots) || !mascots.length) {
    console.warn("Supabase mascots 為空，改用本地 GachaData");
    return;
  }

  if (!window.GachaData) {
    window.GachaData = {};
  }

  window.GachaData.mascots = mascots.map((item) => ({
    id: item.id,
    name: item.name,
    rarity: item.rarity,
    title: item.title || "",
    description: item.description || "",
    image: item.image || "",
    silhouette: item.silhouette || "./images/mascots/mascot-shadow.png",
    points: Number(item.points || 0),
    tickets: Number(item.tickets || 0),
    duplicateBonus: Number(item.duplicate_bonus || 0)
  }));

  window.GachaData.getMascotById = function (mascotId) {
    return window.GachaData.mascots.find((item) => item.id === mascotId) || null;
  };

  window.GachaData.getMascotsByRarity = function (rarityCode) {
    return window.GachaData.mascots.filter((item) => item.rarity === rarityCode);
  };

  console.log("[gacha] mascots loaded from Supabase =", window.GachaData.mascots.length);
}

/* ============================================================
   Sync Mascot Collection To Supabase
   ------------------------------------------------------------
   將抽到的吉祥物寫入 user_mascots。
   如果已經擁有，則更新 obtain_count / last_obtained_at。
   ============================================================ */

async function syncMascotToSupabase(profile, result) {
  if (!profile?.userId || !result?.id) return null;

  if (!getApi().upsertUserMascot) {
    console.warn("Api.upsertUserMascot 尚未建立，略過收藏同步");
    return null;
  }

  return getApi().upsertUserMascot({
    userId: profile.userId,
    mascotId: result.id,
    mascotName: result.name,
    rarity: result.rarity,
    image: result.image || ""
  });
}


/* ============================================================
   Draw Click
   ------------------------------------------------------------
   抽蛋主要流程：
   1. 讀取 Supabase user
   2. 用目前 coins 判斷能否抽
   3. GachaEngine 抽結果
   4. Supabase 扣 coins / 加 points / tickets
   5. Supabase 寫入 user_mascots
   6. 更新畫面
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
      const profile = await getAuthProfile();

      if (!profile.userId) {
        throw new Error("找不到 auth userId");
      }

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
   
      await syncMascotToSupabase(profile, result);

      renderTopbar(updatedUser);
    } catch (error) {
      console.error("抽卡流程失敗", error);
      alert(`抽卡失敗：${error.message}`);
    } finally {
      setDrawingState(false);
    }
  }, 600);
}

/* ============================================================
   Event Binding
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
   Page Init
   ============================================================ */

async function initGachaPage() {
  const ui = getUI();
  const storage = getStorage();

  if (!ui) {
    console.warn("GachaUI 尚未載入完成");
    return;
  }

 await loadMascotsFromSupabase();

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
