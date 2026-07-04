/* =========================
   Gacha Page Bootstrap
   - 頁面 ready 樣式
   - Supabase client 建立
   ========================= */

document.addEventListener("DOMContentLoaded", async () => {
  document.body.classList.add("page-ready");
  await window.UserStore.initUser();
  await initGachaPage();

});

const supabaseClient = window.supabaseClient;

/* =========================
   DOM Refs
   ========================= */
const refs = {
  drawBtnEl: document.getElementById('drawBtn'),
  drawBtnAltEl: document.getElementById('drawBtnAlt'),
  dropZoneEl: document.getElementById('dropZone'),
  gachaResultEl: document.getElementById('gachaResult'),
  recentDrawListEl: document.getElementById('recentDrawList'),
  coinCountEl: document.getElementById('coinCount'),
  pointCountEl: document.getElementById('pointCount'),
  ticketCountEl: document.getElementById('ticketCount'),
  collectionCountEl: document.getElementById('collectionCount'),
  watchAdBtnEl: document.getElementById('watchAdBtn'),
  adRemainingEl: document.getElementById('adRemaining'),
  machineEl: document.getElementById('gachaMachine')
};

/* =========================
   Runtime State
   ========================= */
let isDrawing = false;

/* =========================
   Global Module Accessors
   ========================= */
function getUI() {
  return window.GachaUI || null;
}

function getEngine() {
  return window.GachaEngine || null;
}

function getStorage() {
  return window.GachaStorage || null;
}

function getData() {
  return window.GachaData || null;
}

function getUserProfile() {
  return window.UserStore?.getUserProfile
    ? window.UserStore.getUserProfile()
    : { userId: '', nickname: '' };
}

/* =========================
   Supabase User Fetch
   ========================= */
async function fetchSupabaseUser() {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error('找不到 userId');
  }

  if (!supabaseClient) {
    throw new Error('Supabase SDK 尚未載入');
  }

  const { data, error } = await supabaseClient
    .from('users')
    .select('*')
    .eq('user_id', profile.userId)
    .single();

  if (error) {
    throw new Error(error.message || '讀取 Supabase users 失敗');
  }

  return data;
}

/* =========================
   Remote -> Local Sync
   - 將遠端帳戶數值同步到本地 storage
   ========================= */
function syncRemoteUserToLocal(remoteUser) {
  const storage = getStorage();
  if (!storage || !remoteUser) return;

  if (storage.setCoins) {
    storage.setCoins(Number(remoteUser.coins || 0));
  }

  if (storage.setPoints) {
    storage.setPoints(Number(remoteUser.points || 0));
  }

  if (storage.setTickets) {
    storage.setTickets(Number(remoteUser.tickets || 0));
  }

  console.log('[syncRemoteUserToLocal]', {
    coins: Number(remoteUser.coins || 0),
    points: Number(remoteUser.points || 0),
    tickets: Number(remoteUser.tickets || 0)
  });
}

/* =========================
   Local -> Remote Sync
   - 抽卡後同步 coins / points / tickets
   ========================= */
async function syncLocalStateToSupabase() {
  const storage = getStorage();
  const profile = getUserProfile();

  if (!storage) {
    throw new Error('GachaStorage 尚未載入');
  }

  if (!profile.userId) {
    throw new Error('找不到 userId');
  }

  if (!supabaseClient) {
    throw new Error('Supabase SDK 尚未載入');
  }

  const nextCoins = Number(storage.getCoins?.() || 0);
  const nextPoints = Number(storage.getPoints?.() || 0);
  const nextTickets = Number(storage.getTickets?.() || 0);

  console.log('[syncLocalStateToSupabase]', {
    userId: profile.userId,
    coins: nextCoins,
    points: nextPoints,
    tickets: nextTickets
  });

  const { data, error } = await supabaseClient
    .from('users')
    .update({
      coins: nextCoins,
      points: nextPoints,
      tickets: nextTickets,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', profile.userId)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(error.message || '同步 Supabase users 失敗');
  }

  if (!data) {
    throw new Error(`找不到要更新的 user：${profile.userId}`);
  }

  return data;
}

/* =========================
   Coins-only Remote Sync
   - 廣告補給只同步 coins
   ========================= */
async function syncCoinsToSupabase() {
  const storage = getStorage();
  const profile = getUserProfile();

  if (!storage) {
    throw new Error('GachaStorage 尚未載入');
  }

  if (!profile.userId) {
    throw new Error('找不到 userId');
  }

  if (!supabaseClient) {
    throw new Error('Supabase SDK 尚未載入');
  }

  const nextCoins = Number(storage.getCoins?.() || 0);

  console.log('[syncCoinsToSupabase]', {
    userId: profile.userId,
    coins: nextCoins
  });

  const { data, error } = await supabaseClient
    .from('users')
    .update({
      coins: nextCoins,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', profile.userId)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(error.message || '同步 Supabase coins 失敗');
  }

  if (!data) {
    throw new Error(`找不到要更新的 user：${profile.userId}`);
  }

  return data;
}

/* =========================
   Topbar State Builder
   ========================= */
function buildTopbarState(remoteUser) {
  const storage = getStorage();
  const data = getData();

  let coins = 0;
  let points = 0;
  let tickets = 0;
  let collection = [];
  let collectionTotal = 0;

  if (remoteUser) {
    coins = Number(remoteUser.coins || 0);
    points = Number(remoteUser.points || 0);
    tickets = Number(remoteUser.tickets || 0);
  } else if (storage) {
    if (storage.getCoins) {
      coins = Number(storage.getCoins() || 0);
    }

    if (storage.getPoints) {
      points = Number(storage.getPoints() || 0);
    }

    if (storage.getTickets) {
      tickets = Number(storage.getTickets() || 0);
    }
  }

  if (storage?.getCollection) {
    collection = storage.getCollection() || [];
  }

  if (Array.isArray(data?.pool)) {
    collectionTotal = data.pool.length;
  } else if (Array.isArray(data?.mascots)) {
    collectionTotal = data.mascots.length;
  }

  return {
    coins,
    points,
    tickets,
    collection,
    collectionTotal
  };
}

/* =========================
   Topbar Render
   ========================= */
function renderTopbar(remoteUser) {
  const ui = getUI();
  if (!ui?.renderTopbar) return;

  const state = buildTopbarState(remoteUser);
  console.log('[renderTopbar state]', state);
  ui.renderTopbar(state, refs);
}

/* =========================
   Remote Refresh
   ========================= */
async function refreshTopbarFromRemote() {
  try {
    const remoteUser = await fetchSupabaseUser();
    console.log('Supabase remoteUser =', remoteUser);

    syncRemoteUserToLocal(remoteUser);
    renderTopbar(remoteUser);
  } catch (error) {
    console.error('refreshTopbarFromRemote 失敗', error);
    renderTopbar();
  }
}

/* =========================
   Drawing State UI
   ========================= */
function setDrawingState(drawing) {
  const ui = getUI();
  const drawButtons = [refs.drawBtnEl, refs.drawBtnAltEl].filter(Boolean);

  drawButtons.forEach((button) => {
    button.disabled = drawing;
    button.textContent = drawing ? '轉動中...' : '轉一次';
  });

  if (refs.watchAdBtnEl) {
    refs.watchAdBtnEl.disabled = drawing || getRemainingAdRewards() <= 0;
  }

  if (ui?.setMachineDrawing) {
    ui.setMachineDrawing(refs.machineEl, drawing);
  }
}

/* =========================
   Draw Failure Handler
   ========================= */
function handleDrawFailure(response) {
  const ui = getUI();

  if (ui?.renderMessageResult) {
    ui.renderMessageResult(
      refs.gachaResultEl,
      response?.message || '目前無法抽取，請稍後再試。',
      'error'
    );
  } else {
    alert(response?.message || '目前無法抽取，請稍後再試。');
  }

  if (ui?.renderDropZoneIdle) {
    ui.renderDropZoneIdle(refs.dropZoneEl);
  }
}

/* =========================
   Draw Success Handler
   - 本地寫入已由 engine.drawOnce() 完成
   - 這裡只做 UI render
   ========================= */
function handleDrawSuccess(result) {
  const ui = getUI();
  const storage = getStorage();

  if (!ui || !result) return;

  console.log('[handleDrawSuccess result]', result);

  if (ui.renderDropZoneCapsule) {
    ui.renderDropZoneCapsule(refs.dropZoneEl, result.rarity);
  }

  if (ui.renderDrawResult) {
    ui.renderDrawResult(refs.gachaResultEl, result);
  }

  if (storage?.getRecentDraws && ui.renderRecentDraws) {
    ui.renderRecentDraws(storage.getRecentDraws(), refs.recentDrawListEl);
  }

  renderTopbar();
}

/* =========================
   Ad Reward Config
   - 廣告補給固定 coins +20
   ========================= */
function getAdConfig() {
  const config = window.APP_CONFIG || {};
  return {
    adRewardCoins: Number(config.adRewardCoins || 20),
    adRewardBonusPlay: Number(config.adRewardBonusPlay || 1),
    maxDailyAdRewards: Number(config.maxDailyAdRewards || 3)
  };
}

function getAdStorageKey() {
  return 'gachaDailyAdRewards';
}

function getTodayKey() {
  return new Date().toLocaleDateString('sv-SE');
}

function getAdRewardState() {
  try {
    const raw = localStorage.getItem(getAdStorageKey());

    if (!raw) {
      return {
        date: getTodayKey(),
        count: 0
      };
    }

    const parsed = JSON.parse(raw);

    if (parsed.date !== getTodayKey()) {
      return {
        date: getTodayKey(),
        count: 0
      };
    }

    return {
      date: parsed.date,
      count: Number(parsed.count || 0)
    };
  } catch (error) {
    return {
      date: getTodayKey(),
      count: 0
    };
  }
}

function setAdRewardState(state) {
  localStorage.setItem(getAdStorageKey(), JSON.stringify(state));
}

function getRemainingAdRewards() {
  const { maxDailyAdRewards } = getAdConfig();
  const state = getAdRewardState();
  return Math.max(0, maxDailyAdRewards - state.count);
}

function renderAdRemaining() {
  const remaining = getRemainingAdRewards();

  if (refs.adRemainingEl) {
    refs.adRemainingEl.textContent = remaining;
  }

  if (refs.watchAdBtnEl) {
    refs.watchAdBtnEl.disabled = isDrawing || remaining <= 0;
    refs.watchAdBtnEl.textContent = remaining <= 0 ? '今日已領完' : '觀看獎勵影片';
  }
}

/* =========================
   Ad Reward Grant
   - 本地加 coins +20
   - 遠端只同步 coins
   ========================= */
async function rewardAdBonus() {
  const storage = getStorage();
  const config = getAdConfig();
  const state = getAdRewardState();
  const remaining = getRemainingAdRewards();

  if (remaining <= 0) {
    alert('今日補給次數已用完。');
    renderAdRemaining();
    return;
  }

  if (storage?.addCoins) {
    storage.addCoins(config.adRewardCoins);
  } else if (storage?.getCoins && storage?.setCoins) {
    const currentCoins = Number(storage.getCoins() || 0);
    storage.setCoins(currentCoins + config.adRewardCoins);
  }

  state.count += 1;
  setAdRewardState(state);

  renderTopbar();
  renderAdRemaining();

  try {
    const syncedUser = await syncCoinsToSupabase();
    syncRemoteUserToLocal(syncedUser);
    renderTopbar(syncedUser);
  } catch (error) {
    console.error('補給後同步 Supabase coins 失敗', error);
  }

  alert(`補給成功！獲得 +${config.adRewardCoins} 好運幣`);
}

/* =========================
   Watch Ad Click
   ========================= */
function handleWatchAdClick() {
  if (!window.AdModal?.open) {
    console.warn('AdModal 尚未載入，改用直接發獎勵流程');
    rewardAdBonus();
    return;
  }

  window.AdModal.open(() => {
    rewardAdBonus();
  });
}

/* =========================
   Draw Click
   - engine.drawOnce() 內部已處理本地寫入
   - 成功後同步本地最新數值到 Supabase
   ========================= */
function handleDrawClick() {
  const ui = getUI();
  const engine = getEngine();

  if (isDrawing) return;

  if (!ui || !engine?.drawOnce) {
    console.warn('GachaUI 或 GachaEngine 尚未載入完成');
    return;
  }

  isDrawing = true;
  setDrawingState(true);

  if (ui.renderDropZoneLoading) {
    ui.renderDropZoneLoading(refs.dropZoneEl);
  }

  if (ui.renderLoadingResult) {
    ui.renderLoadingResult(refs.gachaResultEl);
  }

  window.setTimeout(async () => {
    try {
      const response = engine.drawOnce();
      console.log('[gacha] draw response =', response);

      if (!response?.ok) {
        handleDrawFailure(response);
        return;
      }

      handleDrawSuccess(response.result);

      try {
        const syncedUser = await syncLocalStateToSupabase();
        console.log('[gacha] syncedUser =', syncedUser);

        syncRemoteUserToLocal(syncedUser);
        renderTopbar(syncedUser);
      } catch (syncError) {
        console.error('抽卡後同步 Supabase 失敗', syncError);
      }
    } catch (error) {
      console.error('抽卡流程失敗', error);
      alert(`抽卡失敗：${error.message}`);
    } finally {
      isDrawing = false;
      setDrawingState(false);
      renderAdRemaining();
    }
  }, 600);
}

/* =========================
   Event Binding
   ========================= */
function bindEvents() {
  if (refs.drawBtnEl) {
    refs.drawBtnEl.addEventListener('click', handleDrawClick);
  }

  if (refs.drawBtnAltEl) {
    refs.drawBtnAltEl.addEventListener('click', handleDrawClick);
  }

  if (refs.watchAdBtnEl) {
    refs.watchAdBtnEl.addEventListener('click', handleWatchAdClick);
  }
}

/* =========================
   Page Init
   ========================= */
async function initGachaPage() {
  const ui = getUI();
  const storage = getStorage();

  if (!ui) {
    console.warn('GachaUI 尚未載入完成');
    return;
  }

  if (storage?.ensureDefaults) {
    storage.ensureDefaults({
      coins: 20,
      points: 0,
      tickets: 0,
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
      '準備好了就轉一次，看看今天的好運會掉下什麼。',
      'info'
    );
  }

  if (storage?.getRecentDraws && ui.renderRecentDraws) {
    ui.renderRecentDraws(storage.getRecentDraws(), refs.recentDrawListEl);
  }

  renderTopbar();
  await refreshTopbarFromRemote();
  renderAdRemaining();
  bindEvents();
}
/* ========================= Boot Entry ========================= */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGachaPage);
} else {
  initGachaPage();
}

