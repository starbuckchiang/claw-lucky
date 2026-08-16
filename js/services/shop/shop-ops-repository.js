"use strict";

/**
 * Shop Ops Repository (P-AUTH-05B-2B)
 *
 * Thin wrapper around the SECURITY DEFINER RPCs added by
 * `20260817000400_shop_cart_checkout_secure_rpc.sql`
 * (`add_cart_item`/`update_cart_item_quantity`/`remove_cart_item`/
 * `clear_cart`/`checkout_cart`). Server-side / Edge-Function-only (no
 * `window.X =` export, matching `wallet-ops-repository.js`'s convention)
 * — all five RPCs are granted EXECUTE to `service_role` ONLY, so
 * `supabaseClient` here MUST be a service-role client
 * (`createServiceClient()` in supabase/functions/_shared/supabase-clients.ts),
 * never the anon-key client used to verify the caller's own JWT.
 *
 * This module does no validation/business logic itself (that lives in
 * shop-ops-handler.js) — it only translates a plain JS call into the exact
 * RPC parameter names the SQL functions expect, and normalizes a Supabase
 * `{ data, error }` result into either a return value or a thrown error.
 */

function createShopOpsRepositoryFromSupabaseClient({ supabaseClient }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
    throw new Error("createShopOpsRepositoryFromSupabaseClient requires a supabaseClient with rpc().");
  }

  return {
    // No price/name/owner parameter exists here — the RPC re-reads
    // price/stock/enabled/unlock-eligibility from shop_products/
    // user_mascots itself.
    async addCartItem({ userId, productId, quantity }) {
      const { data, error } = await supabaseClient.rpc("add_cart_item", {
        p_user_id: userId,
        p_product_id: productId,
        p_quantity: quantity
      });

      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async updateCartItemQuantity({ userId, cartId, quantity }) {
      const { data, error } = await supabaseClient.rpc("update_cart_item_quantity", {
        p_user_id: userId,
        p_cart_id: cartId,
        p_quantity: quantity
      });

      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    // Deliberately tolerant: returns `false` for "already removed"/"never
    // existed"/"belongs to someone else" rather than throwing (see the
    // migration's header for the rationale).
    async removeCartItem({ userId, cartId }) {
      const { data, error } = await supabaseClient.rpc("remove_cart_item", {
        p_user_id: userId,
        p_cart_id: cartId
      });

      if (error) throw error;
      return Boolean(Array.isArray(data) ? data[0] : data);
    },

    async clearCart({ userId }) {
      const { data, error } = await supabaseClient.rpc("clear_cart", {
        p_user_id: userId
      });

      if (error) throw error;
      return Number(Array.isArray(data) ? data[0] : data) || 0;
    },

    // Atomic Checkout: locks the caller's own cart + referenced product
    // rows, re-verifies price/stock/enabled from those locked rows,
    // computes subtotal/total server-side, creates orders + order_items,
    // decrements stock, clears the cart — all in one RPC transaction.
    // `idempotencyKey` MUST be fresh per logical checkout INTENT (created
    // once by the caller when Checkout begins), reused verbatim on a retry
    // of that SAME intent — this repository never generates one itself.
    async checkoutCart({ userId, idempotencyKey }) {
      const { data, error } = await supabaseClient.rpc("checkout_cart", {
        p_user_id: userId,
        p_idempotency_key: idempotencyKey
      });

      if (error) throw error;
      return data;
    }
  };
}

module.exports = { createShopOpsRepositoryFromSupabaseClient };
