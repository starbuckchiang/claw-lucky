(function () {
  const USER_ID_KEY = "ossUserId";
  const USER_NICKNAME_KEY = "ossNickname";
  const SUPABASE_AUTH_USER_ID_KEY = "supabaseAuthUserId";
  const AUTH_SESSION_KEY = "claw-lucky-auth-session";

  let userReadyPromise = null;
  let authUserCache = null;
  let readyUserCache = null;
  window.userReadyPromise = null;
  window.__clawUserInitLock = window.__clawUserInitLock || null;
  window.__clawAuthSignInLock = window.__clawAuthSignInLock || null;

  function createRandomId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }

    return Math.random().toString(36).slice(2, 10);
  }

  function getOrCreateLegacyUserId() {
    let userId = localStorage.getItem(USER_ID_KEY);

    if (!userId) {
      userId = `oss_u_${createRandomId()}`;
      localStorage.setItem(USER_ID_KEY, userId);

      console.log("[user] create new userId =", userId);
    }

    return userId;
  }

  function getLegacyUserId() {
    return localStorage.getItem(USER_ID_KEY) || "";
  }

  function getAuthUserId() {
    return localStorage.getItem(SUPABASE_AUTH_USER_ID_KEY) || "";
  }

  function getUserId() {
    return getAuthUserId();
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
      userId: getAuthUserId(),
      legacyUserId: getOrCreateLegacyUserId(),
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

    console.log("[auth] stored session user =", sessionData?.session?.user?.id || null);

    if (sessionData?.session?.user?.id) {
      const existingAuthUserId = String(sessionData.session.user.id);
      localStorage.setItem(SUPABASE_AUTH_USER_ID_KEY, existingAuthUserId);
      try {
        localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionData.session));
      } catch (error) {
        console.warn("[auth] store session cache failed =", error);
      }
      authUserCache = sessionData.session.user;
      console.log(`[user] auth user ready = ${existingAuthUserId}`);
      return sessionData.session.user;
    }

    const rawCachedSession = localStorage.getItem(AUTH_SESSION_KEY);
    if (rawCachedSession) {
      try {
        const cachedSession = JSON.parse(rawCachedSession);
        if (cachedSession?.access_token && cachedSession?.refresh_token) {
          const { data: restoredData, error: restoredError } =
            await window.supabaseClient.auth.setSession({
              access_token: cachedSession.access_token,
              refresh_token: cachedSession.refresh_token
            });

          if (!restoredError && restoredData?.session?.user?.id) {
            const restoredUserId = String(restoredData.session.user.id);
            localStorage.setItem(SUPABASE_AUTH_USER_ID_KEY, restoredUserId);
            try {
              localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(restoredData.session));
            } catch (error) {
              console.warn("[auth] store restored session cache failed =", error);
            }
            authUserCache = restoredData.session.user;
            console.log("[auth] stored session user =", restoredUserId);
            console.log(`[user] auth user ready = ${restoredUserId}`);
            return restoredData.session.user;
          }
        }
      } catch (error) {
        console.warn("[auth] parse cached session failed =", error);
      }
    }

    if (window.__clawAuthSignInLock) {
      return window.__clawAuthSignInLock;
    }

    window.__clawAuthSignInLock = (async () => {
      const { data: latestSessionData, error: latestSessionError } =
        await window.supabaseClient.auth.getSession();

      if (latestSessionError) {
        throw latestSessionError;
      }

      if (latestSessionData?.session?.user?.id) {
        const latestUserId = String(latestSessionData.session.user.id);
        localStorage.setItem(SUPABASE_AUTH_USER_ID_KEY, latestUserId);
        try {
          localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(latestSessionData.session));
        } catch (error) {
          console.warn("[auth] store latest session cache failed =", error);
        }
        authUserCache = latestSessionData.session.user;
        console.log("[auth] stored session user =", latestUserId);
        console.log(`[user] auth user ready = ${latestUserId}`);
        return latestSessionData.session.user;
      }

      const captchaToken = await verifyTurnstile();

      console.log("[auth] creating anonymous user =", true);

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

      const { data: postSessionData } = await window.supabaseClient.auth.getSession();

      localStorage.setItem(SUPABASE_AUTH_USER_ID_KEY, authUserId);
      if (postSessionData?.session) {
        try {
          localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(postSessionData.session));
        } catch (storeError) {
          console.warn("[auth] store post sign-in session failed =", storeError);
        }
      }
      authUserCache = data.user;
      console.log(`[user] auth user ready = ${authUserId}`);

      return data.user;
    })();

    try {
      return await window.__clawAuthSignInLock;
    } finally {
      window.__clawAuthSignInLock = null;
    }
  }

  function clearUserProfile() {
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(USER_NICKNAME_KEY);
  }

  async function initUser() {

    if (userReadyPromise) {
      return userReadyPromise;
    }

    if (window.__clawUserInitLock) {
      userReadyPromise = window.__clawUserInitLock;
      window.userReadyPromise = userReadyPromise;
      return userReadyPromise;
    }

    window.__clawUserInitLock = (async () => {

      const profile = getUserProfile();
      let authUser = null;

      try {
        authUser = await ensureSupabaseAuthUser();
      } catch (authError) {
        console.error("[user] auth init failed =", authError);
      }

      if (!window.Api) {
        console.warn("[user] Api 尚未載入");
        const fallbackUser = {
          user_id: String(authUser?.id || profile.userId || "").trim(),
          userId: String(authUser?.id || profile.userId || "").trim(),
          legacyUserId: profile.legacyUserId,
          nickname: profile.nickname,
          points: 0,
          tickets: 0,
          coins: 20
        };
        readyUserCache = fallbackUser;
        return fallbackUser;
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

        const normalizedUser = {
          ...user,
          user_id: String(user?.user_id || authUserId),
          userId: String(user?.user_id || authUserId),
          legacyUserId: profile.legacyUserId
        };

        console.log("[user] Supabase user ready =", normalizedUser);
        readyUserCache = normalizedUser;

        return normalizedUser;

      } catch (error) {

        console.error("[user] initUser failed =", error);

        const fallbackUser = {
          user_id: String(authUser?.id || "").trim(),
          userId: String(authUser?.id || "").trim(),
          legacyUserId: profile.legacyUserId,
          nickname: profile.nickname,
          points: 0,
          tickets: 0,
          coins: 20
        };
        readyUserCache = fallbackUser;

        return fallbackUser;

      }

    })();

    userReadyPromise = window.__clawUserInitLock;

    window.userReadyPromise = userReadyPromise;

    userReadyPromise.finally(() => {
      if (window.__clawUserInitLock === userReadyPromise) {
        window.__clawUserInitLock = null;
      }
    });

    return userReadyPromise;
  }

  window.UserStore = {
    getOrCreateUserId: getOrCreateLegacyUserId,
    getOrCreateLegacyUserId,
    getLegacyUserId,
    getAuthUserId,
    getUserId,
    setNickname,
    getNickname,
    getUserProfile,
    clearUserProfile,
    initUser
  };

  window.ClawUser = {
    getUserId,
    getAuthUser() {
      return authUserCache;
    }
  };

})();
