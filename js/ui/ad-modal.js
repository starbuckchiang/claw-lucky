/* ============================================================
   Ad Video Modal
   ------------------------------------------------------------
   負責：
   1. 開啟廣告影片
   2. 播放完成判定
   3. 關閉 Modal
   4. 播放完成 + 按 X 才 callback 發獎
   ============================================================ */

(function () {

  const modal = document.getElementById("adVideoModal");

  const video = document.getElementById("adVideoPlayer");

  const closeBtn =
    document.getElementById("adVideoCloseBtn") ||
    document.querySelector("[data-ad-modal-close]");

  const status = document.getElementById("adVideoStatus");

  let videoCompleted = false;
  let rewardClaimed = false;
  let completeCallback = null;

  /* ============================================================
     Open
     ============================================================ */

  function open(onComplete) {

    if (!modal || !video) {
      console.warn("[AdModal] Modal DOM 不存在");
      return;
    }

    completeCallback =
      typeof onComplete === "function"
        ? onComplete
        : null;

    videoCompleted = false;
    rewardClaimed = false;

    if (status) {
      status.textContent = "影片尚未播放完成";
    }

    modal.classList.add("show");

    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("x5-playsinline", "");

    video.playsInline = true;

    video.currentTime = 0;

    video.load();

    video.play().catch(() => {

      console.warn("[AdModal] autoplay failed");

      if (status) {
        status.textContent = "請點擊播放影片";
      }

    });

  }

  /* ============================================================
     Close
     ============================================================ */

  async function close() {
  if (!modal || !video) return;

  video.pause();
  modal.classList.remove("show");

  if (!videoCompleted) {
    if (status) status.textContent = "影片尚未播放完成";
    return;
  }

  if (rewardClaimed) return;
  rewardClaimed = true;

  try {
    if (completeCallback) {
      await completeCallback();
    }

    if (status) {
      status.textContent = "補給已送達，祝你好運！";
    }
  } catch (error) {
    console.error("[AdModal] reward callback failed =", error);
    rewardClaimed = false;

    if (status) {
      status.textContent = "補給發放失敗，請稍後再試";
    }
  }
}

  /* ============================================================
     Video End
     ============================================================ */

  if (video) {

    video.addEventListener("ended", () => {

      videoCompleted = true;

      if (status) {

        status.textContent =
          "影片播放完成，請按右上角 × 領取補給";

      }

    });

  }

  /* ============================================================
     Close Button
     ============================================================ */

  if (closeBtn) {

    closeBtn.addEventListener("click", close);

  }

  /* ============================================================
     ESC
     ============================================================ */

  document.addEventListener("keydown", (e) => {

    if (e.key === "Escape") {

      if (modal?.classList.contains("show")) {

        close();

      }

    }

  });

  /* ============================================================
     API
     ============================================================ */

  window.AdModal = {

    open,

    close

  };

})();
