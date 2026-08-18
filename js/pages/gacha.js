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
  gachaPageStatusEl: document.getElementById("gachaPageStatus"),

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
   Load Error Display
   ------------------------------------------------------------
   不得將API錯誤轉成看似正常的0：若coins/points/tickets無法從
   Supabase取得，需明確顯示載入失敗，並將數字欄位改為 — ，
   避免static HTML預設的 "0" 永遠留在畫面上誤導使用者。
   ============================================================ */
function showLoadError(message) {
  [refs.coinCountEl, refs.pointCountEl, refs.ticketCountEl].forEach((el) => {
    if (el) el.textContent = "—";
  });

  if (refs.gachaPageStatusEl) {
    refs.gachaPageStatusEl.textContent = message;
    refs.gachaPageStatusEl.dataset.tone = "error";
    refs.gachaPageStatusEl.classList.remove("hidden");
  }
}

function clearLoadError() {
  if (refs.gachaPageStatusEl) {
    refs.gachaPageStatusEl.textContent = "";
    refs.gachaPageStatusEl.classList.add("hidden");
  }
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
   抽到的吉祥物現在由 claim_gacha_draw 在伺服器端原子性寫入 user_mascots
   （與扣款/獲獎/紀錄同一交易，P-AUTH-05B-2A 需求 3）—不再需要前端別外呼叫
   upsertUserMascot()。
   ============================================================ */

// P-AUTH-05B-2A hotfix (requirement 5): the idempotency key for a gacha
// draw is created ONCE when the draw attempt begins and held here until
// that attempt definitively completes (success, or a non-retryable
// business rejection) — a manual retry of the SAME attempt (e.g. after a
// network failure) reuses this SAME key; it is NEVER regenerated per
// retry. `null` means no draw attempt is currently pending.
let pendingDrawIdempotencyKey = null;

function getOrCreateDrawIdempotencyKey() {
  if (!pendingDrawIdempotencyKey) {
    pendingDrawIdempotencyKey = window.crypto.randomUUID();
  }
  return pendingDrawIdempotencyKey;
}

// P-AUTH-05B-2A hotfix (requirement 1): builds the UI-facing result object
// SOLELY from the server's authoritative claim (mascot/rarity/reward) —
// `window.GachaData`'s catalog is consulted ONLY for cosmetic display
// fields (title/description/silhouette) that the RPC doesn't return, NEVER
// to decide or override the outcome itself.
function buildResultFromServerClaim(claim) {
  const catalogMascot = window.GachaData?.getMascotById
    ? window.GachaData.getMascotById(claim.mascot_id)
    : null;
  const rarityConfig = window.GachaData?.getRarityConfig
    ? window.GachaData.getRarityConfig(claim.rarity)
    : null;
  const isNew = Boolean(claim.is_new);

  return {
    id: claim.mascot_id,
    name: claim.mascot_name || catalogMascot?.name || "",
    rarity: claim.rarity,
    rarityLabel: rarityConfig?.label || claim.rarity,
    rarityColor: rarityConfig?.color || "#8b6a43",
    rarityGlow: rarityConfig?.glow || "rgba(139, 106, 67, 0.28)",
    title: catalogMascot?.title || "",
    description: catalogMascot?.description || "",
    image: claim.image || catalogMascot?.image || "",
    silhouette: catalogMascot?.silhouette || "",
    isNew,
    pointsEarned: Number(claim.points_earned || 0),
    ticketsEarned: Number(claim.tickets_earned || 0),
    duplicateBonus: isNew ? 0 : Number(claim.points_earned || 0),
    coinsCost: Math.abs(Number(claim.coins_delta || 1)),
    createdAt: Date.now()
  };
}

/* ============================================================
   Draw Click
   ------------------------------------------------------------
   抽蛋主要流程（P-AUTH-05B-2A hotfix 需求 1：前端只播放動畫及顯示伺服器
   結果，實際抽中哪隻吉祥物、稀有度、獎勵一律由 claim_gacha_draw 在伺服器
   端決定）：
   1. 讀取 Supabase user（僅供「好運幣不足」的 UX 提示，非權威判斷）
   2. 呼叫 claim_gacha_draw（伺服器端抽獎 + 扣款 + 發獎 + 收藏 + 紀錄）
   3. 用伺服器回傳的結果播放動畫、更新畫面
   ============================================================ */

function handleDrawClick() {
  const ui = getUI();

  if (isDrawing) return;

  if (!ui) {
    console.warn("GachaUI 尚未載入完成");
    return;
  }

  setDrawingState(true);

  if (ui.renderDropZoneLoading) {
    ui.renderDropZoneLoading(refs.dropZoneEl);
  }

  if (ui.renderLoadingResult) {
    ui.renderLoadingResult(refs.gachaResultEl);
  }

  // P-AUTH-05B-2A hotfix (requirement 5): generated/reused ONCE per draw
  // attempt, BEFORE the network call — never inside the retry path.
  const idempotencyKey = getOrCreateDrawIdempotencyKey();

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

      // UX-only pre-check — never authoritative. The server independently
      // re-verifies the real coin balance inside claim_gacha_draw and will
      // reject the request on its own if this check is stale/bypassed.
      if (Number(remoteUser.coins || 0) <= 0) {
        handleDrawFailure({ message: "好運幣不足，無法轉蛋。" });
        pendingDrawIdempotencyKey = null;
        return;
      }

      // P-AUTH-05B-2A hotfix (requirement 1): sends ONLY the idempotency
      // key. The server decides which mascot/rarity was drawn and computes
      // the reward — the client never supplies a mascotId, a rarity, a
      // reward amount, or an "isNew" flag, and cannot influence the
      // outcome.
      const claim = await getApi().claimGachaDraw({ idempotencyKey });

      const result = buildResultFromServerClaim(claim);

      handleDrawSuccess(result);
      pendingDrawIdempotencyKey = null;

      renderTopbar({
        points: claim.user_points,
        tickets: claim.user_tickets,
        coins: claim.user_coins
      });
    } catch (error) {
      console.error("抽卡流程失敗", error);
      alert(`抽卡失敗：${error.message}`);

      // P-AUTH-05B-2A hotfix (requirement 5): only a genuine network-layer
      // failure (`error.retryable === true`, see js/api.js's
      // invokeWalletOpsFunction) keeps the SAME idempotency key alive for
      // a manual retry click — a definitive business rejection (e.g.
      // insufficient coins) clears it, since the user must change
      // something (get more coins) before a retry could ever succeed.
      if (!error?.retryable) {
        pendingDrawIdempotencyKey = null;
      }
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

  try {
    await loadMascotsFromSupabase();
  } catch (error) {
    console.error("[gacha] loadMascotsFromSupabase 失敗，改用本地 GachaData", error);
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

  try {
    await refreshTopbarFromRemote();
    clearLoadError();
  } catch (error) {
    console.error("[gacha] refreshTopbarFromRemote 失敗", error);
    showLoadError("資料載入失敗，請重新整理或登入。");
  }

  renderAdRemaining();

  bindEvents();
}
