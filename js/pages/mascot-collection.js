const collectionRefs = {
  progressTextEl: document.getElementById("collectionProgressText"),
  ownedCountEl: document.getElementById("ownedCount"),
  lockedCountEl: document.getElementById("lockedCount"),
  ssrOwnedCountEl: document.getElementById("ssrOwnedCount"),
  filterRowEl: document.getElementById("collectionFilterRow"),
  gridEl: document.getElementById("collectionGrid"),
  detailEl: document.getElementById("collectionDetail")
};

let activeFilter = "all";
let activeMascotId = null;

let allMascots = [];
let ownedMascotRows = [];
let ownedMascotMap = new Map();

/* ============================================================
   Helpers
   ============================================================ */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "";

  try {
    return new Date(value).toLocaleString("zh-TW");
  } catch {
    return "";
  }
}

function getApi() {
  if (!window.Api) {
    throw new Error("Api 尚未初始化");
  }

  return window.Api;
}

function getUserProfile() {
  return window.UserStore?.getUserProfile
    ? window.UserStore.getUserProfile()
    : { userId: "", nickname: "" };
}

/* ============================================================
   Data Loading
   ============================================================ */

async function loadCollectionData() {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error("找不到 userId");
  }

  const api = getApi();

  if (!api.getMascots) {
    throw new Error("Api.getMascots 尚未建立");
  }

  if (!api.getUserMascots) {
    throw new Error("Api.getUserMascots 尚未建立");
  }

  console.log(
    "[collection] profile.userId =",
    profile.userId
  );

  const authUser = await window.userReadyPromise;

  console.log(
    "[collection] auth.user_id =",
    authUser.user_id
  );

  console.log(
    "[collection] same =",
    profile.userId === authUser.user_id
  );

  const [mascots, ownedRows] = await Promise.all([
    api.getMascots(),
    api.getUserMascots(profile.userId)
  ]);

  const data = ownedRows;
  const error = null;

  console.log("[collection] user_mascots data =", data);
  console.log("[collection] user_mascots error =", error);
  console.log("[collection] user_mascots length =", data?.length);

  if (data?.length) {
    console.log("[collection] first row =", data?.[0]);
  }

  allMascots = Array.isArray(mascots) ? mascots : [];
  ownedMascotRows = Array.isArray(ownedRows) ? ownedRows : [];

  ownedMascotMap = new Map(
    ownedMascotRows.map((item) => [String(item.mascot_id ?? ""), item])
  );
}

/* ============================================================
   Data Accessors
   ============================================================ */

function getAllMascots() {
  return allMascots;
}

function getOwnedRows() {
  return ownedMascotRows;
}

function getOwnedIds() {
  return Array.from(ownedMascotMap.keys());
}

function getOwnedMascotRow(mascotId) {
  return ownedMascotMap.get(String(mascotId ?? "")) || null;
}

function isOwnedMascot(mascotId) {
  return ownedMascotMap.has(String(mascotId ?? ""));
}

function getRarityMeta(rarityCode) {
  const fallback = {
    label: rarityCode || "N",
    color: "#8b6a43"
  };

  if (window.GachaData?.getRarityConfig) {
    return window.GachaData.getRarityConfig(rarityCode);
  }

  const colors = {
    N: "#8b6a43",
    R: "#4f7a8c",
    SR: "#7a4f8c",
    SSR: "#b9872f"
  };

  const labels = {
    N: "普通",
    R: "稀有",
    SR: "超稀有",
    SSR: "傳說"
  };

  return {
    label: labels[rarityCode] || fallback.label,
    color: colors[rarityCode] || fallback.color
  };
}

/* ============================================================
   Summary
   ============================================================ */

function getSummaryState() {
  const mascots = getAllMascots();
  const rows = getOwnedRows();

  console.log("[collection] stats input rows =", rows);

  const stats = {
    ownedTypes: rows.length,
    totalObtained: rows.reduce(
      (sum, row) => sum + Number(row.obtain_count || 0),
      0
    ),
    SSR: rows.filter((row) => row.rarity === "SSR").length,
    SR: rows.filter((row) => row.rarity === "SR").length,
    R: rows.filter((row) => row.rarity === "R").length,
    N: rows.filter((row) => row.rarity === "N").length
  };

  console.log("[collection] stats =", stats);

  const ownedCount = Number(stats.ownedTypes || 0);

  const totalCount = mascots.length;
  const lockedCount = Math.max(0, totalCount - ownedCount);

  const ssrOwnedCount = Number(stats.SSR || 0);

  return {
    ownedCount,
    lockedCount,
    ssrOwnedCount,
    totalCount
  };
}

function renderSummary() {
  const state = getSummaryState();

  const progressEl = collectionRefs.progressTextEl || document.getElementById("collectionProgressText") || document.querySelector("#collectionProgressText");
  console.log("[collection] stat element =", progressEl);
  if (progressEl) {
    progressEl.textContent =
      `${state.ownedCount} / ${state.totalCount}`;
  }

  const ownedEl = collectionRefs.ownedCountEl || document.getElementById("ownedCount") || document.querySelector("#ownedCount");
  console.log("[collection] stat element =", ownedEl);
  if (ownedEl) {
    ownedEl.textContent = state.ownedCount;
  }

  const lockedEl = collectionRefs.lockedCountEl || document.getElementById("lockedCount") || document.querySelector("#lockedCount");
  console.log("[collection] stat element =", lockedEl);
  if (lockedEl) {
    lockedEl.textContent = state.lockedCount;
  }

  const ssrEl = collectionRefs.ssrOwnedCountEl || document.getElementById("ssrOwnedCount") || document.querySelector("#ssrOwnedCount");
  console.log("[collection] stat element =", ssrEl);
  if (ssrEl) {
    ssrEl.textContent = state.ssrOwnedCount;
  }
}

/* ============================================================
   Filter
   ============================================================ */

function matchesFilter(mascot) {
  const owned = isOwnedMascot(mascot.id);

  if (activeFilter === "all") return true;
  if (activeFilter === "owned") return owned;
  if (activeFilter === "locked") return !owned;

  if (["N", "R", "SR", "SSR"].includes(activeFilter)) {
    return mascot.rarity === activeFilter;
  }

  return true;
}

/* ============================================================
   Card Rendering
   ============================================================ */

function buildCardImage(mascot, owned) {
  const image = owned ? mascot.image : mascot.silhouette;
  const name = owned ? mascot.name : "尚未遇見";

  if (image) {
    return `
      <img
        class="collection-card-image-el ${owned ? "" : "is-silhouette"}"
        src="${escapeHtml(image)}"
        alt="${escapeHtml(name)}"
        loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <div class="collection-card-image placeholder" style="display:none;">
        ${escapeHtml(owned ? mascot.name : "???")}
      </div>
    `;
  }

  return `
    <div class="collection-card-image placeholder">
      ${escapeHtml(owned ? mascot.name : "???")}
    </div>
  `;
}

function buildCollectionCard(mascot) {
  const owned = isOwnedMascot(mascot.id);
  const rarityMeta = getRarityMeta(mascot.rarity);

  const ownedRow = getOwnedMascotRow(mascot.id);
  const obtainCount = Number(ownedRow?.obtain_count || 0);

  const cardName = owned ? mascot.name : "尚未遇見";
  const cardText = owned ? mascot.title : "等你把這份好運抽出來。";

  return `
    <article
      class="collection-card ${owned ? "is-owned" : "is-locked"}"
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
          style="background:${escapeHtml(rarityMeta?.color || "#7a3f22")};"
        >
          ${escapeHtml(mascot.rarity)}
        </span>

        <h3 class="collection-card-name">${escapeHtml(cardName)}</h3>

        <p class="collection-card-text">
          ${
            owned && obtainCount > 1
              ? `${escapeHtml(cardText)}｜已遇見 ${obtainCount} 次`
              : escapeHtml(cardText)
          }
        </p>
      </div>
    </article>
  `;
}

function renderGrid() {
  if (!collectionRefs.gridEl) return;

  const rows = getOwnedRows();
  const gallery = getAllMascots().filter(matchesFilter);

  console.log("[gallery] rows =", rows);
  console.log("[gallery] gallery =", gallery);
  console.log("[gallery] gallery length =", gallery.length);
  console.log("[gallery] first gallery =", gallery[0]);

  if (!gallery.length) {
    console.log("[gallery] activeFilter =", activeFilter);
    console.log("[gallery] allMascots length =", getAllMascots().length);
  }

  if (!gallery.length) {
    collectionRefs.gridEl.innerHTML = `
      <div class="collection-empty">
        目前這個篩選條件下沒有可顯示的吉祥物。
      </div>
    `;
    return;
  }

  collectionRefs.gridEl.innerHTML =
    gallery.map(buildCollectionCard).join("");
}

/* ============================================================
   Detail Rendering
   ============================================================ */

function buildDetailImage(mascot, owned) {
  const image = owned ? mascot.image : mascot.silhouette;
  const altText = owned ? mascot.name : "尚未解鎖吉祥物";

  if (image) {
    return `
      <img
        class="collection-detail-image-el ${owned ? "" : "is-silhouette"}"
        src="${escapeHtml(image)}"
        alt="${escapeHtml(altText)}"
        loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <div class="collection-detail-image placeholder" style="display:none;">
        ${escapeHtml(owned ? mascot.name : "???")}
      </div>
    `;
  }

  return `
    <div class="collection-detail-image placeholder">
      ${escapeHtml(owned ? mascot.name : "???")}
    </div>
  `;
}

function renderDetail(mascotId) {
  if (!collectionRefs.detailEl) return;

  const rows = getOwnedRows();
  rows.forEach((row) => {
    const mascotByRow = getAllMascots().find(
      (item) => String(item.id ?? "") === String(row?.mascot_id ?? "")
    );
    console.log(row?.mascot_id);
    console.log(mascotByRow?.id);
  });

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
  const ownedRow = getOwnedMascotRow(mascot.id);
  const rarityMeta = getRarityMeta(mascot.rarity);

  const displayName = owned ? mascot.name : "尚未遇見";
  const displayTitle = owned
    ? mascot.title
    : "這位吉祥物還在等待和你相遇。";

  const displayDesc = owned
    ? mascot.description
    : "當你在好運蛋扭扭樂中抽到牠之後，這裡就會顯示完整介紹。";

  const firstObtained = formatDate(ownedRow?.first_obtained_at);
  const lastObtained = formatDate(ownedRow?.last_obtained_at);
  const obtainCount = Number(ownedRow?.obtain_count || 0);

  collectionRefs.detailEl.innerHTML = `
    <article class="collection-detail-card ${owned ? "is-owned" : "is-locked"}">
      <div class="collection-detail-visual">
        ${buildDetailImage(mascot, owned)}
      </div>

      <div class="collection-detail-content">
        <span
          class="collection-detail-rarity"
          style="background:${escapeHtml(rarityMeta?.color || "#7a3f22")};"
        >
          ${escapeHtml(mascot.rarity)}
        </span>

        <h3 class="collection-detail-name">${escapeHtml(displayName)}</h3>
        <p class="collection-detail-title">${escapeHtml(displayTitle)}</p>
        <p class="collection-detail-desc">${escapeHtml(displayDesc)}</p>

        <div class="collection-detail-meta">
          <div class="collection-detail-meta-item">
            <span>收藏狀態</span>
            <strong>${owned ? "已解鎖" : "未解鎖"}</strong>
          </div>

          <div class="collection-detail-meta-item">
            <span>獲得點數</span>
            <strong>${owned ? `+${Number(mascot.points) || 0}` : "???"}</strong>
          </div>

          <div class="collection-detail-meta-item">
            <span>獲得兌換券</span>
            <strong>${owned ? `+${Number(mascot.tickets) || 0}` : "???"}</strong>
          </div>

          <div class="collection-detail-meta-item">
            <span>取得次數</span>
            <strong>${owned ? `${obtainCount} 次` : "???"}</strong>
          </div>

          <div class="collection-detail-meta-item">
            <span>首次取得</span>
            <strong>${owned && firstObtained ? firstObtained : "???"}</strong>
          </div>

          <div class="collection-detail-meta-item">
            <span>最近取得</span>
            <strong>${owned && lastObtained ? lastObtained : "???"}</strong>
          </div>
        </div>
      </div>
    </article>
  `;
}

/* ============================================================
   Filter / Active State
   ============================================================ */

function updateActiveFilterButton() {
  if (!collectionRefs.filterRowEl) return;

  const buttons =
    collectionRefs.filterRowEl.querySelectorAll(".collection-filter");

  buttons.forEach((button) => {
    const isActive = button.dataset.filter === activeFilter;
    button.classList.toggle("is-active", isActive);
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

/* ============================================================
   Events
   ============================================================ */

function handleFilterClick(event) {
  const button = event.target.closest(".collection-filter");
  if (!button) return;

  activeFilter = button.dataset.filter || "all";

  updateActiveFilterButton();
  renderGrid();
  ensureActiveMascotAfterFilter();
}

function handleGridClick(event) {
  const card = event.target.closest(".collection-card");
  if (!card) return;

  activeMascotId = card.dataset.mascotId || null;
  renderDetail(activeMascotId);
}

function handleGridKeydown(event) {
  const card = event.target.closest(".collection-card");
  if (!card) return;

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activeMascotId = card.dataset.mascotId || null;
    renderDetail(activeMascotId);
  }
}

function bindEvents() {
  if (collectionRefs.filterRowEl) {
    collectionRefs.filterRowEl.addEventListener("click", handleFilterClick);
  }

  if (collectionRefs.gridEl) {
    collectionRefs.gridEl.addEventListener("click", handleGridClick);
    collectionRefs.gridEl.addEventListener("keydown", handleGridKeydown);
  }
}

/* ============================================================
   Init
   ============================================================ */

function checkDependencies() {
  if (!window.Api || !window.UserStore) {
    console.warn("收藏圖鑑頁依賴模組未完整載入", {
      hasApi: Boolean(window.Api),
      hasUserStore: Boolean(window.UserStore)
    });
    return false;
  }

  return true;
}

async function initCollectionPage() {
  if (!checkDependencies()) return;

  try {
    await window.UserStore.initUser();

    await loadCollectionData();

    renderSummary();
    updateActiveFilterButton();
    renderGrid();
    ensureActiveMascotAfterFilter();
    bindEvents();
  } catch (error) {
    console.error("[collection] init failed =", error);

    if (collectionRefs.gridEl) {
      collectionRefs.gridEl.innerHTML = `
        <div class="collection-empty">
          收藏資料讀取失敗：${escapeHtml(error.message)}
        </div>
      `;
    }
  }
}

document.addEventListener("DOMContentLoaded", initCollectionPage);
