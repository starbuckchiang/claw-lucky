"use strict";

/**
 * Shopkeeper Fallback Context.
 *
 * Deterministic, pre-written Lucky Context used whenever the Shopkeeper
 * Context Agent's AI call fails or returns an invalid/incomplete result
 * (timeout, rate limit, provider failure, malformed JSON, missing
 * required field). MUST NEVER block wallpaper generation — the product
 * goal is "a wallpaper every day", not "no wallpaper because the
 * storyteller had a bad day".
 *
 * Every field here is a fixed, non-empty string — this function can never
 * return an incomplete context, by construction.
 */

const FALLBACK_VERSION = "shopkeeper-fallback-v1";

function createFallbackShopkeeperContext() {
  return {
    luckyTheme: "穩穩接住今天的好運",
    blessing: "今天每一次努力都會更靠近成功。",
    story: "今天的你，會被幸運悄悄眷顧，一路平穩前行。",
    oneLiner: "穩穩接住，今天的好運。",
    shopkeeperMessage: "嗨，今天我也為你準備了一份小小的幸運～",
    version: FALLBACK_VERSION,
    source: "fallback"
  };
}

module.exports = {
  FALLBACK_VERSION,
  createFallbackShopkeeperContext
};
