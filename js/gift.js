const giftGridEl = document.getElementById('giftGrid');
const pointsEl = document.getElementById('points');
const ticketsEl = document.getElementById('tickets');
const historyListEl = document.getElementById('historyList');
const historyEmptyEl = document.getElementById('historyEmpty');

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

function setHistory(history) {
  if (window.GiftStorage?.setRedeemHistory) {
    window.GiftStorage.setRedeemHistory(history);
  }
}

function renderWallet() {
  if (pointsEl) pointsEl.textContent = getPoints();
  if (ticketsEl) ticketsEl.textContent = getTickets();
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

  history.slice().reverse().forEach((item) => {
    const row = document.createElement('article');
    row.className = 'history-item';
    row.innerHTML = `
      <h4 class="history-item-title">${item.name}</h4>
      <div class="history-item-meta">
        <div>消耗：💎 ${item.points} 點 / 🎟 ${item.tickets} 券</div>
        <div>時間：${item.time}</div>
      </div>
    `;
    historyListEl.appendChild(row);
  });
}

function renderGiftGrid() {
  if (!giftGridEl) return;

  const currentPoints = getPoints();
  const currentTickets = getTickets();

  giftGridEl.innerHTML = '';
  giftItems.forEach((item) => {
    const canRedeem =true;
      //currentPoints >= item.points && currentTickets >= item.tickets;

    const card = document.createElement('article');
    card.className = 'gift-item';
    card.innerHTML = `
      <div class="gift-item-image">
        <div class="gift-item-thumb">
          <img src="${item.image}" alt="${item.name}">
        </div>
      </div>

      <div class="gift-item-body">
        <h3 class="gift-item-title">${item.name}</h3>

        <div class="gift-item-costs">
          <span class="gift-badge">💎 所需點數：${item.points}</span>
          <span class="gift-badge">🎟 所需兌換券：${item.tickets}</span>
        </div>

        <button
          class="gift-redeem-btn"
          type="button"
          ${canRedeem ? '' : 'disabled'}
          onclick="redeemGift('${item.id}')"
        >
          ${canRedeem ? '立即兌換' : '資源不足'}
        </button>
      </div>
    `;

    giftGridEl.appendChild(card);
  });
}

window.redeemGift = function (giftId) {
  const item = giftItems.find((gift) => gift.id === giftId);
  if (!item) return;

  const currentPoints = getPoints();
const currentTickets = getTickets();

  if (currentPoints < item.points || currentTickets < item.tickets) {
    alert('目前點數或兌換券不足喔。');
    return;
  }

  const confirmed = confirm(`確認兌換「${item.name}」？`);
  if (!confirmed) return;

  setPoints(currentPoints - item.points);
  setTickets(currentTickets - item.tickets);

  const history = getHistory();
  history.push({
    id: item.id,
    name: item.name,
    points: item.points,
    tickets: item.tickets,
    time: new Date().toLocaleString('zh-TW', { hour12: false })
  });
  setHistory(history);

  renderWallet();
  renderGiftGrid();
  renderHistory();

  alert(`已成功兌換：${item.name}`);
};

document.addEventListener('DOMContentLoaded', () => {
  renderWallet();
  renderGiftGrid();
  renderHistory();
});
