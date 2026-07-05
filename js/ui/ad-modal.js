/* ============================================================
   Ad Video Modal
   ------------------------------------------------------------
   規則：
   1. 點擊觀看廣告 → 開啟影片 modal
   2. 影片完整播放 ended
   3. 使用者按 X 關閉
   4. 才呼叫 onComplete 發獎勵
   ============================================================ */

(function () {
  const adVideoModal = document.getElementById("adVideoModal");
  const adVideoPlayer = document.getElementById("adVideoPlayer");
  const adVideoCloseBtn = document.getElementById("adVideoCloseBtn");
  const adVideoStatus = document.getElementById("adVideoStatus");

  let adVideoCompleted = false;
  let adRewardClaimed = false;
  let completeCallback = null;

  function open(onComplete) {
    if (!adVideoModal || !adVideoPlayer || !adVideoCloseBtn) {
      console.warn("[AdModal] modal elements not found");
      return;
    }

    adVideoCompleted = false;
    adRewardClaimed = false;
    completeCallback = typeof onComplete === "function" ? onComplete : null;

    if (adVideoStatus) {
      adVideoStatus.textContent = "影片尚未播放完成";
    }

    adVideoModal.classList.add("show");

    adVideoPlayer.setAttribute("playsinline", "");
    adVideoPlayer.setAttribute("webkit-playsinline", "");
    adVideoPlayer.playsInline = true;

    adVideoPlayer.currentTime = 0;
    adVideoPlayer.load();

    adVideoPlayer.play().catch(() => {
      if (adVideoStatus) {
        adVideoStatus.textContent = "影片已開啟，如果沒有自動播放，請手動按播放。";
      }
    });
  }

  function close() {
    if (!adVideoPlayer || !adVideoModal) return;

    adVideoPlayer.pause();
    adVideoModal.classList.remove("show");

    if (!adVideoCompleted) {
      if (adVideoStatus) {
        adVideoStatus.textContent = "影片尚未播放完成";
      }

      alert("影片還沒播完，這次還不能領補給喔。");
      return;
    }

    if (adRewardClaimed) return;

    adRewardClaimed = true;

    if (adVideoStatus) {
      adVideoStatus.textContent = "補給已送達，記得去試試手氣！";
    }

    if (completeCallback) {
      completeCallback();
    }
  }

  if (adVideoPlayer) {
    adVideoPlayer.addEventListener("ended", () => {
      adVideoCompleted = true;

      if (adVideoStatus) {
        adVideoStatus.textContent =
          "影片播放完成，按右上角 × 關閉即可領取補給";
      }
    });
  }

  if (adVideoCloseBtn) {
    adVideoCloseBtn.addEventListener("click", close);
  }

  window.AdModal = {
    open,
    close
  };
})();
