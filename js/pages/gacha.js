document.documentElement.classList.add('page-ready');

const API_URL = 'https://script.google.com/macros/s/AKfycbx4rw8EjTdp265gei6ke8teYbwD6ESactOT2WtX02wdQsplpDIAF3kr_JDimH_oMd4/exec';

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

let isDrawing = false;

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

async function postApi(payload) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`API 回傳不是有效 JSON：${text}`);
  }

  return data;
}

async function claimGachaReward(result) {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error('找不到 userId');
  }

  const payload = {
    action: 'claimGachaReward',
    userId: profile.userId,
    nickname: profile.nickname || '',
    pointsReward: Number(result?.pointsEarned || result?.points || 0),
    ticketsReward: Number(result?.ticketsEarned || result?.tickets || 0),
    mascotId: String(result?.id || ''),
    reason: 'gacha_draw_reward',
    source: 'gacha_page',
    operator: 'system',
    note: String(result?.name || '')
  };

  const response = await postApi(payload);

  if (!response.ok) {
    throw new Error(response.message || 'claimGachaReward 失敗');
  }

  return response;
}

async function fetchRemoteUser() {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error('找不到 userId');
  }

  const response = await postApi({
    action: 'getUser',
    userId: profile.userId
  });

  if (!response.ok) {
    throw new Error(response.message || 'getUser 失敗');
  }

  return response.user;
}

function buildTopbarState(remoteUser) {
  const storage = getStorage();
  const data = getData();

  let coins = 0;
  let points = 0;
  let tickets = 0;
  let collection = [];
  let collectionTotal = 0;

  if (storage?.getCoins) {
    coins = Number(storage.getCoins() || 0);
  }

  if (remoteUser) {
    points = Number(remoteUser.points || 0);
    tickets = Number(remoteUser.tickets || 0);
  } else {
    if (storage?.getPoints) {
      points = Number(storage.getPoints() || 0);
    }

    if (storage?.getTickets) {
      tickets = Number(storage.getTickets() || 0);
    }
  }

  if (storage?.getCollection) {
    collection = storage.getCollection() || [];
  }

  if (Array.isArray(data?.pool)) {
    collectionTotal = data.pool.length;
  }

  return {
    coins,
    points,
    tickets,
    collection,
    collectionTotal
  };
}

function renderTopbar(remoteUser) {
  const ui = getUI();
  if (!ui?.renderTopbar) return;

  const state = buildTopbarState(remoteUser);
  ui.renderTopbar(state, refs);
}

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

async function refreshTopbarFromRemote() {
  try {
    const remoteUser = await fetchRemoteUser();
    renderTopbar(remoteUser);
  } catch (error) {
    console.error('refreshTopbarFromRemote 失敗', error);
    renderTopbar();
  }
}

function getAdConfig() {
  const config = window.APP_CONFIG || {};
  return {
    adRewardCoins: Number(config.adRewardCoins || 100),
    adRewardBonusPlay: Number(config.adRewardBonusPlay || 1),
    maxDailyAdRewards: Number(config.maxDailyAdRewards || 999)
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

function handleWatchAdClick() {
  console.log('[gacha] click watchAdBtn');

  if (!window.AdModal?.open) {
    console.warn('AdModal 尚未載入，改用直接發獎勵流程');
    rewardAdBonus();
    return;
  }

  window.AdModal.open(() => {
    console.log('[gacha] ad finished, reward bonus now');
    rewardAdBonus();
  });
}


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

      try {
        await claimGachaReward(response.result);
        await refreshTopbarFromRemote();
      } catch (error) {
        console.error('寫入 gacha 獎勵失敗', error);
        alert(`抽卡獎勵寫入失敗：${error.message}`);
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
  }

  if (storage?.getRecentDraws && ui.renderRecentDraws) {
    ui.renderRecentDraws(storage.getRecentDraws(), refs.recentDrawListEl);
  }

  renderTopbar();
  renderAdRemaining();
  await refreshTopbarFromRemote();
  bindEvents();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGachaPage);
} else {
  initGachaPage();
}
