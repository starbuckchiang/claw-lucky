(function () {
  const USER_ID_KEY = "ossUserId";
  const USER_NICKNAME_KEY = "ossNickname";

  function createRandomId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }

    return Math.random().toString(36).slice(2, 10);
  }

  function getOrCreateUserId() {
    let userId = localStorage.getItem(USER_ID_KEY);

    if (userId) {
      return userId;
    }

    userId = `oss_u_${createRandomId()}`;
    localStorage.setItem(USER_ID_KEY, userId);

    return userId;
  }

  function getUserId() {
    return localStorage.getItem(USER_ID_KEY) || "";
  }

  function setNickname(nickname) {
    const safeNickname = String(nickname || "").trim();
    localStorage.setItem(USER_NICKNAME_KEY, safeNickname);
    return safeNickname;
  }

  function getNickname() {
    return localStorage.getItem(USER_NICKNAME_KEY) || "";
  }

  function getUserProfile() {
    return {
      userId: getOrCreateUserId(),
      nickname: getNickname()
    };
  }

  function clearUserProfile() {
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(USER_NICKNAME_KEY);
  }

  async function initUser() {
    const profile = getUserProfile();

    if (!window.Api) {
      console.warn("[user] Api 尚未載入，無法寫入 Supabase");
      return profile;
    }

    try {
      const user = await window.Api.createUserIfNotExists({
        userId: profile.userId,
        nickname: profile.nickname
      });

      console.log("[user] Supabase user ready =", user);
      return user;
    } catch (error) {
      console.error("[user] createUserIfNotExists failed =", error);
      return profile;
    }
  }

  window.UserStore = {
    getOrCreateUserId,
    getUserId,
    setNickname,
    getNickname,
    getUserProfile,
    clearUserProfile,
    initUser
  };

  function waitForApi(maxWaitMs = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();

    const timer = setInterval(() => {
      if (window.Api) {
        clearInterval(timer);
        resolve(window.Api);
        return;
      }

      if (Date.now() - start >= maxWaitMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 50);
  });
}

window.UserStore.ready = (async () => {
  await waitForApi();
  return initUser();
})();

document.addEventListener("DOMContentLoaded", async () => {
  await window.UserStore.ready;
});
})();
