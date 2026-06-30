const refs = {
  coinCountEl: document.getElementById('coinCount'),
  pointCountEl: document.getElementById('pointCount'),
  ticketCountEl: document.getElementById('ticketCount'),
  collectionCountEl: document.getElementById('collectionCount'),

  drawBtnEl: document.getElementById('drawBtn'),
  drawBtnAltEl: document.getElementById('drawBtnAlt'),

  gachaResultEl: document.getElementById('gachaResult'),
  recentDrawListEl: document.getElementById('recentDrawList'),
  dropZoneEl: document.getElementById('dropZone'),
  gachaMachineEl: document.getElementById('gachaMachine')
};

let isDrawing = false;

function getStorage() {
  return window.GachaStorage || null;
}

function getData() {
  return window.GachaData || null;
}

function getEngine() {
  return window.GachaEngine || null;
}

function getUI() {
  return window.GachaUI || null;
}

function getCollectionTotal() {
  const data = getData();
  return Array.isArray(data?.mascots) ? data.mascots.length : 0;
}

function getPageState() {
  const storage = getStorage();

  return {
    coins: storage?.getCoins ? storage.getCoins() ?? 0 : 0,
    points: storage?.getPoints ? storage.getPoints() ?? 0 : 0,
    tickets: storage?.getTickets ? storage.getTickets() ?? 0 : 0,
    collection: storage?.getCollection ? storage.getCollection() : [],
    recentDraws: storage?.getRecentDraws ? storage.getRecentDraws() : [],
    collectionTotal: getCollectionTotal()
  };
}

function ensureDefaults() {
  const storage = getStorage();
  const data = getData();

  if (!storage?.ensureDefaults) return;

  storage.ensureDefaults({
    coins: data?.defaults?.coins ?? 10,
    points: data?.defaults?.points ?? 0,
    tickets: data?.defaults?.tickets ?? 0,
    collection: data?.defaults?.collection ?? [],
    recentDraws: data?.defaults?.recentDraws ?? []
  });
}

function renderTopbar() {
  const ui = getUI();
  if (!ui?.renderTopbar) return;

  ui.renderTopbar(getPageState(), refs);
}

function renderIdleState() {
  const ui = getUI();
  if (!ui) return;

  ui.renderIdleResult(refs.gachaResultEl);
  ui.renderDropZoneIdle(refs.dropZoneEl);
}

function renderRecentDraws() {
  const ui = getUI();
  const storage = getStorage();
  if (!ui?.renderRecentDraws || !storage?.getRecentDraws) return;

  ui.renderRecentDraws(storage.getRecentDraws(), refs.recentDrawListEl);
}

function renderAll() {
  renderTopbar();
  renderIdleState();
  renderRecentDraws();
}

function setDrawingState(active) {
  const ui = getUI();
  if (!ui) return;

  ui.setMachineDrawing(refs.gachaMachineEl, active);
  ui.setDrawButtonsDisabled(refs, active);
}

function handleDrawFailure(response) {
  const ui = getUI();
  if (!ui) return;

  renderTopbar();
  renderRecentDraws();
  ui.renderDropZoneIdle(refs.dropZoneEl);
  ui.renderMessageResult(
    refs.gachaResultEl,
    response?.message || '目前無法轉蛋，請稍後再試。',
    'warning'
  );
}

function handleDrawSuccess(result) {
  console.log('handleDrawSuccess result =', result);
  const ui = getUI();
  const storage = getStorage();
  if (!ui || !result) return;

  renderTopbar();

  ui.renderDropZoneCapsule(refs.dropZoneEl, result.rarity);
  ui.renderDrawResult(refs.gachaResultEl, result);

  if (storage?.getRecentDraws) {
    ui.renderRecentDraws(storage.getRecentDraws(), refs.recentDrawListEl);
  }
}

function handleDrawClick() {
  const ui = getUI();
  const engine = getEngine();

  if (isDrawing) return;

  if (!ui || !engine?.drawOnce) {
    console.warn('GachaUI 或 GachaEngine 尚未載入完成');
    return;
  }

  isDrawing = true;
  setDrawingState(true);

  ui.renderDropZoneLoading(refs.dropZoneEl);
  ui.renderLoadingResult(refs.gachaResultEl);window.setTimeout(() => {
    const response = engine.drawOnce();
    console.log('draw response =', response);


    if (!response?.ok) {
      handleDrawFailure(response);
      isDrawing = false;
      setDrawingState(false);
      return;
    }

    handleDrawSuccess(response.result);

    window.setTimeout(() => {
      isDrawing = false;
      setDrawingState(false);
    }, 250);
  }, 900);
}

function bindEvents() {
  if (refs.drawBtnEl) {
    refs.drawBtnEl.addEventListener('click', handleDrawClick);
  }

  if (refs.drawBtnAltEl) {
    refs.drawBtnAltEl.addEventListener('click', handleDrawClick);
  }
}

function checkDependencies() {
  const storage = getStorage();
  const data = getData();
  const engine = getEngine();
  const ui = getUI();

  if (!storage || !data || !engine || !ui) {
    console.warn('Gacha 頁面依賴模組未完整載入', {
      hasStorage: Boolean(storage),
      hasData: Boolean(data),
      hasEngine: Boolean(engine),
      hasUI: Boolean(ui)
    });
    return false;
  }

  return true;
}

function initGachaPage() {
  if (!checkDependencies()) return;

  ensureDefaults();
  bindEvents();
  renderAll();
}

document.addEventListener('DOMContentLoaded', initGachaPage);

