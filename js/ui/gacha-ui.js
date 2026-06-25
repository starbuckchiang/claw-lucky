(function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function getData() {
    return window.GachaData || null;
  }

  function getRarityMeta(rarityCode) {
    const data = getData();
    if (!data?.getRarityConfig) {
      return {
        label: rarityCode || 'N',
        color: '#8b6a43',
        glow: 'rgba(139, 106, 67, 0.28)'
      };
    }

    return data.getRarityConfig(rarityCode);
  }

  function renderTopbar(state, refs = {}) {
    const {
      coinCountEl,
      pointCountEl,
      ticketCountEl,
      collectionCountEl
    } = refs;

    const coins = Number(state?.coins) || 0;
    const points = Number(state?.points) || 0;
    const tickets = Number(state?.tickets) || 0;
    const collection = Array.isArray(state?.collection) ? state.collection : [];
    const collectionTotal = Number(state?.collectionTotal) || 0;

    if (coinCountEl) coinCountEl.textContent = coins;
    if (pointCountEl) pointCountEl.textContent = points;
    if (ticketCountEl) ticketCountEl.textContent = tickets;
    if (collectionCountEl) {
      collectionCountEl.textContent = `${collection.length} / ${collectionTotal}`;
    }
  }

  function renderIdleResult(resultEl) {
    if (!resultEl) return;

    resultEl.innerHTML = `
      <div class="gacha-result-empty">
        轉動扭蛋機，看看今天的好運蛋會開出什麼吉祥物。
      </div>
    `;
  }

  function renderMessageResult(resultEl, message, type = 'notice') {
    if (!resultEl) return;

    const safeMessage = escapeHtml(message || '目前沒有可顯示的訊息。');

    resultEl.innerHTML = `
      <div class="notice-box gacha-result-message gacha-result-message--${escapeHtml(type)}">
        ${safeMessage.replaceAll('\n', '<br>')}
      </div>
    `;
  }

  function renderLoadingResult(resultEl) {
    if (!resultEl) return;

    resultEl.innerHTML = `
      <div class="gacha-result-empty">
        扭蛋機轉動中，請稍候...
      </div>
    `;
  }

  function renderDropZoneIdle(dropZoneEl) {
    if (!dropZoneEl) return;

    dropZoneEl.innerHTML = `
      <div class="gacha-drop-placeholder">等待好運蛋掉出來</div>
    `;
  }

  function renderDropZoneLoading(dropZoneEl) {
    if (!dropZoneEl) return;

    dropZoneEl.innerHTML = `
      <div class="gacha-drop-placeholder">好運蛋掉落中...</div>
    `;
  }

  function renderDropZoneCapsule(dropZoneEl, rarityCode) {
    if (!dropZoneEl) return;

    const rarity = getRarityMeta(rarityCode);
    const safeCode = escapeHtml(rarityCode || 'N');
    const safeLabel = escapeHtml(rarity?.label || safeCode);
    const safeGlow = rarity?.glow || 'rgba(139, 106, 67, 0.28)';
    const safeColor = rarity?.color || '#8b6a43';

    dropZoneEl.innerHTML = `
      <div
        class="gacha-drop-capsule gacha-drop-capsule--${safeCode}"
        style="box-shadow: 0 0 0 6px ${safeGlow};"
        aria-label="${safeLabel}好運蛋"
      >
        <span
          class="gacha-drop-capsule-core"
          style="background:
            linear-gradient(180deg, rgba(255,255,255,0.9) 0 48%, rgba(0,0,0,0.08) 48% 52%, rgba(255,255,255,0.22) 52% 100%),
            ${safeColor};"
        ></span>
      </div>
    `;
  }

  function buildMascotVisual(result) {
    const image = escapeHtml(result?.image || '');
    const name = escapeHtml(result?.name || '未知吉祥物');

    if (image) {
      return `
        <img
          class="gacha-result-mascot-image"
          src="${image}"
          alt="${name}"
          loading="lazy"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
        />
        <div class="gacha-result-mascot-placeholder" style="display:none;">
          ${name}
        </div>
      `;
    }

    return `
          <div class="gacha-result-mascot-placeholder">
        ${name}
      </div>
    `;
  }

  function buildRecentThumb(item) {
    const image = escapeHtml(item?.image || '');
    const name = escap
eHtml(item?.name || '未知吉祥物');

    if (image) {
      return `
        <img
          class="gacha-recent-thumb-image"
          src="${image}"
          alt="${name}"
          loading="lazy"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
        />
        <div class="gacha-recent-thumb-fallback" style="display:none;">
          ${name.slice(0, 2)}
        </div>
      `;
    }

    return `
      <div class="gacha-recent-thumb-fallback">
        ${name.slice(0, 2)}
      </div>
    `;
  }

  function buildResultCard(result) {
    const rarity = getRarityMeta(result?.rarity);
    const rarityCode = escapeHtml(result?.rarity || 'N');
    const rarityLabel = escapeHtml(result?.rarityLabel || rarity?.label || rarityCode);
    const name = escapeHtml(result?.name || '未知吉祥物');
    const title = escapeHtml(result?.title || '');
    const description = escapeHtml(result?.description || '');
    const pointsEarned = Number(result?.pointsEarned) || 0;
    const ticketsEarned = Number(result?.ticketsEarned) || 0;
    const isNew = Boolean(result?.isNew);

    const badgeText = isNew ? 'NEW 收藏成功' : '重複收藏';
    const bonusLine = isNew
      ? `
        <div class="gacha-result-reward">
          <span>💎 獲得點數</span>
          <strong>+${pointsEarned}</strong>
        </div>
        <div class="gacha-result-reward">
          <span>🎟 獲得兌換券</span>
          <strong>+${ticketsEarned}</strong>
        </div>
      `
      : `
        <div class="gacha-result-reward">
          <span>💎 重複補償點數</span>
          <strong>+${pointsEarned}</strong>
        </div>
      `;

    return `
      <article
        class="gacha-result-card rarity-${rarityCode}"
        style="box-shadow: 0 0 0 6px ${rarity?.glow || 'rgba(139, 106, 67, 0.18)'};"
      >
        <div class="gacha-result-visual">
          <div class="gacha-result-mascot-badge" style="background:${rarity?.color || '#8b6a43'};">
            ${rarityLabel}
          </div>
          <div class="gacha-result-mascot">
            ${buildMascotVisual(result)}
          </div>
        </div>

        <div class="gacha-result-content">
          <div class="gacha-result-chip">${badgeText}</div>
          <h3 class="gacha-result-name">${name}</h3>
          <p class="gacha-result-title">${title}</p>
          <p class="gacha-result-desc">${description}</p>

          <div class="gacha-result-rewards">
            ${bonusLine}
          </div>
        </div>
      </article>
    `;
  }

  function renderDrawResult(resultEl, result) {
    if (!resultEl || !result) return;
    resultEl.innerHTML = buildResultCard(result);
  }

  function renderRecentDraws(list, recentDrawListEl) {
    if (!recentDrawListEl) return;

    const items = Array.isArray(list) ? list : [];

    if (!items.length) {
      recentDrawListEl.innerHTML = `
        <div class="gacha-empty-inline">目前還沒有抽卡紀錄。</div>
      `;
      return;
    }

    recentDrawListEl.innerHTML = items
      .slice()
      .reverse()
      .slice(0, 5)
.map((item) => {
        const rarity = getRarityMeta(item?.rarity);
        const name = escapeHtml(item?.name || '未知吉祥物');
        const rarityCode = escapeHtml(item?.rarity || 'N');
        const rarityLabel = escapeHtml(rarity?.label || rarityCode);
        const points = Number(item?.points) || 0;
        const tickets = Number(item?.tickets) || 0;
        const isNew = Boolean(item?.isNew);

        return `
          <article class="soft-card gacha-recent-item">
            <div class="gacha-recent-main">
              <div class="gacha-recent-thumb">
                ${buildRecentThumb(item)}
              </div>

              <div class="gacha-recent-body">
                <div class="gacha-recent-head">
                  <strong class="gacha-recent-name">${name}</strong>
                  <span
                    class="gacha-recent-rarity"
                    style="background:${rarity?.color || '#8b6a43'};"
                  >
                    ${rarityLabel}
                  </span>
                </div>

                <div class="gacha-recent-meta">
                  <span>💎 +${points}</span>
                  <span>🎟 +${tickets}</span>
                  <span>${isNew ? '新收藏' : '重複收藏'}</span>
                </div>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function setMachineDrawing(machineEl, isActive) {
    if (!machineEl) return;
    machineEl.classList.toggle('is-drawing', Boolean(isActive));
  }

  function setDrawButtonsDisabled(refs = {}, disabled = false) {
    const { drawBtnEl, drawBtnAltEl } = refs;
    if (drawBtnEl) drawBtnEl.disabled = Boolean(disabled);
    if (drawBtnAltEl) drawBtnAltEl.disabled = Boolean(disabled);
  }

  window.GachaUI = {
    renderTopbar,
    renderIdleResult,
    renderMessageResult,
    renderLoadingResult,
    renderDropZoneIdle,
    renderDropZoneLoading,
    renderDropZoneCapsule,
    renderDrawResult,
    renderRecentDraws,
    setMachineDrawing,
    setDrawButtonsDisabled
  };
})();

