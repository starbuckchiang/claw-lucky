/* ============================================================
   Lucky Shop API
   ------------------------------------------------------------
   負責：
   1. 商品列表 / 商品詳情
   2. 加入購物車
   3. 讀取購物車
   4. 更新購物車數量
   5. 刪除購物車商品
   6. 清空購物車
   ============================================================ */

(function () {
  const DB = {
    products: "shop_products",
    cart: "shop_cart",
    userMascots: "user_mascots"
  };

  function getSupabaseClient() {
    if (!window.supabaseClient) {
      throw new Error("Supabase 尚未初始化，請確認 config.js 載入順序");
    }

    return window.supabaseClient;
  }

  /**
   * P-AUTH-05B-2B: secure write adapter for the `shop-ops` Edge Function
   * (supabase/functions/shop-ops/index.ts). Replaces the OLD pattern of
   * writing directly to `shop_cart`/`orders`/`order_items` from the
   * browser with the anon key + a CLIENT-SUPPLIED owner id and
   * CLIENT-COMPUTED price/subtotal/total (see that function's header
   * comment, and `20260817000400_shop_cart_checkout_secure_rpc.sql`, for
   * the exact vulnerabilities this closes).
   *
   * Mirrors `js/api.js`'s `invokeWalletOpsFunction()` retry-safety
   * contract EXACTLY (same reasoning, copied here rather than shared,
   * matching this repo's existing convention of per-adapter-file
   * duplication — see wallet-ops-handler.js/account-merge-handler.js):
   * the ONLY case ever treated as non-retryable is a SUCCESSFULLY PARSED
   * `{ok:false, error:{...}}` JSON body whose `error.retryable` is
   * EXPLICITLY `false`. Every other outcome (no HTTP response at all, a
   * response that fails to parse as JSON, a parsed body without a
   * recognized `error` field, or a missing/non-boolean
   * `error.retryable`) defaults to `retryable: true` — never assume "safe
   * to give up" on an uncertain outcome.
   */
  async function invokeShopOpsFunction(path, body) {
    const { data, error } = await getSupabaseClient().functions.invoke(`shop-ops/${path}`, { body });

    if (error) {
      if (error.context) {
        let parsedBody = null;
        try {
          parsedBody = await error.context.json();
        } catch (_parseError) {
          return {
            ok: false,
            error: { code: "SHOP_OPS_REQUEST_FAILED", message: "請求失敗，請稍後再試一次。", retryable: true }
          };
        }

        const serverError = parsedBody && typeof parsedBody === "object" ? parsedBody.error : null;

        if (serverError && typeof serverError === "object") {
          const retryable = typeof serverError.retryable === "boolean" ? serverError.retryable : true;
          return { ok: false, error: { ...serverError, retryable } };
        }

        return {
          ok: false,
          error: { code: "SHOP_OPS_REQUEST_FAILED", message: "請求失敗，請稍後再試一次。", retryable: true }
        };
      }

      return {
        ok: false,
        error: { code: "NETWORK_ERROR", message: "網路連線失敗，請稍後再試一次。", retryable: true }
      };
    }

    return data;
  }

  async function getCurrentUserId() {
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
      throw new Error("找不到 userId");
    }

    return userId;
  }

  function resolveAssetPath(value) {
    if (!value || typeof value !== "string") {
      return "";
    }

    const trimmed = value.trim();

    if (!trimmed) {
      return "";
    }

    if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("data:")) {
      return trimmed;
    }

    if (trimmed.startsWith("/")) {
      return trimmed;
    }

    if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
      return trimmed;
    }

    return `./${trimmed}`;
  }

  function normalizeProduct(product) {
    if (!product || typeof product !== "object") {
      return null;
    }

    const imageValue = product.thumbnail || product.image || product.cover || product.image_url || "";

    return {
      ...product,
      id: String(product.id ?? ""),
      name: String(product.name || product.title || "未命名商品"),
      subtitle: String(product.subtitle || product.description || ""),
      description: String(product.description || product.subtitle || ""),
      badge: String(product.badge || product.tag || "LIMITED"),
      price: Number(product.price ?? 0),
      stock: Number(product.stock ?? 0),
      enabled: Boolean(product.enabled !== false),
      required_mascot_id: product.required_mascot_id || "",
      required_mascot_count: Number(product.required_mascot_count || 1),
      sort_order: Number(product.sort_order || 0),
      thumbnail: resolveAssetPath(imageValue),
      image: resolveAssetPath(imageValue),
      cover: resolveAssetPath(imageValue)
    };
  }

  async function getProducts() {
    console.log("[shop-api] getProducts started");
    const { data, error } = await getSupabaseClient()
      .from(DB.products)
      .select("*")
      .eq("enabled", true)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    console.log("[shop-api] getProducts raw data =", data);
    console.log("[shop-api] getProducts raw length =", Array.isArray(data) ? data.length : "not-array");

    const products = (data || [])
      .map(normalizeProduct)
      .filter(Boolean);

    console.log("[shop-api] getProducts normalized length =", products.length);
    return products;
  }

  async function getProduct(productId) {
    const normalizedProductId = String(productId ?? "").trim();

    if (!normalizedProductId) {
      return null;
    }

    const { data, error } = await getSupabaseClient()
      .from(DB.products)
      .select("*")
      .eq("id", normalizedProductId)
      .maybeSingle();

    if (error) throw error;
    return normalizeProduct(data);
  }

  async function checkProductUnlocked(product) {
    const userId = await getCurrentUserId();

    if (!product?.required_mascot_id) {
      return true;
    }

    const { data, error } = await getSupabaseClient()
      .from(DB.userMascots)
      .select("mascot_id, obtain_count")
      .eq("user_id", userId)
      .eq("mascot_id", product.required_mascot_id)
      .maybeSingle();

    if (error) throw error;

    const requiredCount = Number(product.required_mascot_count || 1);
    return Number(data?.obtain_count || 0) >= requiredCount;
  }

  // P-AUTH-05B-2B: atomic, secure Add-to-Cart — replaces the OLD
  // "read product -> read existing cart row -> update/insert" three-step
  // BROWSER writes (no row locking, a client-supplied `userId`, and the
  // product/stock/unlock checks were only advisory since the final
  // insert/update never re-verified them at write time). The
  // `shop-ops/cart-add` Edge Function now re-verifies product existence/
  // enabled/stock/unlock-eligibility itself from locked rows — this
  // function sends ONLY `productId`/`quantity`; there is no price/name/
  // owner parameter to forge.
  async function addToCart(productId, quantity = 1) {
    const result = await invokeShopOpsFunction("cart-add", { productId, quantity });

    if (!result?.ok) {
      const error = new Error(result?.error?.message || "加入好運籃失敗");
      error.code = result?.error?.code;
      error.retryable = Boolean(result?.error?.retryable);
      throw error;
    }

    return result.data;
  }

  async function getCart() {
    const userId = await getCurrentUserId();

    const { data, error } = await getSupabaseClient()
      .from(DB.cart)
      .select(`
        *,
        product:shop_products(*)
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // P-AUTH-05B-2B: ownership + stock/enabled re-verified server-side by
  // `shop-ops/cart-update` — this function no longer touches `shop_cart`
  // directly (the OLD `.eq("id", cartId)` query had NO ownership check at
  // all).
  async function updateCartItem(cartId, updates = {}) {
    const quantity = typeof updates.quantity !== "undefined"
      ? Math.max(1, Math.min(99, Math.trunc(Number(updates.quantity || 1))))
      : 1;

    const result = await invokeShopOpsFunction("cart-update", { cartId, quantity });

    if (!result?.ok) {
      const error = new Error(result?.error?.message || "更新好運籃失敗");
      error.code = result?.error?.code;
      error.retryable = Boolean(result?.error?.retryable);
      throw error;
    }

    return result.data;
  }

  // P-AUTH-05B-2B: ownership re-verified server-side by
  // `shop-ops/cart-remove` — deliberately tolerant of "already removed" /
  // "not owned" (returns `removed:false` rather than throwing), matching
  // the RPC's idempotent-friendly semantics.
  async function removeCartItem(cartId) {
    const result = await invokeShopOpsFunction("cart-remove", { cartId });

    if (!result?.ok) {
      const error = new Error(result?.error?.message || "刪除好運籃商品失敗");
      error.code = result?.error?.code;
      error.retryable = Boolean(result?.error?.retryable);
      throw error;
    }

    return Boolean(result.data?.removed);
  }

  // P-AUTH-05B-2B: owner ALWAYS resolved server-side from the verified
  // JWT — no `userId` is sent in the request body at all.
  async function clearCart() {
    const result = await invokeShopOpsFunction("cart-clear", {});

    if (!result?.ok) {
      const error = new Error(result?.error?.message || "清空好運籃失敗");
      error.code = result?.error?.code;
      error.retryable = Boolean(result?.error?.retryable);
      throw error;
    }

    return true;
  }

  // P-AUTH-05B-2B: atomic, server-authoritative Checkout — replaces
  // js/shop/shop_cart.js's OLD three-step BROWSER writes (insert `orders`
  // with a CLIENT-COMPUTED total_amount/total_items -> insert
  // `order_items` with CLIENT-SUPPLIED price/subtotal/product snapshot ->
  // delete the cart), which trusted the browser's own `cartItems` array
  // for every price/total and had NO idempotency protection at all (a
  // lost response or double-click could create two orders). The
  // `shop-ops/checkout` Edge Function now does all of this in ONE DB
  // transaction, re-verifying price/stock/enabled from locked rows.
  //
  // `idempotencyKey` is REQUIRED and MUST be generated ONCE by the caller
  // when the checkout attempt begins (e.g. js/shop/shop_cart.js's
  // `getOrCreateCheckoutIdempotencyKey()`), reused verbatim on a retry of
  // that SAME attempt — this function deliberately does NOT generate one
  // itself, so a manual retry can never silently mint a fresh key.
  async function checkoutCart({ idempotencyKey } = {}) {
    if (!idempotencyKey) {
      throw new Error("checkoutCart 需要呼叫端提供 idempotencyKey（操作開始時產生一次，重試時沿用同一個）。");
    }

    const result = await invokeShopOpsFunction("checkout", { idempotencyKey });

    if (!result?.ok) {
      const error = new Error(result?.error?.message || "建立訂單失敗");
      error.code = result?.error?.code;
      error.retryable = Boolean(result?.error?.retryable);
      throw error;
    }

    return result.data;
  }

  window.ShopApi = {
    resolveAssetPath,
    normalizeProduct,
    getProducts,
    getProduct,
    checkProductUnlocked,
    addToCart,
    getCart,
    updateCartItem,
    removeCartItem,
    clearCart,
    checkoutCart
  };
})();

