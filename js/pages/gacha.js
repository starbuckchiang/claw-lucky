/* =========================
   Gacha Page Bootstrap
   - 頁面 ready 樣式
   - Supabase client 建立
   ========================= */
document.documentElement.classList.add('page-ready');

const SUPABASE_URL = 'https://umtqpstacjdwxcvcirbl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PtWhyYhKGUVxph4o80oGbg_aeZVnUyk';

const supabaseClient = window.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

if (!supabaseClient) {
  console.warn('Supabase SDK 尚未載入，將使用本地資料 fallback。');
}

/* =========================
   DOM Refs
   - 集中管理頁面會用到的節點
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
   - 控制抽卡中狀態，避免重複點擊
   ========================= */
let isDrawing = false;

/* =========================
   Global Module Accessors
   - 從 window 讀取已載入的模組
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
   - 讀取遠端 users 表中的使用者資料
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
   Topbar State Builder
   - 遠端資料優先
   - 本地 storage 作為 fallback
   - 收藏數仍以本地 collection 為主
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
   - 將 state 丟給 UI 模組統一渲染
   ========================= */
function renderTopbar(remoteUser) {
  const ui = getUI();
  if (!ui?.renderTopbar) return;

  const state = buildTopbarState(remoteUser);
  console.log('[renderTopbar state]', state);
  ui.renderTopbar(state, refs);
}

/* =========================
   Remote Sync
   - 從 Supabase 抓最新帳戶資料後刷新 topbar
   ========================= */
async function refreshTopbarFromRemote() {
  try {
    const remoteUser = await fetchSupabaseUser();
    console.log('Supabase remoteUser =', remoteUser);
    renderTopbar(remoteUser);
  } catch (error) {
    console.error('refreshTopbarFromRemote 失敗', error);
    renderTopbar();
  }
}

/* =========================
   Drawing State UI
   - 控制抽卡按鈕與機台動畫狀態
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
   - 抽卡失敗時顯示錯誤訊息
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
   - 更新掉落區、結果卡
   - 寫入本地 storage
   - 更新 recent draws / collection / topbar
   ========================= */
function handleDrawSuccess(result) {
  const ui = getUI();
  const storage = getStorage();

  if (!ui || !result) return;

  if (ui.renderDropZoneCapsule) {
    ui.renderDropZoneCapsule(refs.dropZoneEl, result.rarity);
  }

  if (ui.renderDrawResult) {
    ui.renderDrawResult(refs.gachaResultEl, result);
  }

  if (storage?.addRecentDraw) {
    storage.addRecentDraw({
      id: result.id,
      name: result.name,
      image: result.image || '',
      rarity: result.rarity,
      points: Number(result.pointsEarned || result.points || 0),
      tickets: Number(result.ticketsEarned || result.tickets || 0),
      isNew: Boolean(result.isNew),
      createdAt: Date.now()
    });
  }

  if (storage?.addToCollection && result?.isNew && result?.id) {
    storage.addToCollection(result.id);
  }

  if (storage?.addPoints) {
    storage.addPoints(Number(result.pointsEarned || result.points || 0));
  }

  if (storage?.addTickets) {
    storage.addTickets(Number(result.ticketsEarned || result.tickets || 0));
  }

  if (storage?.getRecentDraws && ui.renderRecentDraws) {
    ui.renderRecentDraws(storage.getRecentDraws(), refs.recentDrawListEl);
  }

  renderTopbar();
}

/* =========================
   Ad Reward Config
   - 廣告補給相關設定與本地每日次數紀錄
   ========================= */
function getAdConfig() {
  const config = window.APP_CONFIG || {};
  return {
    adRewardCoins: Number(config.adRewardCoins || 100),
    adRewardBonusPlay: Number(config.adRewardBonusPlay || 1),
    maxDailyAdRewards: Number(config.maxDailyAdRewards || 5)
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
   - 本地補給：加好運幣
   - 更新每日次數與 topbar
   ========================= */
function rewardAdBonus() {
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

  alert(
    `補給成功！獲得 +${config.adRewardCoins} 好運幣` +
    (config.adRewardBonusPlay ? `、+${config.adRewardBonusPlay} 次免費機會` : '')
  );
}

/* =========================
   Watch Ad Click
   - 優先用 AdModal 播影片
   - 若 modal 未載入，直接 fallback 發獎勵
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
   - 啟動抽卡流程
   - 執行 engine.drawOnce()
   - 成功後更新 UI / storage / topbar
   - 最後再同步遠端帳戶資料
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

      if (!response?.ok) {
        handleDrawFailure(response);
        return;
      }

      handleDrawSuccess(response.result);

      // 抽卡後重新抓一次遠端帳戶資料
      await refreshTopbarFromRemote();
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
   - 綁定抽卡按鈕 / 廣告補給按鈕
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
   - 初始化 storage 預設值
   - 初始化掉落區 / 結果區 / 最近抽到
   - 先 render 本地，再同步遠端
   - 最後綁定事件
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

/* =========================
   Boot Entry
   - DOM ready 後啟動頁面初始化
   ========================= */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGachaPage);
} else {
  initGachaPage();
}
