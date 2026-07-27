// ESM port of `js/services/shopkeeper/shopkeeper-fallback-context.js`.
// Logic unchanged.

export const FALLBACK_VERSION = "shopkeeper-fallback-v1";

export interface ShopkeeperContext {
  luckyTheme: string;
  blessing: string;
  story: string;
  oneLiner: string;
  shopkeeperMessage: string;
  version: string;
  source: "ai" | "fallback";
}

export function createFallbackShopkeeperContext(): ShopkeeperContext {
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
