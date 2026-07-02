document.documentElement.classList.add('page-ready');

const SUPABASE_URL = 'https://umtqpstacjdwxcvcirbl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PtWhyYhKGUVxph4o80oGbg_aeZVnUyk';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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

function getUI() {
  return window.GachaUI || null;
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

async function fetchSupabaseUser() {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error('找不到 userId');
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

function renderTopbar(remoteUser) {
  const ui = getUI();
  if (!ui?.renderTopbar) return;

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

  const state = {
    coins,
    points,
    tickets,
    collection,
    collectionTotal
  };

  console.log('[renderTopbar state]', state);

  ui.renderTopbar(state, refs);
}

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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGachaPage);
} else {
  initGachaPage();
}
