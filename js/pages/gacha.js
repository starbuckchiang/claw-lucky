document.documentElement.classList.add('page-ready');

const SUPABASE_URL = 'https://umtqpstacjdwxcvcirbl.supabase.co';
const SUPABASE_KEY = 'YOUR_SUPABASE_PUBLISHABLE_KEY';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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

async function fetchSupabaseUser() {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error('找不到 userId');
  }

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', profile.userId)
    .single();

  if (error) {
    throw new Error(error.message || '讀取 Supabase users 失敗');
  }

  return data;
}
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

  if (data?.mascots?.length) {
    collectionTotal = data.mascots.length;
  }

  return {
    coins,
    points,
    tickets,
    collectionCount: collection.length,
    collectionTotal
  };
}

function renderTopbar(remoteUser) {
  const state = buildTopbarState(remoteUser);

  if (refs.coinCountEl) {
    refs.coinCountEl.textContent = state.coins;
  }

  if (refs.pointCountEl) {
    refs.pointCountEl.textContent = state.points;
  }

  if (refs.ticketCountEl) {
    refs.ticketCountEl.textContent = state.tickets;
  }

  if (refs.collectionCountEl) {
    refs.collectionCountEl.textContent = `${state.collectionCount}/${state.collectionTotal}`;
  }

  console.log('[renderTopbar]', state);
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

