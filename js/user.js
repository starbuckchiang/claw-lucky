(function () {
  const USER_ID_KEY = "ossUserId";
  const USER_NICKNAME_KEY = "ossNickname";
  const SUPABASE_AUTH_USER_ID_KEY = "supabaseAuthUserId";

  let userReadyPromise = null;
  window.userReadyPromise = null;

  function createRandomId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }

    return Math.random().toString(36).slice(2, 10);
  }

  function getOrCreateUserId() {
    let userId = localStorage.getItem(USER_ID_KEY);

    if (!userId) {
      userId = `oss_u_${createRandomId()}`;
      localStorage.setItem(USER_ID_KEY, userId);

      console.log("[user] create new userId =", userId);
    }

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

  function getCaptchaTokenFromPage() {
    const tokenInput = document.querySelector("input[name='cf-turnstile-response']");
    const token = tokenInput?.value || "";
    return String(token).trim();
  }

  async function waitForTurnstile() {
    const maxWaitMs = 10_000;
    const intervalMs = 100;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      if (window.turnstile && typeof window.turnstile.render === "function") {
        return window.turnstile;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error("Turnstile 尚未載入");
  }

  async function verifyTurnstile() {
    const existingToken = getCaptchaTokenFromPage();
    if (existingToken) {
      return Promise.resolve(existingToken);
    }

    await waitForTurnstile();

    const siteKey = window.APP_CONFIG?.TURNSTILE_SITE_KEY || "";

    if (!siteKey) {
      throw new Error("找不到 Turnstile site key");
    }

    return new Promise((resolve, reject) => {
      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.left = "50%";
      container.style.top = "50%";
      container.style.transform = "translate(-50%, -50%)";
      container.style.zIndex = "9999";
      container.style.background = "#fff";
      container.style.padding = "12px";
      container.style.borderRadius = "12px";
      container.style.boxShadow = "0 8px 30px rgba(0, 0, 0, 0.2)";
      document.body.appendChild(container);

      const cleanup = () => {
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
      };

      try {
        const widgetId = window.turnstile.render(container, {
          sitekey: siteKey,
          size: "normal",
          callback: (token) => {
            cleanup();
            resolve(String(token || "").trim());
          },
          "error-callback": () => {
            cleanup();
            reject(new Error("Turnstile 驗證失敗"));
          },
          "expired-callback": () => {
            cleanup();
            reject(new Error("Turnstile 驗證逾期"));
          }
        });

        if (!widgetId && widgetId !== 0) {
          cleanup();
          reject(new Error("Turnstile widget 建立失敗"));
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  async function ensureSupabaseAuthUser() {
    if (!window.supabaseClient?.auth) {
      throw new Error("Supabase auth 尚未初始化");
    }

    const { data: sessionData, error: sessionError } =
      await window.supabaseClient.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    if (sessionData?.session?.user?.id) {
      const existingAuthUserId = String(sessionData.session.user.id);
      localStorage.setItem(SUPABASE_AUTH_USER_ID_KEY, existingAuthUserId);
      console.log(`[user] auth user ready = ${existingAuthUserId}`);
      return sessionData.session.user;
    }

    const captchaToken = await verifyTurnstile();

    const { data, error } = await window.supabaseClient.auth.signInAnonymously({
      options: {
        captchaToken
      }
    });

    if (error) {
      throw error;
    }

    const authUserId = String(data?.user?.id || "").trim();

    if (!authUserId) {
      throw new Error("Anonymous auth user id 無效");
    }

    localStorage.setItem(SUPABASE_AUTH_USER_ID_KEY, authUserId);
    console.log(`[user] auth user ready = ${authUserId}`);

    return data.user;
  }

  function clearUserProfile() {
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(USER_NICKNAME_KEY);
  }

  async function initUser() {

    if (userReadyPromise) {
      return userReadyPromise;
    }

    userReadyPromise = (async () => {

      const profile = getUserProfile();
      let authUser = null;

      try {
        authUser = await ensureSupabaseAuthUser();
      } catch (authError) {
        console.error("[user] auth init failed =", authError);
      }

      if (!window.Api) {
        console.warn("[user] Api 尚未載入");
        return profile;
      }

      try {
        const authUserId = String(authUser?.id || "").trim();

        if (!authUserId) {
          throw new Error("找不到 auth user id，停止 users upsert");
        }

        // 先查詢是否存在
        let user = await window.Api.getUser(authUserId);

        // 如果不存在，就重新建立
        if (!user) {

          console.log("[user] user not found, create new user...");
          console.log("[user] inserting user_id =", authUserId);
          console.log("[user] auth uid =", authUser?.id);

          user = await window.Api.createUserIfNotExists({
            userId: authUserId,
            nickname: profile.nickname
          });

        }

        console.log("[user] Supabase user ready =", user);

        return user;

      } catch (error) {

        console.error("[user] initUser failed =", error);

        return profile;

      }

    })();

    window.userReadyPromise = userReadyPromise;

    return userReadyPromise;
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

})();
