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
      return 'N';
    }

    const totalRate = data.rarityOrder.reduce((sum, code) => {
      const rate = Number(data.rarities?.[code]?.rate) || 0;
      return sum + rate;
    }, 0);

    if (totalRate <= 0) return 'N';

    let roll = Math.random() * totalRate;

    for (const code of data.rarityOrder) {
      const rate = Number(data.rarities?.[code]?.rate) || 0;
      roll -= rate;
      if (roll < 0) {
        return code;
      }
    }

    return 'N';
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
      rarityColor: rarityConfig?.color || '#8b6a43',
      rarityGlow: rarityConfig?.glow || 'rgba(139, 106, 67, 0.28)',
      title: mascot.title || '',
      description: mascot.description || '',
      image: mascot.image || '',
      silhouette: mascot.silhouette || '',
      isNew,
      pointsEarned: reward.pointsEarned,
      ticketsEarned: reward.ticketsEarned,
      duplicateBonus: reward.duplicateBonus,
      createdAt: Date.now()
    };
  }

  function canDraw() {
    const storage = getStorage();
    const coins = storage?.getCoins ? storage.getCoins() : 0;
    return Number(coins) > 0;
  }

  function consumeCoin() {
    const storage = getStorage();
    if (!storage?.getCoins || !storage?.setCoins) return 0;

    const current = Number(storage.getCoins()) || 0;
    const next = Math.max(0, current - 1);
    storage.setCoins(next);
    return next;
  }

  function applyRewards(drawResult) {
    const storage = getStorage();
    if (!storage) return;

    if (storage.addPoints) {
      storage.addPoints(drawResult.pointsEarned || 0);
    } else if (storage.getPoints && storage.setPoints) {
      const currentPoints = Number(storage.getPoints()) || 0;
      storage.setPoints(currentPoints + (Number(drawResult.pointsEarned) || 0));
    }

    if (storage.addTickets) {
      storage.addTickets(drawResult.ticketsEarned || 0);
    } else if (storage.getTickets && storage.setTickets) {
      const currentTickets = Number(storage.getTickets()) || 0;
      storage.setTickets(currentTickets + (Number(drawResult.ticketsEarned) || 0));
    }

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

  function drawOnce() {
    const data = getData();
    const storage = getStorage();

    if (!data || !storage) {
      return {
        ok: false,
        error: 'missing_dependencies',
        message: 'GachaData 或 GachaStorage 尚未載入。'
      };
    }

    if (!canDraw()) {
      return {
        ok: false,
        error: 'not_enough_coins',
        message: '好運幣不足，無法轉蛋。'
      };
    }

    const rarityCode = rollRarity();
    const mascot = pickMascotByRarity(rarityCode);

    if (!mascot) {
      return {
        ok: false,
        error: 'empty_pool',
        message: `找不到 ${rarityCode} 稀有度的吉祥物資料。`
      };
    }

    consumeCoin();

    const isOwned = storage.hasInCollection
      ? storage.hasInCollection(mascot.id)
      : false;

    const isNew = !isOwned;
    const reward = buildRewardResult(mascot, isNew);
    const drawResult = normalizeDrawResult(mascot, rarityCode, isNew, reward);

    applyRewards(drawResult);

    return {
      ok: true,
      result: drawResult
    };
  }

  function previewRandomMascot() {
    const data = getData();
    if (!Array.isArray(data?.mascots) || !data.mascots.length) return null;
    return randomPick(data.mascots);
  }

  window.GachaEngine = {
    rollRarity,
    pickMascotByRarity,
    canDraw,
    drawOnce,
    previewRandomMascot
  };
})();


