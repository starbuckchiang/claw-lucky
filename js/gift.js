(function () {
  const pointsEl = document.getElementById('points');
  const ticketsEl = document.getElementById('tickets');
  const giftGridEl = document.getElementById('giftGrid');
  const historyListEl = document.getElementById('historyList');
  const historyEmptyEl = document.getElementById('historyEmpty');

  const FALLBACK_IMAGE = './image/image.png';

  const giftProducts = [
    {
      id: 'gift-001',
      name: '招福小御守',
      desc: '把今天的小小幸運收進口袋裡，陪你一起過日常。',
      image: './image/image.png',
      costPoints: 120,
      costTickets: 0,
      stock: null
    },
    {
      id: 'gift-002',
      name: '暖心小零食包',
      desc: '嘴饞的時候來一份，補點心情也補點元氣。',
      image: './image/image.png',
      costPoints: 180,
      costTickets: 1,
      stock: null
    },
    {
      id: 'gift-003',
      name: '限定好運小禮',
      desc: '適合留給今天特別努力的自己，帶點儀式感回家。',
      image: './image/image.png',
      costPoints: 260,
      costTickets: 2,
      stock: 5
    }
  ];

  function getGachaStorage() {
    return window.GachaStorage || null;
  }

  function getGiftStorage() {
    return window.GiftStorage || null;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '剛剛';

    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function ensureStorageDefaults() {
    const gachaStorage = getGachaStorage();
    const giftStorage = getGiftStorage();

    if (gachaStorage?.ensureDefaults) {
      gachaStorage.ensureDefaults({
        coins: 10,
        points: 0,
        tickets: 0,
        collection: [],
        recentDraws: []
      });
    }

    if (giftStorage?.getRedeemHistory && giftStorage?.setRedeemHistory) {
      const history = giftStorage.getRedeemHistory();
      if (!Array.isArray(history)) {
        giftStorage.setRedeemHistory([]);
      }
    }
  }

  function getPoints() {
    const gachaStorage = getGachaStorage();
    return gachaStorage?.getPoints ? Number(gachaStorage.getPoints()) || 0 : 0;
  }

  function getTickets() {
    const gachaStorage = getGachaStorage();
    return gachaStorage?.getTickets ? Number(gachaStorage.getTickets()) || 0 : 0;
  }

  function setPoints(value) {
    const gachaStorage = getGachaStorage();
    if (gachaStorage?.setPoints) {
      gachaStorage.setPoints(Math.max(0, Number(value) || 0));
    }
  }

  function setTickets(value) {
    const gachaStorage = getGachaStorage();
    if (gachaStorage?.setTickets) {
      gachaStorage.setTickets(Math.max(0, Number(value) || 0));
    }
  }

  function getHistory() {
    const giftStorage = getGiftStorage();
    const history = giftStorage?.getRedeemHistory ? giftStorage.getRedeemHistory() : [];
    return Array.isArray(history) ? history : [];
  }

  function setHistory(list) {
    const giftStorage = getGiftStorage();
    if (giftStorage?.setRedeemHistory) {
      giftStorage.setRedeemHistory(Array.isArray(list) ? list : []);
    }
  }

  function appendHistory(entry) {
    const current = getHistory();
    const next = [
      {
        id: entry.id,
        name: entry.name,
        costPoints: Number(entry.costPoints) || 0,
        costTickets: Number(entry.costTickets) || 0,
        createdAt: entry.createdAt || Date.now()
      },
      ...current
    ].slice(0, 30);

    setHistory(next);
  }

  function hasEnoughResource(product) {
    return getPoints() >= (product.costPoints || 0) &&
      getTickets() >= (product.costTickets || 0);
  }

  function getStockStatus(product) {
    if (product.stock == null) {
      return {
        soldOut: false,
        label: '可兌換'
      };
    }

    const histor
y = getHistory();
    const usedCount = history.filter((item) => item.id === product.id).length;
    const remain = Math.max(0, product.stock - usedCount);

    return {
      soldOut: remain <= 0,
      remain,
      label: remain <= 0 ? '已兌完' : `剩餘 ${remain} 份`
    };
  }

  function renderWallet() {
    if (pointsEl) {
      pointsEl.textContent = getPoints();
    }

    if (ticketsEl) {
      ticketsEl.textContent = getTickets();
    }
  }

  function buildCostHtml(product) {
    const costs = [];

    if (product.costPoints > 0) {
      costs.push(`<span class="gift-cost">💎 ${product.costPoints} 點</span>`);
    }

    if (product.costTickets > 0) {
      costs.push(`<span class="gift-cost">🎟 ${product.costTickets} 張</span>`);
    }

    return costs.join('');
  }

  function buildGiftCard(product) {
    const stockStatus = getStockStatus(product);
    const canRedeem = hasEnoughResource(product) && !stockStatus.soldOut;

    return `
      <article class="gift-card">
        <div class="gift-card-inner">
          <div class="gift-thumb">
            <img
              src="${escapeHtml(product.image || FALLBACK_IMAGE)}"
              alt="${escapeHtml(product.name)}"
              loading="lazy"
              onerror="this.src='${FALLBACK_IMAGE}'"
            />
          </div>

          <div class="gift-info">
            <h3 class="gift-name">${escapeHtml(product.name)}</h3>
            <p class="gift-desc">${escapeHtml(product.desc)}</p>

            <div class="gift-costs">
              ${buildCostHtml(product)}
            </div>

            <div class="gift-actions">
              <button
                class="gift-redeem-btn"
                type="button"
                data-gift-id="${escapeHtml(product.id)}"
                ${canRedeem ? '' : 'disabled'}
              >
                ${stockStatus.soldOut ? '已兌完' : '立即兌換'}
              </button>

              <span class="gift-status">
                ${stockStatus.soldOut ? '商品已兌完' : canRedeem ? stockStatus.label : '資源不足'}
              </span>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderGiftGrid() {
    if (!giftGridEl) return;
    giftGridEl.innerHTML = giftProducts.map(buildGiftCard).join('');
  }

  function buildHistoryItem(item) {
    const costParts = [];

    if (item.costPoints > 0) {
      costParts.push(`💎 ${item.costPoints} 點`);
    }

    if (item.costTickets > 0) {
      costParts.push(`🎟 ${item.costTickets} 張`);
    }

    return `
      <article class="history-item">
        <div class="history-name">${escapeHtml(item.name)}</div>
        <div class="history-meta">
          兌換花費：${escapeHtml(costParts.join(' ＋ '))}<br>
          兌換時間：${escapeHtml(formatTime(item.createdAt))}
        </div>
      </article>
    `;
  }

  function renderHistory() {
    const history = getHistory();

    if (historyListEl) {
      historyListEl.innerHTML = history.map(buildHistoryItem).join('');
    }

    if (historyEmptyEl) {
      historyEmptyEl.style.display = history.length ? 'none' : 'block';
    }
  }

  function redeemGift(productId) {
    const product = giftProducts.find((item) => item.id === productId);
    if (!product) return;

    const stockStatus = getStockStatus(product);
    if (stockStatus.soldOut) {
      alert('這個商品已經兌完囉。');
      return;
    }

    if (!hasEnoughResource(product)) {
      alert('你的點數或兌換券不足，現在還不能兌換這個商品。');
      return;
    }

    const ok = window.confirm(
      `確定要兌換「${product.name}」嗎？\n\n` +
      `需要點數：${product.costPoints}\n` +
      `需要兌換券：${product.costTickets}`
    );

    if (!ok) return;

    setPoints(getPoints() - (product.costPoints || 0));
    setTickets(getTickets() - (product.costTickets || 0));
    appendHistory({
      id: product.id,
      name: product.name,
      costPoints: product.costPoints,
      costTickets: product.costTickets,
      createdAt: Date.now()
    });

    renderWallet();
    renderGiftGrid();
    renderHistory();
alert(`你已成功兌換「${product.name}」✨`);
  }

  function bindEvents() {
    if (!giftGridEl) return;

    giftGridEl.addEventListener('click', (event) => {
      const button = event.target.closest('.gift-redeem-btn');
      if (!button) return;

      const productId = button.dataset.giftId;
      if (!productId) return;

      redeemGift(productId);
    });
  }

  function checkDependencies() {
    const gachaStorage = getGachaStorage();
    const giftStorage = getGiftStorage();

    if (!gachaStorage) {
      console.warn('gift.js 缺少 GachaStorage');
      return false;
    }

    if (!giftStorage) {
      console.warn('gift.js 缺少 GiftStorage');
      return false;
    }

    return true;
  }

  function initGiftPage() {
    if (!checkDependencies()) return;

    ensureStorageDefaults();
    renderWallet();
    renderGiftGrid();
    renderHistory();
    bindEvents();
  }

  document.addEventListener('DOMContentLoaded', initGiftPage);
})();
