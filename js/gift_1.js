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

  function getStorage() {
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
    const storage = getStorage();
    if (!storage) return;

    if (storage.getPoints?.() == null && storage.setPoints) {
      storage.setPoints(0);
    }

    if (storage.getTickets?.() == null && storage.setTickets) {
      storage.setTickets(0);
    }

    if (!Array.isArray(storage.getRedeemHistory?.()) && storage.setRedeemHistory) {
      storage.setRedeemHistory([]);
    }
  }

  function getPoints() {
    const storage = getStorage();
    return storage?.getPoints ? Number(storage.getPoints()) || 0 : 0;
  }

  function getTickets() {
    const storage = getStorage();
    return storage?.getTickets ? Number(storage.getTickets()) || 0 : 0;
  }

  function getHistory() {
    const storage = getStorage();
    const history = storage?.getRedeemHistory ? storage.getRedeemHistory() : [];
    return Array.isArray(history) ? history : [];
  }

  function setPoints(value) {
    const storage = getStorage();
    if (storage?.setPoints) {
      storage.setPoints(Math.max(0, Number(value) || 0));
    }
  }

  function setTickets(value) {
    const storage = getStorage();
    if (storage?.setTickets) {
      storage.setTickets(Math.max(0, Number(value) || 0));
    }
  }

  function setHistory(list) {
    const storage = getStorage();
    if (storage?.setRedeemHistory) {
      storage.setRedeemHistory(Array.isArray(list) ? list : []);
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

    const history = getHistory();
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

  function initGiftPage() {
    ensureStorageDefaults();
    renderWallet();
    renderGiftGrid();
    renderHistory();
    bindEvents();
  }

  document.addEventListener('DOMContentLoaded', initGiftPage);
})();


/*已有功能
• 顯示目前點數 / 兌換券
• render 商品卡
• 顯示 立即兌換 / 已兌完 / 資源不足
• 按下按鈕後 confirm
• 成功兌換後扣資源
• 寫入兌換紀錄
• render 歷史紀錄
• 限量商品會依兌換次數遞減
*/
