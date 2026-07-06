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

  function getUserProfile() {
    return window.UserStore?.getUserProfile
      ? window.UserStore.getUserProfile()
      : { userId: "", nickname: "" };
  }

  async function getProducts() {
    const { data, error } = await getSupabaseClient()
      .from(DB.products)
      .select("*")
      .eq("enabled", true)
      .order("sort_order", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async function getProduct(productId) {
    const { data, error } = await getSupabaseClient()
      .from(DB.products)
      .select("*")
      .eq("id", productId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function checkProductUnlocked(product) {
    const profile = getUserProfile();

    if (!product?.required_mascot_id) {
      return true;
    }

    const { data, error } = await getSupabaseClient()
      .from(DB.userMascots)
      .select("mascot_id, obtain_count")
      .eq("user_id", profile.userId)
      .eq("mascot_id", product.required_mascot_id)
      .maybeSingle();

    if (error) throw error;

    const requiredCount = Number(product.required_mascot_count || 1);
    return Number(data?.obtain_count || 0) >= requiredCount;
  }

  async function addToCart(productId, quantity = 1) {
    const profile = getUserProfile();

    if (!profile.userId) {
      throw new Error("找不到 userId");
    }

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
      .eq("user_id", profile.userId)
      .eq("product_id", productId)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      const nextQuantity =
        Number(existing.quantity || 0) + Number(quantity || 1);

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
        user_id: profile.userId,
        product_id: productId,
        quantity: Number(quantity || 1),
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
    const profile = getUserProfile();

    if (!profile.userId) {
      throw new Error("找不到 userId");
    }

    const { data, error } = await getSupabaseClient()
      .from(DB.cart)
      .select(`
        *,
        product:shop_products(*)
      `)
      .eq("user_id", profile.userId)
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
    const profile = getUserProfile();

    if (!profile.userId) {
      throw new Error("找不到 userId");
    }

    const { error } = await getSupabaseClient()
      .from(DB.cart)
      .delete()
      .eq("user_id", profile.userId);

    if (error) throw error;
    return true;
  }

  window.ShopApi = {
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
