/* ============================================================
   Topbar UI Module
   ------------------------------------------------------------
   負責：
   1. 從 Supabase user 組成 topbar state
   2. 加入收藏數 collection / collectionTotal
   3. 呼叫 GachaUI.renderTopbar()
   4. 提供 gacha.js 使用的 refresh()
   ============================================================ */

(function () {
  function getStorage() {
    return window.GachaStorage || null;
  }

  function getData() {
    return window.GachaData || null;
  }

  function getUserProfile() {
    return window.UserStore?.getUserProfile
      ? window.UserStore.getUserProfile()
      : { userId: "", nickname: "" };
  }

  function buildState(remoteUser) {
    const storage = getStorage();
    const data = getData();

    const collection = storage?.getCollection
      ? storage.getCollection() || []
      : [];

    const collectionTotal = Array.isArray(data?.pool)
      ? data.pool.length
      : Array.isArray(data?.mascots)
        ? data.mascots.length
        : 0;

    return {
      coins: Number(remoteUser?.coins || 0),
      points: Number(remoteUser?.points || 0),
      tickets: Number(remoteUser?.tickets || 0),
      collection,
      collectionTotal
    };
  }

  function render(remoteUser, refs) {
    if (!window.GachaUI?.renderTopbar) {
      console.warn("[Topbar] GachaUI.renderTopbar 尚未載入");
      return;
    }

    const state = buildState(remoteUser);

    console.log("[Topbar] render state =", state);

    window.GachaUI.renderTopbar(state, refs);
  }

  async function refresh(refs) {
    if (!window.Api) {
      throw new Error("Api 尚未初始化");
    }

    const profile = getUserProfile();

    if (!profile.userId) {
      throw new Error("找不到 userId");
    }

    const remoteUser = await window.Api.getUser(profile.userId);

    if (!remoteUser) {
      throw new Error("Supabase 找不到使用者");
    }

    render(remoteUser, refs);

    return remoteUser;
  }

  window.Topbar = {
    buildState,
    render,
    refresh
  };
})();
