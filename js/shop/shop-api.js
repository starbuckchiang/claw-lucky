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

  async function addToCart(productId, quantity = 1) {
    if (!window.userReadyPromise && window.UserStore?.initUser) {
      window.userReadyPromise = window.UserStore.initUser();
    }

    const user = window.userReadyPromise
      ? await window.userReadyPromise
      : null;
    const userId = String(user?.user_id || "").trim();

    if (!userId) {
      throw new Error("找不到 auth userId");
    }

    const { data: sessionData, error: sessionError } = await getSupabaseClient().auth.getSession();
    if (sessionError) {
      throw sessionError;
    }

    const sessionUserId = String(sessionData?.session?.user?.id || "").trim();
    if (!sessionUserId || sessionUserId !== userId) {
      throw new Error("auth userId 與 session.user.id 不一致");
    }

    console.log("[shop cart] auth userId =", userId);
    console.log("[shop cart] productId =", productId);

    const product = await getProduct(productId);

    if (!product) {
      throw new Error("找不到商品");
    }

    if (!product.enabled) {
      throw new Error("商品尚未上架");
    }

    if (Number(product.stock || 0) <= 0) {
      throw new Error("商品已售完");
    }

    const unlocked = await checkProductUnlocked(product);

    if (!unlocked) {
      throw new Error("尚未解鎖此商品購買資格");
    }

    const { data: existing, error: findError } = await getSupabaseClient()
      .from(DB.cart)
      .select("*")
      .eq("user_id", userId)
      .eq("product_id", productId)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      const nextQuantity =
        Number(existing.quantity || 0) + 1;

      if (nextQuantity > Number(product.stock || 0)) {
        throw new Error("加入數量超過庫存");
      }

      const { data, error } = await getSupabaseClient()
        .from(DB.cart)
        .update({
          quantity: nextQuantity,
          selected: true,
          unlock_verified: true,
          updated_at: new Date().toISOString()
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    }

    const { data, error } = await getSupabaseClient()
      .from(DB.cart)
      .insert({
        user_id: userId,
        product_id: productId,
        quantity: 1,
        selected: true,
        unlock_verified: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return data;
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

  async function updateCartItem(cartId, updates = {}) {
    const payload = {
      updated_at: new Date().toISOString()
    };

    if (typeof updates.quantity !== "undefined") {
      payload.quantity = Math.max(1, Number(updates.quantity || 1));
    }

    if (typeof updates.selected !== "undefined") {
      payload.selected = Boolean(updates.selected);
    }

    const { data, error } = await getSupabaseClient()
      .from(DB.cart)
      .update(payload)
      .eq("id", cartId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async function removeCartItem(cartId) {
    const { error } = await getSupabaseClient()
      .from(DB.cart)
      .delete()
      .eq("id", cartId);

    if (error) throw error;
    return true;
  }

  async function clearCart() {
    const userId = await getCurrentUserId();

    const { error } = await getSupabaseClient()
      .from(DB.cart)
      .delete()
      .eq("user_id", userId);

    if (error) throw error;
    return true;
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
    clearCart
  };
})();
