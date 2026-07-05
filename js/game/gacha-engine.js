(function () {
  function getData() {
    return window.GachaData || null;
  }

  function getStorage() {
    return window.GachaStorage || null;
  }

  function randomInt(max) {
    return Math.floor(Math.random() * max);
  }

  function randomPick(list) {
    if (!Array.isArray(list) || !list.length) return null;
    return list[randomInt(list.length)] || null;
  }

  function rollRarity() {
    const data = getData();

    if (!data?.rarities || !Array.isArray(data?.rarityOrder)) {
      return "N";
    }

    const totalRate = data.rarityOrder.reduce((sum, code) => {
      const rate = Number(data.rarities?.[code]?.rate) || 0;
      return sum + rate;
    }, 0);

    if (totalRate <= 0) return "N";

    let roll = Math.random() * totalRate;

    for (const code of data.rarityOrder) {
      const rate = Number(data.rarities?.[code]?.rate) || 0;
      roll -= rate;

      if (roll < 0) {
        return code;
      }
    }

    return "N";
  }

  function pickMascotByRarity(rarityCode) {
    const data = getData();
    const pool = data?.getMascotsByRarity
      ? data.getMascotsByRarity(rarityCode)
      : [];

    if (!Array.isArray(pool) || !pool.length) {
      return null;
    }

    return randomPick(pool);
  }

  function buildRewardResult(mascot, isNew) {
    const rarityConfig = getData()?.getRarityConfig
      ? getData().getRarityConfig(mascot.rarity)
      : null;

    if (isNew) {
      return {
        pointsEarned: Number(mascot.points) || 0,
        ticketsEarned: Number(mascot.tickets) || 0,
        duplicateBonus: 0,
        rarityLabel: rarityConfig?.label || mascot.rarity
      };
    }

    return {
      pointsEarned: Number(mascot.duplicateBonus) || 0,
      ticketsEarned: 0,
      duplicateBonus: Number(mascot.duplicateBonus) || 0,
      rarityLabel: rarityConfig?.label || mascot.rarity
    };
  }

  function normalizeDrawResult(mascot, rarityCode, isNew, reward) {
    const data = getData();
    const rarityConfig = data?.getRarityConfig
      ? data.getRarityConfig(rarityCode)
      : null;

    return {
      id: mascot.id,
      name: mascot.name,
      rarity: rarityCode,
      rarityLabel: rarityConfig?.label || reward.rarityLabel || rarityCode,
      rarityColor: rarityConfig?.color || "#8b6a43",
      rarityGlow: rarityConfig?.glow || "rgba(139, 106, 67, 0.28)",
      title: mascot.title || "",
      description: mascot.description || "",
      image: mascot.image || "",
      silhouette: mascot.silhouette || "",
      isNew,
      pointsEarned: Number(reward.pointsEarned || 0),
      ticketsEarned: Number(reward.ticketsEarned || 0),
      duplicateBonus: Number(reward.duplicateBonus || 0),
      coinsCost: 1,
      createdAt: Date.now()
    };
  }

  function canDraw(currentCoins) {
    return Number(currentCoins || 0) > 0;
  }

  function drawOnce({ currentCoins = 0 } = {}) {
    const data = getData();
    const storage = getStorage();

    if (!data || !storage) {
      return {
        ok: false,
        error: "missing_dependencies",
        message: "GachaData 或 GachaStorage 尚未載入。"
      };
    }

    if (!canDraw(currentCoins)) {
      return {
        ok: false,
        error: "not_enough_coins",
        message: "好運幣不足，無法轉蛋。"
      };
    }

    const rarityCode = rollRarity();
    const mascot = pickMascotByRarity(rarityCode);

    if (!mascot) {
      return {
        ok: false,
        error: "empty_pool",
        message: `找不到 ${rarityCode} 稀有度的吉祥物資料。`
      };
    }

    const isOwned = storage.hasInCollection
      ? storage.hasInCollection(mascot.id)
      : false;

    const isNew = !isOwned;
    const reward = buildRewardResult(mascot, isNew);
    const result = normalizeDrawResult(mascot, rarityCode, isNew, reward);

    return {
      ok: true,
      result
    };
  }

  function commitDrawResult(drawResult) {
    const storage = getStorage();

    if (!storage || !drawResult) return;

    if (drawResult.isNew && storage.addToCollection) {
      storage.addToCollection(drawResult.id);
    }

    if (storage.addRecentDraw) {
      storage.addRecentDraw({
        id: drawResult.id,
        name: drawResult.name,
        rarity: drawResult.rarity,
        points: drawResult.pointsEarned,
        tickets: drawResult.ticketsEarned,
        isNew: drawResult.isNew,
        createdAt: drawResult.createdAt
      });
    }
  }

  function previewRandomMascot() {
    const data = getData();

    if (!Array.isArray(data?.mascots) || !data.mascots.length) {
      return null;
    }

    return randomPick(data.mascots);
  }

  window.GachaEngine = {
    rollRarity,
    pickMascotByRarity,
    canDraw,
    drawOnce,
    commitDrawResult,
    previewRandomMascot
  };
})();
