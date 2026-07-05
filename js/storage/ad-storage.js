(function () {

    const STORAGE_KEY = "gachaDailyAdRewards";

    function getTodayKey() {
        return new Date().toLocaleDateString("sv-SE");
    }

    function getState() {

        try {

            const raw = localStorage.getItem(STORAGE_KEY);

            if (!raw) {

                return {
                    date: getTodayKey(),
                    count: 0
                };

            }

            const state = JSON.parse(raw);

            if (state.date !== getTodayKey()) {

                return {
                    date: getTodayKey(),
                    count: 0
                };

            }

            return {
                date: state.date,
                count: Number(state.count || 0)
            };

        } catch {

            return {
                date: getTodayKey(),
                count: 0
            };

        }

    }

    function saveState(state) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function getRemaining() {

        const {
            maxDailyAdRewards
        } = window.AdConfig.getAdConfig();

        return Math.max(
            0,
            maxDailyAdRewards - getState().count
        );

    }

    window.AdStorage = {
        getState,
        saveState,
        getRemaining
    };

})();
