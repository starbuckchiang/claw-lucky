// =========================
// gift.html 專用 storage
// 不與 index07 共用
// =========================

window.GIFT_STORAGE_KEYS = {
  points: "giftPoints",
  tickets: "giftTickets",
  redeemHistory: "giftRedeemHistory"
};

// 讀數字
function getGiftStoredNumber(key, fallback = 0) {
  const raw = localStorage.getItem(key);
  const value = Number(raw);
  return Number.isNaN(value) ? fallback : value;
}

// 存數字
function setGiftStoredNumber(key, value) {
  localStorage.setItem(key, String(value));
}

// 讀 JSON
function getGiftStoredJSON(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

// 存 JSON
function setGiftStoredJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// 點數
function loadGiftPoints() {
  return getGiftStoredNumber(GIFT_STORAGE_KEYS.points, 0);
}

function saveGiftPoints(value) {
  setGiftStoredNumber(GIFT_STORAGE_KEYS.points, value);
}

// 兌換券
function loadGiftTickets() {
  return getGiftStoredNumber(GIFT_STORAGE_KEYS.tickets, 0);
}

function saveGiftTickets(value) {
  setGiftStoredNumber(GIFT_STORAGE_KEYS.tickets, value);
}

// 兌換紀錄
function loadGiftRedeemHistory() {
  return getGiftStoredJSON(GIFT_STORAGE_KEYS.redeemHistory, []);
}

function saveGiftRedeemHistory(history) {
  setGiftStoredJSON(GIFT_STORAGE_KEYS.redeemHistory, history);
}

window.GiftStorage = {
  getPoints: loadGiftPoints,
  setPoints: saveGiftPoints,
  getTickets: loadGiftTickets,
  setTickets: saveGiftTickets,
  getRedeemHistory: loadGiftRedeemHistory,
  setRedeemHistory: saveGiftRedeemHistory
};
