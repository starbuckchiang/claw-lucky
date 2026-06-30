/*
  廣告播放模組（Ad Modal）
  功能：
  - 開啟 / 關閉廣告 modal
  - 播放獎勵影片
  - 監聽影片播放結束
  - 播放完成後，允許使用者領取獎勵
  - 透過 callback 通知 gacha.js 執行實際發獎

  設計分工：
  - ad-modal.js：只負責 UI / modal / video 流程
  - gacha.js：負責 coin、免費機會、剩餘次數等實際獎勵邏輯

  注意：
  - 如果手機瀏覽器阻擋自動播放，會退回手動測試領獎流程
  - 真正上線時可替換為正式廣告影片或外部廣告 SDK
*/

(function () {
  let modalEl = null;
  let backdropEl = null;
  let closeBtnEl = null;
  let videoEl = null;
  let rewardBtnEl = null;
  let titleEl = null;
  let descEl = null;

  let hasRewarded = false;
  let rewardCallback = null;

  function getConfig() {
    const config = window.APP_CONFIG || {};
    return {
      adVideoSrc: config.adVideoSrc || '',
      adRewardCoins: Number(config.adRewardCoins || 100),
      adRewardBonusPlay: Number(config.adRewardBonusPlay || 1)
    };
  }

  function ensureElements() {
    modalEl = document.getElementById('adModal');
    if (!modalEl) return false;

    backdropEl = modalEl.querySelector('[data-ad-modal-backdrop]');
    closeBtnEl = modalEl.querySelector('[data-ad-modal-close]');
    videoEl = modalEl.querySelector('#adVideo');
    rewardBtnEl = modalEl.querySelector('[data-ad-modal-reward]');
    titleEl = modalEl.querySelector('[data-ad-modal-title]');
    descEl = modalEl.querySelector('[data-ad-modal-desc]');

    return true;
  }

  function setHidden(hidden) {
    if (!modalEl) return;

    modalEl.hidden = hidden;
    modalEl.setAttribute('aria-hidden', hidden ? 'true' : 'false');

    if (hidden) {
      document.body.classList.remove('ad-modal-open');
    } else {
      document.body.classList.add('ad-modal-open');
    }
  }

  function resetState() {
    hasRewarded = false;

    if (rewardBtnEl) {
      rewardBtnEl.disabled = true;
      rewardBtnEl.textContent = '請先看完影片';
    }

    if (videoEl) {
      videoEl.currentTime = 0;
      videoEl.pause();

      const { adVideoSrc } = getConfig();
      if (adVideoSrc && videoEl.getAttribute('src') !== adVideoSrc) {
        videoEl.src = adVideoSrc;
        videoEl.load();
      }
    }

    if (titleEl) {
      titleEl.textContent = '🎬 今日補給影片';
    }

    if (descEl) {
      const { adRewardCoins, adRewardBonusPlay } = getConfig();
      descEl.textContent =
        `看完影片可獲得 +${adRewardCoins} 金幣` +
        (adRewardBonusPlay ? `、+${adRewardBonusPlay} 次免費機會` : '');
    }
  }

  function grantReward() {
    if (hasRewarded) return;

    hasRewarded = true;

    if (rewardBtnEl) {
      rewardBtnEl.disabled = false;
      rewardBtnEl.textContent = '領取獎勵';
    }

    if (titleEl) {
      titleEl.textContent = '🎉 影片播放完成';
    }

    if (descEl) {
      descEl.textContent = '可以領取這次補給獎勵了。';
    }
  }

  function handleRewardButtonClick() {
    if (!hasRewarded) return;

    if (typeof rewardCallback === 'function') {
      rewardCallback();
    }

    close();
  }

  function handleVideoEnded() {
    grantReward();
  }

  function handleBackdropClick(event) {
    if (event.target === backdropEl) {
      close();
    }
  }

  function handleEscapeKey(event) {
    if (event.key === 'Escape' && modalEl && !modalEl.hidden) {
      close();
    }
  }

  function bindEvents() {
    if (closeBtnEl) {
      closeBtnEl.addEventListener('click', close);
    }

    if (backdropEl) {
      backdropEl.addEventListener('click', handleBackdropClick);
    }

    if (videoEl) {
      videoEl.addEventListener('ended', handleVideoEnded);
    }

    if (rewardBtnEl) {
      rewardBtnEl.addEventListener('click', handleRewardButtonClick);
    }

    document.addEventListener('keydown', handleEscapeKey);
  }

  function open(onRewardGranted) {
    rewardCallback = onRewardGranted || null;

    if (!ensureElements()) {
      console.warn('AdModal: 找不到 #adModal');
      return;
    }

    resetState();
    setHidden(false);

    if (videoEl) {
      const playPromise = videoEl.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((error) => {
          console.warn('AdModal: 自動播放失敗，改用手動播放', error);

          if (rewardBtnEl) {
            rewardBtnEl.disabled = false;
            rewardBtnEl.textContent = '測試領取獎勵';
          }
        });
      }
    } else {
      grantReward();
    }
  }
(function () {
  let modalEl = null;
  let backdropEl = null;
  let closeBtnEl = null;
  let videoEl = null;
  let rewardBtnEl = null;
  let titleEl = null;
  let descEl = null;

  let hasRewarded = false;
  let rewardCallback = null;

  function getConfig() {
    const config = window.APP_CONFIG || {};
    return {
      adVideoSrc: config.adVideoSrc || '',
      adRewardCoins: Number(config.adRewardCoins || 100),
      adRewardBonusPlay: Number(config.adRewardBonusPlay || 1)
    };
  }

  function ensureElements() {
    modalEl = document.getElementById('adModal');
    if (!modalEl) return false;

    backdropEl = modalEl.querySelector('[data-ad-modal-backdrop]');
    closeBtnEl = modalEl.querySelector('[data-ad-modal-close]');
    videoEl = modalEl.querySelector('#adVideo');
    rewardBtnEl = modalEl.querySelector('[data-ad-modal-reward]');
    titleEl = modalEl.querySelector('[data-ad-modal-title]');
    descEl = modalEl.querySelector('[data-ad-modal-desc]');

    return true;
  }

  function setHidden(hidden) {
    if (!modalEl) return;

    modalEl.hidden = hidden;
    modalEl.setAttribute('aria-hidden', hidden ? 'true' : 'false');

    if (hidden) {
      document.body.classList.remove('ad-modal-open');
    } else {
      document.body.classList.add('ad-modal-open');
    }
  }

  function resetState() {
    hasRewarded = false;

    if (rewardBtnEl) {
      rewardBtnEl.disabled = true;
      rewardBtnEl.textContent = '請先看完影片';
    }

    if (videoEl) {
      videoEl.currentTime = 0;
      videoEl.pause();

      const { adVideoSrc } = getConfig();
      if (adVideoSrc && videoEl.getAttribute('src') !== adVideoSrc) {
        videoEl.src = adVideoSrc;
        videoEl.load();
      }
    }

    if (titleEl) {
      titleEl.textContent = '🎬 今日補給影片';
    }

    if (descEl) {
      const { adRewardCoins, adRewardBonusPlay } = getConfig();
      descEl.textContent =
        `看完影片可獲得 +${adRewardCoins} 金幣` +
        (adRewardBonusPlay ? `、+${adRewardBonusPlay} 次免費機會` : '');
    }
  }

  function grantReward() {
    if (hasRewarded) return;

    hasRewarded = true;

    if (rewardBtnEl) {
      rewardBtnEl.disabled = false;
      rewardBtnEl.textContent = '領取獎勵';
    }

    if (titleEl) {
      titleEl.textContent = '🎉 影片播放完成';
    }

    if (descEl) {
      descEl.textContent = '可以領取這次補給獎勵了。';
    }
  }

  function handleRewardButtonClick() {
    if (!hasRewarded) return;

    if (typeof rewardCallback === 'function') {
      rewardCallback();
    }

    close();
  }

  function handleVideoEnded() {
    grantReward();
  }

  function handleBackdropClick(event) {
    if (event.target === backdropEl) {
      close();
    }
  }

  function handleEscapeKey(event) {
    if (event.key === 'Escape' && modalEl && !modalEl.hidden) {
      close();
    }
  }

  function bindEvents() {
    if (closeBtnEl) {
      closeBtnEl.addEventListener('click', close);
    }

    if (backdropEl) {
      backdropEl.addEventListener('click', handleBackdropClick);
    }

    if (videoEl) {
      videoEl.addEventListener('ended', handleVideoEnded);
    }

    if (rewardBtnEl) {
      rewardBtnEl.addEventListener('click', handleRewardButtonClick);
    }

    document.addEventListener('keydown', handleEscapeKey);
  }

  function open(onRewardGranted) {
    rewardCallback = onRewardGranted || null;

    if (!ensureElements()) {
      console.warn('AdModal: 找不到 #adModal');
      return;
    }

    resetState();
    setHidden(false);

    if (videoEl) {
      const playPromise = videoEl.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((error) => {
          console.warn('AdModal: 自動播放失敗，改用手動播放', error);

          if (rewardBtnEl) {
            rewardBtnEl.disabled = false;
            rewardBtnEl.textContent = '測試領取獎勵';
          }
        });
      }
    } else {
      grantReward();
    }
  }

  function close() {
    if (!modalEl) return;
true);
    rewardCallback = null;
  }

  function init() {
    if (!ensureElements()) return;
    bindEvents();
    setHidden(true);
  }

  window.AdModal = {
    open,
    close,
    init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

  function close() {
    if (!modalEl) return;
