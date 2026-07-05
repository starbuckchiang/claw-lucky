const collectionRefs = {
  progressTextEl: document.getElementById('collectionProgressText'),
  ownedCountEl: document.getElementById('ownedCount'),
  lockedCountEl: document.getElementById('lockedCount'),
  ssrOwnedCountEl: document.getElementById('ssrOwnedCount'),
  filterRowEl: document.getElementById('collectionFilterRow'),
  gridEl: document.getElementById('collectionGrid'),
  detailEl: document.getElementById('collectionDetail')
};

let activeFilter = 'all';
let activeMascotId = null;

function getData() {
  return window.GachaData || null;
}

function getStorage() {
  return window.GachaStorage || null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getAllMascots() {
  const data = getData();
  return Array.isArray(data?.mascots) ? data.mascots : [];
}

function getOwnedIds() {
  const storage = getStorage();
  const collection = storage?.getCollection ? storage.getCollection() : [];
  return Array.isArray(collection) ? collection : [];
}

function isOwnedMascot(mascotId) {
  return getOwnedIds().includes(mascotId);
}

function getRarityMeta(rarityCode) {
  const data = getData();
  if (!data?.getRarityConfig) {
    return {
      label: rarityCode || 'N',
      color: '#8b6a43'
    };
  }
  return data.getRarityConfig(rarityCode);
}

function getSummaryState() {
  const mascots = getAllMascots();
  const ownedIds = getOwnedIds();

  const ownedCount = mascots.filter((item) => ownedIds.includes(item.id)).length;
  const totalCount = mascots.length;
  const lockedCount = Math.max(0, totalCount - ownedCount);
  const ssrOwnedCount = mascots.filter(
    (item) => item.rarity === 'SSR' && ownedIds.includes(item.id)
  ).length;

  return {
    ownedCount,
    lockedCount,
    ssrOwnedCount,
    totalCount
  };
}

function renderSummary() {
  const state = getSummaryState();

  if (collectionRefs.progressTextEl) {
    collectionRefs.progressTextEl.textContent = `${state.ownedCount} / ${state.totalCount}`;
  }

  if (collectionRefs.ownedCountEl) {
    collectionRefs.ownedCountEl.textContent = state.ownedCount;
  }

  if (collectionRefs.lockedCountEl) {
    collectionRefs.lockedCountEl.textContent = state.lockedCount;
  }

  if (collectionRefs.ssrOwnedCountEl) {
    collectionRefs.ssrOwnedCountEl.textContent = state.ssrOwnedCount;
  }
}

function matchesFilter(mascot) {
  const owned = isOwnedMascot(mascot.id);

  if (activeFilter === 'all') return true;
  if (activeFilter === 'owned') return owned;
  if (activeFilter === 'locked') return !owned;
  if (['N', 'R', 'SR', 'SSR'].includes(activeFilter)) {
    return mascot.rarity === activeFilter;
  }

  return true;
}

function buildCardImage(mascot, owned) {
  const image = owned ? mascot.image : mascot.silhouette;
  const name = owned ? mascot.name : '尚未遇見';

  if (image) {
    return `
      <img
        class="collection-card-image-el ${owned ? '' : 'is-silhouette'}"
        src="${escapeHtml(image)}"
        alt="${escapeHtml(name)}"
        loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <div class="collection-card-image placeholder" style="display:none;">
        ${escapeHtml(owned ? mascot.name : '???')}
      </div>
    `;
  }

  return `
    <div class="collection-card-image placeholder">
      ${escapeHtml(owned ? mascot.name : '???')}
    </div>
  `;
}

function buildCollectionCard(mascot) {
  const owned = isOwnedMascot(mascot.id);
  const rarityMeta = getRarityMeta(mascot.rarity);
  const cardName = owned ? mascot.name : '尚未遇見';
  const cardText = owned ? mascot.title : '等你把這份好運抽出來。';
const rarityText = mascot.rarity;

  return `
    <article
      class="collection-card ${owned ? 'is-owned' : 'is-locked'}"
      data-mascot-id="${escapeHtml(mascot.id)}"
      tabindex="0"
      role="button"
      aria-label="${escapeHtml(cardName)}"
    >
      <div class="collection-card-visual">
        ${buildCardImage(mascot, owned)}
      </div>

      <div class="collection-card-body">
        <span
          class="collection-card-rarity"
          style="background:${escapeHtml(rarityMeta?.color || '#7a3f22')};"
        >
          ${escapeHtml(rarityText)}
        </span>
        <h3 class="collection-card-name">${escapeHtml(cardName)}</h3>
        <p class="collection-card-text">${escapeHtml(cardText)}</p>
      </div>
    </article>
  `;
}

function renderGrid() {
  if (!collectionRefs.gridEl) return;

  const mascots = getAllMascots().filter(matchesFilter);

  if (!mascots.length) {
    collectionRefs.gridEl.innerHTML = `
      <div class="collection-empty">
        目前這個篩選條件下沒有可顯示的吉祥物。
      </div>
    `;
    return;
  }

  collectionRefs.gridEl.innerHTML = mascots.map(buildCollectionCard).join('');
}

function buildDetailImage(mascot, owned) {
  const image = owned ? mascot.image : mascot.silhouette;
  const altText = owned ? mascot.name : '尚未解鎖吉祥物';

  if (image) {
    return `
      <img
        class="collection-detail-image-el ${owned ? '' : 'is-silhouette'}"
        src="${escapeHtml(image)}"
        alt="${escapeHtml(altText)}"
        loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <div class="collection-detail-image placeholder" style="display:none;">
        ${escapeHtml(owned ? mascot.name : '???')}
      </div>
    `;
  }

  return `
    <div class="collection-detail-image placeholder">
      ${escapeHtml(owned ? mascot.name : '???')}
    </div>
  `;
}

function renderDetail(mascotId) {
  if (!collectionRefs.detailEl) return;

  const mascot = getAllMascots().find((item) => item.id === mascotId);

  if (!mascot) {
    collectionRefs.detailEl.innerHTML = `
      <div class="collection-detail-empty">
        請先從上方圖鑑列表選擇一位吉祥物。
      </div>
    `;
    return;
  }

  const owned = isOwnedMascot(mascot.id);
  const rarityMeta = getRarityMeta(mascot.rarity);
  const displayName = owned ? mascot.name : '尚未遇見';
  const displayTitle = owned ? mascot.title : '這位吉祥物還在等待和你相遇。';
  const displayDesc = owned
    ? mascot.description
    : '當你在好運蛋扭扭樂中抽到牠之後，這裡就會顯示完整介紹。';

  collectionRefs.detailEl.innerHTML = `
    <article class="collection-detail-card ${owned ? 'is-owned' : 'is-locked'}">
      <div class="collection-detail-visual">
        ${buildDetailImage(mascot, owned)}
      </div>

      <div class="collection-detail-content">
        <span
          class="collection-detail-rarity"
          style="background:${escapeHtml(rarityMeta?.color || '#7a3f22')};"
        >
          ${escapeHtml(mascot.rarity)}
        </span>

        <h3 class="collection-detail-name">${escapeHtml(displayName)}</h3>
        <p class="collection-detail-title">${escapeHtml(displayTitle)}</p>
        <p class="collection-detail-desc">${escapeHtml(displayDesc)}</p>

        <div class="collection-detail-meta">
          <div class="collection-detail-meta-item">
            <span>收藏狀態</span>
            <strong>${owned ? '已解鎖' : '未解鎖'}</strong>
          </div>
          <div class="collection-detail-meta-item">
            <span>獲得點數</span>
            <strong>${owned ? `+${Number(mascot.points) || 0}` : '???'}</strong>
          </div>
          <div class="collection-detail-meta-item">
            <span>獲得兌換券</span>
            <strong>${owned ? `+${Number(mascot.tickets) || 0}` : '???'}</strong>
          </div>
        </div>
      </div>
    </article>
  `;
}

function updateActiveFilterButton() {
  if (!collectionRefs.filterRowEl) return;

  const buttons = collectionRefs.filterRowEl.querySelectorAll('.collection-filter');
buttons.forEach((button) => {
    const isActive = button.dataset.filter === activeFilter;
    button.classList.toggle('is-active', isActive);
  });
}

function ensureActiveMascotAfterFilter() {
  const mascots = getAllMascots().filter(matchesFilter);

  if (!mascots.length) {
    activeMascotId = null;
    renderDetail(null);
    return;
  }

  const stillExists = mascots.some((item) => item.id === activeMascotId);

  if (!stillExists) {
    activeMascotId = mascots[0].id;
  }

  renderDetail(activeMascotId);
}

function handleFilterClick(event) {
  const button = event.target.closest('.collection-filter');
  if (!button) return;

  activeFilter = button.dataset.filter || 'all';
  updateActiveFilterButton();
  renderGrid();
  ensureActiveMascotAfterFilter();
}

function handleGridClick(event) {
  const card = event.target.closest('.collection-card');
  if (!card) return;

  activeMascotId = card.dataset.mascotId || null;
  renderDetail(activeMascotId);
}

function handleGridKeydown(event) {
  const card = event.target.closest('.collection-card');
  if (!card) return;

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    activeMascotId = card.dataset.mascotId || null;
    renderDetail(activeMascotId);
  }
}

function bindEvents() {
  if (collectionRefs.filterRowEl) {
    collectionRefs.filterRowEl.addEventListener('click', handleFilterClick);
  }

  if (collectionRefs.gridEl) {
    collectionRefs.gridEl.addEventListener('click', handleGridClick);
    collectionRefs.gridEl.addEventListener('keydown', handleGridKeydown);
  }
}

function checkDependencies() {
  const data = getData();
  const storage = getStorage();

  if (!data || !storage) {
    console.warn('收藏圖鑑頁依賴模組未完整載入', {
      hasData: Boolean(data),
      hasStorage: Boolean(storage)
    });
    return false;
  }

  return true;
}

function initCollectionPage() {
  if (!checkDependencies()) return;

  renderSummary();
  updateActiveFilterButton();
  renderGrid();
  ensureActiveMascotAfterFilter();
  bindEvents();
}

document.addEventListener('DOMContentLoaded', initCollectionPage);
