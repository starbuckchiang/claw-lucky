(function () {
  const STORAGE_KEYS = {
    coins: 'gachaCoins',
    points: 'gachaPoints',
    tickets: 'gachaTickets',
    collection: 'gachaCollection',
    recentDraws: 'gachaRecentDraws'
  };

  function readNumber(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;

    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function writeNumber(key, value) {
    const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    localStorage.setItem(key, String(safeValue));
  }

  function readJson(key, fallback) {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getCoins() {
    return readNumber(STORAGE_KEYS.coins);
  }

  function setCoins(value) {
    writeNumber(STORAGE_KEYS.coins, Math.max(0, Number(value) || 0));
  }

  function getPoints() {
    return readNumber(STORAGE_KEYS.points);
  }

  function setPoints(value) {
    writeNumber(STORAGE_KEYS.points, Math.max(0, Number(value) || 0));
  }

  function getTickets() {
    return readNumber(STORAGE_KEYS.tickets);
  }

  function setTickets(value) {
    writeNumber(STORAGE_KEYS.tickets, Math.max(0, Number(value) || 0));
  }

  function getCollection() {
    const value = readJson(STORAGE_KEYS.collection, []);
    return Array.isArray(value) ? value : [];
  }

  function setCollection(list) {
    writeJson(STORAGE_KEYS.collection, Array.isArray(list) ? list : []);
  }

  function getRecentDraws() {
    const value = readJson(STORAGE_KEYS.recentDraws, []);
    return Array.isArray(value) ? value : [];
  }

  function setRecentDraws(list) {
    writeJson(STORAGE_KEYS.recentDraws, Array.isArray(list) ? list : []);
  }

  function addPoints(amount) {
    const current = getPoints() ?? 0;
    const next = Math.max(0, current + (Number(amount) || 0));
    setPoints(next);
    return next;
  }

  function addTickets(amount) {
    const current = getTickets() ?? 0;
    const next = Math.max(0, current + (Number(amount) || 0));
    setTickets(next);
    return next;
  }

  function addToCollection(mascotId) {
    if (!mascotId) return getCollection();

    const current = getCollection();
    if (!current.includes(mascotId)) {
      current.push(mascotId);
      setCollection(current);
    }
    return current;
  }

  function hasInCollection(mascotId) {
    return getCollection().includes(mascotId);
  }

  function addRecentDraw(drawItem) {
    if (!drawItem || typeof drawItem !== 'object') {
      return getRecentDraws();
    }

    const current = getRecentDraws();
    const next = [
      ...current,
      {
        id: drawItem.id || '',
        name: drawItem.name || '未知吉祥物',
        rarity: drawItem.rarity || 'N',
        points: Number(drawItem.points) || 0,
        tickets: Number(drawItem.tickets) || 0,
        isNew: Boolean(drawItem.isNew),
        createdAt: drawItem.createdAt || Date.now()
      }
    ].slice(-20);

    setRecentDraws(next);
    return next;
  }

  function clearRecentDraws() {
    setRecentDraws([]);
  }

  function resetAll() {
    localStorage.removeItem(STORAGE_KEYS.coins);
    localStorage.removeItem(STORAGE_KEYS.points);
    localStorage.removeItem(STORAGE_KEYS.tickets);
    localStorage.removeItem(STORAGE_KEYS.collection);
    localStorage.removeItem(STORAGE_KEYS.recentDraws);
  }

  function ensureDefaults(defaults = {}) {
    if (getCoins() === null) {
      setCoins(defaults.coins ?? 10);
    }

    if (getPoints() === null) {
      setPoints(defaults.points ?? 0);
    }

    if (getTickets() === null) {
      setTickets(defaults.tickets ?? 0);
    }

    if (!Array.isArray(getCollection())) {
      setCollection(defaults.collection ?? []);
    }

    if (!Array.isArray(getRecentDraws())) {
      setRecentDraws(defaults.recentDraws ?? []);
}
  }

  window.GachaStorage = {
    keys: STORAGE_KEYS,

    getCoins,
    setCoins,
    getPoints,
    setPoints,
    getTickets,
    setTickets,

    getCollection,
    setCollection,
    getRecentDraws,
    setRecentDraws,

    addPoints,
    addTickets,
    addToCollection,
    hasInCollection,
    addRecentDraw,
    clearRecentDraws,

    ensureDefaults,
    resetAll
  };
})();
