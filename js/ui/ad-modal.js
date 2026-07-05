/* ============================================================
   Ad Modal
   ------------------------------------------------------------
   負責：
   1. 開啟 / 關閉廣告影片 Modal
   2. 判斷影片是否完整播放
   3. 完整播放 + 按 X 後才呼叫 callback 發放獎勵
   ============================================================ */

(function () {

  const modal = document.getElementById("adVideoModal");
  const video = document.getElementById("adVideoPlayer");

  const closeBtn =
    document.getElementById("adVideoCloseBtn") ||
    document.querySelector("[data-ad-modal-close]");

  const status = document.getElementById("adVideoStatus");

  let completed = false;
  let rewarded = false;
  let onComplete = null;

  /* ============================================================
     更新狀態文字
     ============================================================ */

  function setStatus(text) {
    if (status) {
      status.textContent = text;
    }
  }

  /* ============================================================
     開啟 Modal
     ============================================================ */

  function open(callback) {

    if (!modal || !video) {
      console.warn("[AdModal] Modal DOM 不存在");
      return;
    }

    completed = false;
    rewarded = false;
    onComplete = callback;

    setStatus("影片尚未播放完成");

    modal.hidden = false;
    document.body.classList.add("ad-modal-open");

    video.pause();

    video.currentTime = 0;

    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("x5-playsinline", "");

    video.playsInline = true;

    video.load();

    video.play().catch(() => {

      console.log("[AdModal] autoplay blocked");

      setStatus("請按播放鍵開始觀看影片");

    });

  }

  /* ============================================================
     關閉 Modal
     ============================================================ */

  async function close() {

    if (!modal || !video) return;

    video.pause();

    modal.hidden = true;

    document.body.classList.remove("ad-modal-open");

    if (!completed) {

      setStatus("影片尚未播放完成");

      return;

    }

    if (rewarded) return;

    rewarded = true;

    try {

      if (typeof onComplete === "function") {

        await onComplete();

      }

      setStatus("補給已送達，祝你好運！");

    } catch (error) {

      console.error("[AdModal]", error);

      rewarded = false;

      setStatus("補給發放失敗");

    }

  }

  /* ============================================================
     播放完成
     ============================================================ */

  if (video) {

    video.addEventListener("ended", () => {

      completed = true;

      setStatus("影片播放完成，按右上角 × 領取補給");

    });

  }

  /* ============================================================
     關閉按鈕
     ============================================================ */

  if (closeBtn) {

    closeBtn.addEventListener("click", close);

  }

  /* ============================================================
     ESC
     ============================================================ */

  document.addEventListener("keydown", (e) => {

    if (e.key !== "Escape") return;

    if (modal && !modal.hidden) {

      close();

    }

  });

  /* ============================================================
     Public API
     ============================================================ */

  window.AdModal = {

    open,

    close

  };

})();
