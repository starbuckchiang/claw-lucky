document.documentElement.classList.add('page-ready');
console.log('gift.js loaded');

const fallbackImage = './image/image.png';

const giftItems = [
  {
    id: 'gift-001',
    name: '招財小福袋',
    points: 300,
    tickets: 0,
    image: './image/image.png'
  },
  {
    id: 'gift-002',
    name: '好運御守',
    points: 500,
    tickets: 1,
    image: './image/image.png'
  },
  {
    id: 'gift-003',
    name: '限定吉祥物',
    points: 900,
    tickets: 2,
    image: './image/image.png'
  },
  {
    id: 'gift-004',
    name: '神秘加碼禮',
    points: 1200,
    tickets: 1,
    image: './image/image.png'
  }
];

const pointsEl = document.getElementById('points');
const ticketsEl = document.getElementById('tickets');
const giftGridEl = document.getElementById('giftGrid');
const historyListEl = document.getElementById('historyList');
const historyEmptyEl = document.getElementById('historyEmpty');

function getPoints() {
  return window.GiftStorage?.getPoints ? window.GiftStorage.getPoints() : 0;
}

function setPoints(value) {
  if (window.GiftStorage?.setPoints) {
    window.GiftStorage.setPoints(value);
  }
}

function getTickets() {
  return window.GiftStorage?.getTickets ? window.GiftStorage.getTickets() : 0;
}

function setTickets(value) {
  if (window.GiftStorage?.setTickets) {
    window.GiftStorage.setTickets(value);
  }
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
  const points = getPoints();
  const tickets = getTickets();

  if (pointsEl) pointsEl.textContent = points;
  if (ticketsEl) ticketsEl.textContent = tickets;
}

function createGiftCard(item) {
  const points = getPoints();
  const tickets = getTickets();
  const canRedeem = points >= item.points && tickets >= item.tickets;

  const card = document.createElement('article');
  card.className = 'gift-item';
  card.innerHTML = `
    <div class="gift-item-image">
      <button
        class="gift-item-thumb"
        type="button"
        data-gift-id="${item.id}"
        ${canRedeem ? '' : 'disabled'}
        aria-label="兌換 ${item.name}"
        title="${canRedeem ? `兌換 ${item.name}` : '資源不足'}"
      >
        <img src="${item.image}" alt="${item.name}" />
      </button>
    </div>

    <div class="gift-item-body">
      <h3 class="gift-item-title">${item.name}</h3>

      <div class="gift-item-costs">
        <span class="gift-badge">💎 所需點數：${item.points}</span>
        <span class="gift-badge">🎟 所需兌換券：${item.tickets}</span>
      </div>
    </div>
  `;

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

  giftGridEl.querySelectorAll('.gift-item-thumb').forEach((button) => {
    button.addEventListener('click', () => {
      alert('你有點到縮圖');
      redeemGift(button.dataset.giftId);
    });
  });


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

  const nextPoints = currentPoints - item.points;
  const nextTickets = currentTickets - item.tickets;

  setPoints(nextPoints);
  setTickets(nextTickets);

  const history = getHistory();
  history.push({
    id: item.id,
    name: item.name,
    points: item.points,
    tickets: item.tickets,
    time: new Date().toLocaleString('zh-TW', { hour12: false })
  });
  saveHistory(history);

  renderWallet();
  renderGiftGrid();
  renderHistory();

  alert(`已成功兌換：${item.name}`);
}

function initGiftPage() {
  renderWallet();
  renderGiftGrid();
  renderHistory();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGiftPage);
} else {
  initGiftPage();
}
alert('gift.js 已載入');
