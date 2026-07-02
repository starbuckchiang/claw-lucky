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
