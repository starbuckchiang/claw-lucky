const SUPABASE_URL = "https://umtqpstacjdwxcvcirbl.supabase.co";
const SUPABASE_KEY = "sb_publishable_PtWhyYhKGUVxph4o80oGbg_aeZVnUyk";

if (!window.supabaseClient) {
  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        storageKey: "claw-lucky-auth"
      }
    }
  );

  console.log("[config] Supabase client created");
} else {
  console.log("[config] Supabase client already exists");
}

// Supabase Edge Functions base URL (P2-AI-02).
// GEMINI_API_KEY / SUPABASE_SERVICE_ROLE_KEY are never exposed here — only
// the already-public anon/publishable key (SUPABASE_KEY) is used client-side,
// to authenticate the caller when invoking these Functions.
window.SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
window.SUPABASE_ANON_KEY = SUPABASE_KEY;

// =========================
// App Config / 全站設定值
// index07 與 gift.html 後續都可共用
// =========================

window.APP_CONFIG = {
  TURNSTILE_SITE_KEY: "0x4AAAAAADzEeqUja1PLlQeJ",

  // 廣告補給設定
  adRewardCoins: 20,
  adRewardBonusPlay: 1,
  maxDailyAdRewards: 3,

  // 遊戲獎勵設定
  ticketEveryCatch: 5,
  bonusGiftEveryCatch: 10,

  // 手機版判斷寬度
  mobileBreakpoint: 900,

  // 娃娃機座標設定
  prizeColsDesktop: [40, 120, 200, 280, 360],
  prizeRowsDesktop: [170, 230, 280],
  prizeColsMobile: [20, 65, 110, 155, 200],
  prizeRowsMobile: [55, 85, 115],

  // 爪子設定
  clawMoveStep: 30,

  // 本地影片路徑
  adVideoSrc: "./video/ad.mp4"
};
