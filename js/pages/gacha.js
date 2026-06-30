document.documentElement.classList.add('page-ready');
document.getElementById('watchAdBtn')
document.getElementById('adRemaining')


const API_URL = 'https://script.google.com/macros/s/AKfycbx4rw8EjTdp265gei6ke8teYbwD6ESactOT2WtX02wdQsplpDIAF3kr_JDimH_oMd4/exec';

const refs = {
  drawBtnEl: document.getElementById('drawBtn'),
  drawBtnAltEl: document.getElementById('drawBtnAlt'),
  dropZoneEl: document.getElementById('dropZone'),
  gachaResultEl: document.getElementById('gachaResult'),
  recentDrawListEl: document.getElementById('recentDrawList'),
  topbarPointsEl: document.getElementById('topbarPoints'),
  topbarTicketsEl: document.getElementById('topbarTickets')
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
  console.log('claimGachaReward input result =', result);

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

  console.log('claimGachaReward payload =', payload);

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

function renderTopbar(remoteUser) {
  const storage = getStorage();

  let coins = 0;
  let points = 0;
  let tickets = 0;

  if (storage?.getCoins) {
    coins = Number(storage.getCoins() || 0);
  }

  if (remoteUser) {
    points = Number(remoteUser.points || 0);
    tickets = Number(remoteUser.tickets || 0);
  } else if (storage) {
    if (storage.getPoints) {
      points = Number(storage.getPoints() || 0);
    }

    if (storage.getTickets) {
      tickets = Number(storage.getTickets() || 0);
    }
  }

  if (refs.topbarCoinsEl) {
    refs.topbarCoinsEl.textContent = coins;
  }

  if (refs.topbarPointsEl) {
    refs.topbarPointsEl.textContent = points;
  }

  if (refs.topbarTicketsEl) {
    refs.topbarTicketsEl.textContent = tickets;
  }
}


function setDrawingState(drawing) {
  const drawButtons = [refs.drawBtnEl, refs.drawBtnAltEl].filter(Boolean);
  drawButtons.forEach((button) => {
    button.disabled = drawing;
    button.textContent = drawing ? '轉動中...' : '轉一次';
  });
}

function handleDrawFailure(response) {
  const ui = getUI();

  if (ui?.renderErrorResult) {
    ui.renderErrorResult(
      refs.gachaResultEl,
      response?.message || '目前無法抽取，請稍後再試。'
    );
  } else {
    alert(response?.message || '目前無法抽取，請稍後再試。');
  }
}

function handleDrawSuccess(result) {
  console.log('handleDrawSuccess result =', result);

  const ui = getUI();
  const storage = getStorage();

  if (!ui || !result) return;

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

async function refreshTopbarFromRemote() {
  try {
    const remoteUser = await fetchRemoteUser();
    console.log('remoteUser =', remoteUser);
    renderTopbar(remoteUser);
  } catch (error) {
    console.error('refreshTopbarFromRemote 失敗', error);
  }
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
      console.log('draw response =', response);

      if (!response?.ok) {
        handleDrawFailure(response);
        return;
      }

      handleDrawSuccess(response.result);

      try {
        const rewardResponse = await claimGachaReward(response.result);
        console.log('claimGachaReward response =', rewardResponse);
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
}

async function initGachaPage() {
  const ui = getUI();
  const storage = getStorage();

  if (!ui) {
    console.warn('GachaUI 尚未載入完成');
    return;
  }

  if (ui.renderIdleDropZone) {
    ui.renderIdleDropZone(refs.dropZoneEl);
  }

  if (ui.renderEmptyResult) {
    ui.renderEmptyResult(refs.gachaResultEl);
  }

  if (storage?.getRecentDraws && ui.renderRecentDraws) {
    ui.renderRecentDraws(storage.getRecentDraws(), refs.recentDrawListEl);
  }

  renderTopbar();
  await refreshTopbarFromRemote();
  bindEvents();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGachaPage);
} else {
  initGachaPage();
}
