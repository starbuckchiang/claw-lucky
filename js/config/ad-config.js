(function () {

  function getAdConfig() {

    const config = window.APP_CONFIG || {};

    return {
      adRewardCoins: Number(config.adRewardCoins || 20),
      adRewardBonusPlay: Number(config.adRewardBonusPlay || 1),
      maxDailyAdRewards: Number(config.maxDailyAdRewards || 99)
    };

  }

  window.AdConfig = {
    getAdConfig
  };

})();
