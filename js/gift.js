document.documentElement.classList.add('page-ready');

const API_URL = 'https://script.google.com/macros/s/AKfycbx4rw8EjTdp265gei6ke8teYbwD6ESactOT2WtX02wdQsplpDIAF3kr_JDimH_oMd4/exec';
const fallbackImage = './images/mascot.jpg';

const giftItems = [
  {
    id: 'gift-001',
    name: '招財小福袋',
    points: 300,
    tickets: 0,
    image: './images/redeem.jpg'
  },
  {
    id: 'gift-002',
    name: '好運御守',
    points: 500,
    tickets: 1,
    image: './images/mascot.jpg'
  },
  {
    id: 'gift-003',
    name: '限定吉祥物',
    points: 900,
    tickets: 2,
    image: './images/image1.jpg'
  },
  {
    id: 'gift-004',
    name: '神秘加碼禮',
    points: 1200,
    tickets: 1,
    image: './images/wish.jpg'
  }
];

const pointsEl = document.getElementById('points');
const ticketsEl = document.getElementById('tickets');
const giftGridEl = document.getElementById('giftGrid');
const historyListEl = document.getElementById('historyList');
const historyEmptyEl = document.getElementById('historyEmpty');

let remoteUser = {
  userId: '',
  nickname: '',
  points: 0,
  tickets: 0
};

function getUserProfile() {
  if (!window.UserStore?.getUserProfile) {
    return {
      userId: '',
      nickname: ''
    };
  }

  return window.UserStore.getUserProfile();
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

async function ensureRemoteUser() {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error('找不到 userId');
  }

  const result = await postApi({
    action: 'ensureUser',
    userId: profile.userId,
    nickname: profile.nickname || '',
    contact: '',
    note: 'gift_page_init'
  });

  if (!result.ok) {
    throw new Error(result.message || 'ensureUser 失敗');
  }

  return result.user;
}

async function fetchRemoteUser() {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error('找不到 userId');
  }

  const result = await postApi({
    action: 'getUser',
    userId: profile.userId
  });

  if (!result.ok) {
    throw new Error(result.message || 'getUser 失敗');
  }

  return result.user;
}

function getPoints() {
  return Number(remoteUser.points || 0);
}

function getTickets() {
  return Number(remoteUser.tickets || 0);
}

function getHistory() {
  return window.GiftStorage?.getRedeemHistory
    ? window.GiftStorage.getRedeemHistory()
    : [];
}

function saveHistory(history) {
  if (window.GiftStorage?.setRedeemHistory) {
    window.GiftStorage.setRedeemHistory(history);
  }
}

function renderWallet() {
  if (pointsEl) pointsEl.textContent = getPoints();
  if (ticketsEl) ticketsEl.textContent = getTickets();
}

function createGiftCard(item) {
  const points = getPoints();
  const tickets = getTickets();
  const canRedeem = points >= item.points && tickets >= item.tickets;

  const card = document.createElement('article');
  card.className = 'gift-item';
  card.innerHTML = `
    <div class="gift-item-image">
      <img src="${item.image}" alt="${item.name}" class="gift-item-photo" />
    </div>

    <div class="gift-item-body">
      <h3 class="gift-item-title">${item.name}</h3>

      <div class="gift-item-costs">
        <span class="gift-badge">💎 所需點數：${item.points}</span>
        <span class="gift-badge">🎟 所需兌換券：${item.tickets}</span>
      </div>

      <div class="gift-item-actions">
        <button
          class="gift-redeem-btn"
          type="button"
          data-gift-id="${item.id}"
          ${canRedeem ? '' : 'disabled'}
        >
          立即兌換
        </button>
        <span class="gift-item-status">${canRedeem ? '可兌換' : '資源不足'}</span>
      </div>
    </div>
  `;

  const img = card.querySelector('.gift-item-photo');
  img.addEventListener(
    'error',
    () => {
      img.src = fallbackImage;
    },
    { once: true }
  );

  return card;
}

  const img = card.querySelector('img');
  img.addEventListener(
    'error',
    () => {
      img.src = fallbackImage;
    },
    { once: true }
  );

  return card;
}

function renderGiftGrid() {
  if (!giftGridEl) return;

  giftGridEl.innerHTML = '';

  giftItems.forEach((item) => {
    const card = createGiftCard(item);
    giftGridEl.appendChild(card);
  });
}

function renderHistory() {
  if (!historyListEl || !historyEmptyEl) return;

  const history = getHistory();
  historyListEl.innerHTML = '';

  if (!history.length) {
    historyEmptyEl.style.display = 'block';
    return;
  }

  historyEmptyEl.style.display = 'none';

  history
    .slice()
    .reverse()
    .forEach((item) => {
      const block = document.createElement('article');
      block.className = 'history-item';
      block.innerHTML = `
        <h4 class="history-item-title">${item.name}</h4>
        <div class="history-item-meta">
          <div>消耗：💎 ${item.points} 點 / 🎟 ${item.tickets} 券</div>
          <div>時間：${item.time}</div>
        </div>
      `;
      historyListEl.appendChild(block);
    });
}

function redeemGift(giftId) {
  const item = giftItems.find((gift) => gift.id === giftId);
  if (!item) return;

  const currentPoints = getPoints();
  const currentTickets = getTickets();

  if (currentPoints < item.points || currentTickets < item.tickets) {
    alert('目前點數或兌換券不足喔。');
    return;
  }

  const confirmed = window.confirm(`確認兌換「${item.name}」？`);
  if (!confirmed) return;

  const history = getHistory();
  history.push({
    id: item.id,
    name: item.name,
    points: item.points,
    tickets: item.tickets,
    time: new Date().toLocaleString('zh-TW', { hour12: false })
  });
  saveHistory(history);

  alert(`目前已記錄兌換申請：${item.name}`);

  renderHistory();
}

function bindGiftGridEvents() {
  if (!giftGridEl) return;

  giftGridEl.addEventListener('click', (event) => {
    const button = event.target.closest('.gift-item-thumb');
    if (!button) return;

    const giftId = thumb.dataset.giftId;
    if (!giftId) return;

    redeemGift(giftId);
  });
}

async function initRemoteWallet() {
  await ensureRemoteUser();
  const user = await fetchRemoteUser();

  remoteUser = {
    userId: user.userId || '',
    nickname: user.nickname || '',
    points: Number(user.points || 0),
    tickets: Number(user.tickets || 0)
  };
}

async function initGiftPage() {
  try {
    await initRemoteWallet();
    renderWallet();
    renderGiftGrid();
    renderHistory();
    bindGiftGridEvents();
  } catch (error) {
    console.error('gift 頁初始化失敗', error);
    alert(`目前無法讀取點數資料：${error.message}`);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGiftPage);
} else {
  initGiftPage();
}
