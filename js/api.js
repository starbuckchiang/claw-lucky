const DB = {
  users: "users",
  logs: "logs",
  gifts: "gifts",
  redeemHistory: "redeem_history",
  mascots: "mascots",
  userMascots: "user_mascots"
};

function getSupabaseClient() {
  if (!window.supabaseClient) {
    throw new Error("Supabase 尚未初始化，請確認 config.js 載入順序");
  }

  return window.supabaseClient;
}

/**
 * P-AUTH-05B-2A: secure write adapter for the `wallet-ops` Edge Function
 * (supabase/functions/wallet-ops/index.ts). Replaces the OLD pattern of
 * writing directly to `users`/`user_mascots`/`redeem_history`/`gifts` from
 * the browser with the anon key + a CLIENT-SUPPLIED owner id (see that
 * function's header comment for the exact vulnerabilities this closes).
 *
 * `window.supabaseClient.functions.invoke()` never throws for an ordinary
 * failure — it always resolves `{data, error}`.
 *
 * P-AUTH-05B-2A.1 Hotfix (requirements 1-4): `error.context` merely means
 * "an HTTP response of SOME kind came back" — it does NOT by itself mean
 * the server made a definitive business decision. The ONLY case that is
 * ever treated as non-retryable is a SUCCESSFULLY PARSED
 * `{ok:false, error:{...}}` JSON body whose `error.retryable` is
 * EXPLICITLY `false` (requirement 2/3 — this app's own deterministic
 * business rejections: insufficient balance, out of stock, gift/mascot
 * not found, etc., which `wallet-ops-handler.js` always tags with
 * `retryable:false`). EVERY other outcome defaults to `retryable: true`
 * (requirement 4), including:
 *   - HTTP 500/502/503/504 (or any other status) that ISN'T our own JSON
 *     error shape (e.g. a raw gateway/proxy error page) — `.json()` will
 *     either throw or resolve to something without an `error` field.
 *   - A response body that fails to parse as JSON at all.
 *   - A successfully-parsed body whose `error.retryable` is missing or not
 *     a boolean (an unrecognized/older error shape — never GUESS "safe",
 *     default to retryable).
 *   - No HTTP response was ever received at all (`error.context` absent —
 *     DNS/connection/timeout/`FunctionsFetchError`, a genuine
 *     network-layer failure).
 * This means a caller can ALWAYS safely resend the SAME logical operation
 * with the SAME idempotency key unless the server explicitly, successfully
 * told it not to bother — never the other way around.
 */
async function invokeWalletOpsFunction(path, body) {
  const { data, error } = await getSupabaseClient().functions.invoke(`wallet-ops/${path}`, { body });

  if (error) {
    if (error.context) {
      let parsedBody = null;
      try {
        parsedBody = await error.context.json();
      } catch (_parseError) {
        // Response body could not be parsed as JSON at all (e.g. a raw
        // HTML/text error page from an intermediate proxy on a 500/502/
        // 503/504) — unknown outcome, always retryable.
        return {
          ok: false,
          error: { code: "WALLET_OPS_REQUEST_FAILED", message: "請求失敗，請稍後再試一次。", retryable: true }
        };
      }

      const serverError = parsedBody && typeof parsedBody === "object" ? parsedBody.error : null;

      if (serverError && typeof serverError === "object") {
        // Respect the server's own explicit determination when present;
        // otherwise this is an unrecognized error shape — default to
        // retryable (never assume "safe to give up" on a guess).
        const retryable = typeof serverError.retryable === "boolean" ? serverError.retryable : true;
        return { ok: false, error: { ...serverError, retryable } };
      }

      // A JSON body came back, but not our own `{ok:false,error:{...}}`
      // shape (e.g. an empty object, or some other service's error
      // format) — unknown outcome, always retryable.
      return {
        ok: false,
        error: { code: "WALLET_OPS_REQUEST_FAILED", message: "請求失敗，請稍後再試一次。", retryable: true }
      };
    }

    // No HTTP response was ever received at all (FunctionsFetchError /
    // network disconnect / DNS / timeout before headers) — always
    // retryable.
    return {
      ok: false,
      error: { code: "NETWORK_ERROR", message: "網路連線失敗，請稍後再試一次。", retryable: true }
    };
  }

  return data;
}

async function resolveAuthUserContext() {
  if (!window.userReadyPromise && window.UserStore?.initUser) {
    window.userReadyPromise = window.UserStore.initUser();
  }

  const user = window.userReadyPromise
    ? await window.userReadyPromise
    : null;

  let userId = String(user?.user_id || "").trim();

  if (!userId && window.ClawUser?.getUserId) {
    userId = String(await window.ClawUser.getUserId() || "").trim();
  }

  if (!userId) {
    throw new Error("找不到 auth userId");
  }

  return {
    userId,
    nickname: String(user?.nickname || "").trim()
  };
}

window.Api = {
  async getUser(userId) {
    const { data, error } = await getSupabaseClient()
      .from(DB.users)
      .select("user_id,nickname,points,tickets,coins")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;

    return data;
  },

  async createUserIfNotExists({ userId, nickname = "" }) {
    // P-AUTH-05B-2A: `userId` is intentionally IGNORED here and NEVER sent
    // in the request body — the Edge Function derives the owner id SOLELY
    // from the caller's own verified JWT (requirement 2). Kept as a
    // parameter only so existing call sites (js/user.js) don't need to
    // change their call shape.
    const result = await invokeWalletOpsFunction("ensure-user", { nickname });

    if (!result?.ok) {
      throw new Error(result?.error?.message || "無法建立使用者資料");
    }

    return result.data;
  },

  // P-AUTH-05B-2A hotfix (requirement 3): DEPRECATED. There is no longer
  // any public route to upsert a mascot standalone — `user_mascots` may
  // ONLY be written from inside an authorized backend transaction
  // (`claim_gacha_draw`'s internal call to `upsert_user_mascot_obtain`).
  // This stub exists ONLY so any stale caller gets an honest, loud
  // rejection instead of silently doing nothing or (worse) falling back to
  // an insecure direct database write — it never calls the network, never
  // touches the database, and always throws.
  async upsertUserMascot() {
    throw new Error("Api.upsertUserMascot() 已停用：吉祥物只能由抽獎等經授權的伺服器交易內部寫入，不提供独立的公開 API。");
  },

async getUserMascots(userId) {
  const { data, error } = await getSupabaseClient()
    .from("user_mascots")
    .select("*")
    .eq("user_id", userId)
    .order("first_obtained_at", { ascending: false });

  if (error) throw error;
  return data || [];
},
  async getGiftList() {
    console.log("[gift] DB.gifts =", DB.gifts);

    const { data, error } = await getSupabaseClient()
      .from(DB.gifts)
      .select("*")
      .eq("enabled", true)
      .gt("stock", 0)
      .order("sort_order", { ascending: true });

    console.log("[gift] getGifts data =", data);
    console.log("[gift] getGifts error =", error);
    console.log("[gift] getGifts length =", data?.length);

    if (error) throw error;

    return data || [];
  },

  async getMascots() {
  const { data, error } = await getSupabaseClient()
    .from("mascots")
    .select("*")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  console.log("[gallery] getAllMascots data =", data);
  console.log("[gallery] getAllMascots error =", error);
  console.log("[gallery] getAllMascots length =", data?.length);

  if (error) throw error;
  return data || [];
},

  async getGiftById(giftId) {
    const { data, error } = await getSupabaseClient()
      .from(DB.gifts)
      .select("*")
      .eq("id", giftId)
      .maybeSingle();

    if (error) throw error;

    return data;
  },

  // P-AUTH-05B-2A hotfix (requirement 2): DEPRECATED. There is no longer
  // any public route accepting arbitrary pointsDelta/ticketsDelta/
  // coinsDelta from the browser — every reward is now its own explicit,
  // server-defined operation (claimGachaDraw/redeemGift below; the "watch
  // ad" reward is PAUSED entirely, see js/game/ad-reward.js and
  // requirement 4). This stub exists ONLY so any stale caller gets an
  // honest, loud rejection instead of silently doing nothing or (worse)
  // falling back to an insecure direct database write — it never calls
  // the network, never touches the database, and always throws.
  async adjustBalance() {
    throw new Error("Api.adjustBalance() 已停用：不再提供任意餘額調整能力，請改用對應的專用操作 API。");
  },

  async getRedeemHistory(userId) {
  const authUser = await resolveAuthUserContext();

  const { data, error } = await getSupabaseClient()
    .from(DB.redeemHistory)
    .select("*")
    .eq("user_id", authUser.userId)
    .order("created_at", { ascending: false });

  console.log("[gift] redeem history data =", data);
  console.log("[gift] redeem history error =", error);
  console.log("[gift] redeem history length =", data?.length);

  if (error) throw error;

  return data || [];
 },

  // P-AUTH-05B-2A hotfix (requirement 1): atomic, secure Gacha Draw — the
  // request sends ONLY `idempotencyKey`. The RPC (`claim_gacha_draw`)
  // decides which mascot/rarity was drawn using its OWN server-side
  // weighted random pick against `public.mascot_rarities`/`public.mascots`
  // — there is no `mascotId`/reward/points/tickets parameter for the
  // caller to supply or tamper with; the frontend's job is only to render
  // whichever result this call returns.
  //
  // P-AUTH-05B-2A hotfix (requirement 5): `idempotencyKey` is REQUIRED and
  // must be generated ONCE by the caller when the draw attempt begins
  // (e.g. js/pages/gacha.js's `getOrCreateDrawIdempotencyKey()`), reused
  // verbatim on a retry of that SAME attempt — this function deliberately
  // does NOT generate one itself, so it can never silently mint a fresh key
  // per call.
  async claimGachaDraw({ idempotencyKey } = {}) {
    if (!idempotencyKey) {
      throw new Error("claimGachaDraw 需要呼叫端提供 idempotencyKey（操作開始時產生一次，重試時沿用同一個）。");
    }

    const result = await invokeWalletOpsFunction("gacha-draw", { idempotencyKey });

    if (!result?.ok) {
      const error = new Error(result?.error?.message || "抽卡失敗");
      error.retryable = Boolean(result?.error?.retryable);
      throw error;
    }

    return result.data;
  },

  // P-AUTH-05B-2A: atomic, secure Gift Redemption \u2014 replaces the old
  // "adjustBalance() + addRedeemHistory() + decreaseGiftStock()" three-step
  // (non-atomic, no row locking, and trusted CLIENT-SUPPLIED cost/name
  // values \u2014 a malicious caller could previously redeem ANY item for
  // FREE by just sending pointsCost:0/ticketsCost:0/coinsCost:0) with ONE
  // call to `redeem_gift_transaction` (locks users+gifts, verifies
  // balance/stock, deducts, decrements stock, writes redeem_history \u2014
  // all in a single DB transaction; cost/name are ALWAYS resolved
  // server-side from `gifts`, never from this call's arguments).
  // `pointsCost`/`ticketsCost`/`coinsCost`/`giftName`/`nickname` are kept
  // as parameters ONLY for call-site signature compatibility \u2014 none of
  // them are sent to the server anymore.
  //
  // P-AUTH-05B-2A hotfix (requirement 5): `idempotencyKey` is REQUIRED and
  // must be generated ONCE by the caller when the redemption attempt
  // begins (e.g. js/gift.js's `handleRedeem()`), reused verbatim on a retry
  // of that SAME attempt — this function deliberately does NOT generate
  // one itself.
  async redeemGift({ userId, nickname, giftId, giftName, pointsCost, ticketsCost, coinsCost, note, idempotencyKey }) {
    if (!idempotencyKey) {
      throw new Error("redeemGift 需要呼叫端提供 idempotencyKey（操作開始時產生一次，重試時沿用同一個）。");
    }

    const result = await invokeWalletOpsFunction("gift-redeem", { giftId, idempotencyKey });

    if (!result?.ok) {
      const error = new Error(result?.error?.message || "兌換失敗");
      error.retryable = Boolean(result?.error?.retryable);
      throw error;
    }

    const data = result.data || {};

    return {
      ok: true,
      user: {
        points: data.user_points,
        tickets: data.user_tickets,
        coins: data.user_coins
      },
      redeemRecord: {
        id: data.redeem_history_id,
        gift_id: data.gift_id,
        gift_name: data.gift_name,
        points_cost: data.points_cost,
        tickets_cost: data.tickets_cost,
        coins_cost: data.coins_cost
      }
    };
  }
};

