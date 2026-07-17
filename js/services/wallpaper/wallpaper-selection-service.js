"use strict";

function createNormalizedUiError(code, message, details = null) {
  return {
    ok: false,
    error: {
      code: String(code),
      message: String(message),
      retryable: false,
      details: details || null
    }
  };
}

function normalizeMascot(item) {
  return {
    id: String(item?.mascot_id || item?.id || "").trim(),
    name: String(item?.mascot_name || item?.name || "未命名吉祥物"),
    rarity: String(item?.rarity || "unknown"),
    image: String(item?.image || "")
  };
}

function normalizeGift(item) {
  return {
    id: String(item?.id || "").trim(),
    name: String(item?.name || item?.gift_name || "未命名禮物"),
    image: String(item?.image || item?.thumbnail || "")
  };
}

async function loadCollection({ api, userId }) {
  if (!api || typeof api.getUserMascots !== "function") {
    return createNormalizedUiError("LOADING_ERROR", "Collection service unavailable.");
  }

  try {
    const rows = await api.getUserMascots(userId);
    const mascots = Array.isArray(rows) ? rows.map(normalizeMascot).filter((item) => item.id) : [];
    return {
      ok: true,
      data: mascots
    };
  } catch (_error) {
    return createNormalizedUiError("COLLECTION_ERROR", "載入收藏吉祥物失敗。");
  }
}

async function loadGifts({ api }) {
  if (!api || typeof api.getGiftList !== "function") {
    return createNormalizedUiError("LOADING_ERROR", "Gift service unavailable.");
  }

  try {
    const rows = await api.getGiftList();
    const gifts = Array.isArray(rows) ? rows.map(normalizeGift).filter((item) => item.id) : [];
    return {
      ok: true,
      data: gifts
    };
  } catch (_error) {
    return createNormalizedUiError("GIFT_ERROR", "載入可使用禮物失敗。");
  }
}

function createSelectionState() {
  return {
    mascotId: null,
    giftId: null
  };
}

function selectMascot(state, mascotId) {
  state.mascotId = String(mascotId || "").trim() || null;
  return state;
}

function selectGift(state, giftId) {
  state.giftId = String(giftId || "").trim() || null;
  return state;
}

function buildPreview({ state, collection, gifts }) {
  const selectedMascot = (collection || []).find((item) => item.id === state.mascotId) || null;
  const selectedGift = (gifts || []).find((item) => item.id === state.giftId) || null;

  return {
    mascot: selectedMascot,
    gift: selectedGift
  };
}

async function submitGenerationSelection({
  generationClient,
  request,
  onProgress
}) {
  if (!generationClient || typeof generationClient.submitAndPoll !== "function") {
    return createNormalizedUiError("LOADING_ERROR", "Generation client unavailable.");
  }

  try {
    return await generationClient.submitAndPoll(request, { onProgress });
  } catch (_error) {
    return createNormalizedUiError("LOADING_ERROR", "送出生成請求失敗。");
  }
}

const wallpaperSelectionServiceApi = {
  createNormalizedUiError,
  loadCollection,
  loadGifts,
  createSelectionState,
  selectMascot,
  selectGift,
  buildPreview,
  submitGenerationSelection
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = wallpaperSelectionServiceApi;
}

if (typeof window !== "undefined") {
  window.WallpaperSelectionService = wallpaperSelectionServiceApi;
}
