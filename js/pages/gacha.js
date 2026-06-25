const coinCountEl = document.getElementById('coinCount');
const pointCountEl = document.getElementById('pointCount');
const ticketCountEl = document.getElementById('ticketCount');
const collectionCountEl = document.getElementById('collectionCount');

const drawBtnEl = document.getElementById('drawBtn');
const drawBtnAltEl = document.getElementById('drawBtnAlt');

const gachaResultEl = document.getElementById('gachaResult');
const recentDrawListEl = document.getElementById('recentDrawList');
const dropZoneEl = document.getElementById('dropZone');
const gachaMachineEl = document.getElementById('gachaMachine');

function getStorage() {
  return window.GachaStorage || null;
}

function getData() {
  return window.GachaData || null;
}

function getInitialState() {
  const storage = getStorage();
  const data = getData();

  const defaultCollectionTotal = Array.isArray(data?.mascots)
    ? data.mascots.length
    : 0;

  return {
    coins: storage?.getCoins ? storage.getCoins() : 10,
    points: storage?.getPoints ? storage.getPoints() : 0,
    tickets: storage?.getTickets ? storage.getTickets() : 0,
    collection: storage?.getCollection ? storage.getCollection() : [],
    recentDraws: storage?.getRecentDraws ? storage.getRecentDraws() : [],
    collectionTotal: defaultCollectionTotal
  };
}

let gachaState = getInitialState();
let isDrawing = false;

function renderTopbar() {
  if (coinCountEl) coinCountEl.textContent = gachaState.coins;
  if (pointCountEl) pointCountEl.textContent = gachaState.points;
  if (ticketCountEl) ticketCountEl.textContent = gachaState.tickets;

  if (collectionCountEl) {
    const ownedCount = Array.isArray(gachaState.collection)
      ? gachaState.collection.length
      : 0;
    collectionCountEl.textContent = `${ownedCount} / ${gachaState.collectionTotal}`;
  }
}

function renderIdleResult() {
  if (!gachaResultEl) return;

  gachaResultEl.innerHTML = `
    <div class="gacha-result-empty">
      轉動扭蛋機，看看今天的好運蛋會開出什麼吉祥物。
    </div>
  `;
}

function renderRecentDraws() {
  if (!recentDrawListEl) return;

  const list = Array.isArray(gachaState.recentDraws) ? gachaState.recentDraws : [];

  if (!list.length) {
    recentDrawListEl.innerHTML = `
      <div class="gacha-empty-inline">目前還沒有抽卡紀錄。</div>
    `;
    return;
  }

  recentDrawListEl.innerHTML = list
    .slice()
    .reverse()
    .slice(0, 5)
    .map((item) => {
      return `
        <article class="soft-card gacha-recent-item">
          <div class="gacha-recent-name">${item.name || '未知吉祥物'}</div>
          <div class="gacha-recent-meta">
            <span>${item.rarity || '-'}</span>
            <span>💎 +${item.points || 0}</span>
            <span>🎟 +${item.tickets || 0}</span>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderDropZoneIdle() {
  if (!dropZoneEl) return;

  dropZoneEl.innerHTML = `
    <div class="gacha-drop-placeholder">等待好運蛋掉出來</div>
  `;
}

function setMachineDrawing(isActive) {
  if (!gachaMachineEl) return;

  gachaMachineEl.classList.toggle('is-drawing', isActive);
}

function syncStateFromStorage() {
  const storage = getStorage();
  const data = getData();

  gachaState = {
    coins: storage?.getCoins ? storage.getCoins() : gachaState.coins,
    points: storage?.getPoints ? storage.getPoints() : gachaState.points,
    tickets: storage?.getTickets ? storage.getTickets() : gachaState.tickets,
    collection: storage?.getCollection ? storage.getCollection() : gachaState.collection,
    recentDraws: storage?.getRecentDraws ? storage.getRecentDraws() : gachaState.recentDraws,
    collectionTotal: Array.isArray(data?.mascots)
      ? data.mascots.length
      : gachaState.collectionTotal
  };
}

function saveInitialDefaultsIfNeeded() {
  const storage = getStorage();
  if (!storage) return;
if (storage.setCoins && storage.getCoins && storage.getCoins() == null) {
    storage.setCoins(10);
  }

  if (storage.setPoints && storage.getPoints && storage.getPoints() == null) {
    storage.setPoints(0);
  }

  if (storage.setTickets && storage.getTickets && storage.getTickets() == null) {
    storage.setTickets(0);
  }

  if (storage.setCollection && storage.getCollection && !Array.isArray(storage.getCollection())) {
    storage.setCollection([]);
  }

  if (storage.setRecentDraws && storage.getRecentDraws && !Array.isArray(storage.getRecentDraws())) {
    storage.setRecentDraws([]);
  }
}

function showComingSoonResult() {
  if (!gachaResultEl) return;

  gachaResultEl.innerHTML = `
    <div class="notice-box">
      扭蛋邏輯下一步會接上。<br>
      目前先完成頁面初始化、資源列與按鈕事件。
    </div>
  `;
}

function handleDrawClick() {
  if (isDrawing) return;

  if (gachaState.coins <= 0) {
    if (gachaResultEl) {
      gachaResultEl.innerHTML = `
        <div class="notice-box">
          好運幣不足，現在無法轉蛋。<br>
          之後可以再補上領幣或任務獲得機制。
        </div>
      `;
    }
    return;
  }

  isDrawing = true;
  setMachineDrawing(true);

  if (dropZoneEl) {
    dropZoneEl.innerHTML = `
      <div class="gacha-drop-placeholder">好運蛋掉落中...</div>
    `;
  }

  if (gachaResultEl) {
    gachaResultEl.innerHTML = `
      <div class="gacha-result-empty">扭蛋機轉動中，請稍候...</div>
    `;
  }

  setTimeout(() => {
    const storage = getStorage();

    if (storage?.setCoins) {
      storage.setCoins(Math.max(0, gachaState.coins - 1));
    } else {
      gachaState.coins = Math.max(0, gachaState.coins - 1);
    }

    syncStateFromStorage();
    renderTopbar();
    renderDropZoneIdle();
    showComingSoonResult();

    isDrawing = false;
    setMachineDrawing(false);
  }, 900);
}

function bindEvents() {
  if (drawBtnEl) {
    drawBtnEl.addEventListener('click', handleDrawClick);
  }

  if (drawBtnAltEl) {
    drawBtnAltEl.addEventListener('click', handleDrawClick);
  }
}

function renderPage() {
  renderTopbar();
  renderIdleResult();
  renderRecentDraws();
  renderDropZoneIdle();
}

function initGachaPage() {
  saveInitialDefaultsIfNeeded();
  syncStateFromStorage();
  bindEvents();
  renderPage();
}

document.addEventListener('DOMContentLoaded', initGachaPage);
