// ESM twin of `js/services/shop/shop-ops-repository.js`. Logic unchanged
// — see that file's header for the full rationale. Whenever business
// logic changes here, mirror the change in the `.js` twin (same function
// names, same RPC parameter names).

// deno-lint-ignore no-explicit-any
export function createShopOpsRepositoryFromSupabaseClient({ supabaseClient }: { supabaseClient: any }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
    throw new Error("createShopOpsRepositoryFromSupabaseClient requires a supabaseClient with rpc().");
  }

  return {
    async addCartItem({ userId, productId, quantity }: { userId: string; productId: string; quantity: number }) {
      const { data, error } = await supabaseClient.rpc("add_cart_item", {
        p_user_id: userId,
        p_product_id: productId,
        p_quantity: quantity,
      });

      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async updateCartItemQuantity(
      { userId, cartId, quantity }: { userId: string; cartId: string; quantity: number },
    ) {
      const { data, error } = await supabaseClient.rpc("update_cart_item_quantity", {
        p_user_id: userId,
        p_cart_id: cartId,
        p_quantity: quantity,
      });

      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async removeCartItem({ userId, cartId }: { userId: string; cartId: string }) {
      const { data, error } = await supabaseClient.rpc("remove_cart_item", {
        p_user_id: userId,
        p_cart_id: cartId,
      });

      if (error) throw error;
      return Boolean(Array.isArray(data) ? data[0] : data);
    },

    async clearCart({ userId }: { userId: string }) {
      const { data, error } = await supabaseClient.rpc("clear_cart", {
        p_user_id: userId,
      });

      if (error) throw error;
      return Number(Array.isArray(data) ? data[0] : data) || 0;
    },

    async checkoutCart({ userId, idempotencyKey }: { userId: string; idempotencyKey: string }) {
      const { data, error } = await supabaseClient.rpc("checkout_cart", {
        p_user_id: userId,
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;
      return data;
    },
  };
}
