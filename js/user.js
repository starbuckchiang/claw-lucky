(function () {
  const USER_ID_KEY = 'ossUserId';
  const USER_NICKNAME_KEY = 'ossNickname';

  function createRandomId() {
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
    return localStorage.getItem(USER_ID_KEY) || '';
  }

  function setNickname(nickname) {
    const safeNickname = String(nickname || '').trim();
    localStorage.setItem(USER_NICKNAME_KEY, safeNickname);
    return safeNickname;
  }

  function getNickname() {
    return localStorage.getItem(USER_NICKNAME_KEY) || '';
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

  window.UserStore = {
    getOrCreateUserId,
    getUserId,
    setNickname,
    getNickname,
    getUserProfile,
    clearUserProfile
  };
})();

