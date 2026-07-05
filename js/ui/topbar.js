(function () {
  function getStorage() {
    return window.GachaStorage || null;
  }

  function getData() {
    return window.GachaData || null;
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
    if (!window.GachaUI?.renderTopbar) return;

    window.GachaUI.renderTopbar(
      buildState(remoteUser),
      refs
    );
  }

  async function refresh(refs) {
    const profile = window.UserStore?.getUserProfile
      ? window.UserStore.getUserProfile()
      : { userId: "", nickname: "" };

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
    render,
    refresh,
    buildState
  };
})();
