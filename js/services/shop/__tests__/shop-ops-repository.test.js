"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createShopOpsRepositoryFromSupabaseClient } = require("../shop-ops-repository");

function createFakeSupabaseClient({ rpcResults = {} } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(fnName, params) {
      calls.push({ fnName, params });
      const configured = rpcResults[fnName];
      if (configured?.error) {
        return { data: null, error: configured.error };
      }
      return { data: configured?.data ?? null, error: null };
    }
  };
}

test("createShopOpsRepositoryFromSupabaseClient requires a supabaseClient with rpc()", () => {
  assert.throws(() => createShopOpsRepositoryFromSupabaseClient({ supabaseClient: {} }));
  assert.throws(() => createShopOpsRepositoryFromSupabaseClient({}));
});

test("addCartItem: calls add_cart_item with EXACTLY 3 params — no price/name/owner input channel exists", async () => {
  const supabaseClient = createFakeSupabaseClient({
    rpcResults: { add_cart_item: { data: { id: "c-1", user_id: "u-1", product_id: "p-1", quantity: 1 } } }
  });
  const repository = createShopOpsRepositoryFromSupabaseClient({ supabaseClient });

  const result = await repository.addCartItem({ userId: "u-1", productId: "p-1", quantity: 1 });

  assert.deepEqual(supabaseClient.calls[0].params, { p_user_id: "u-1", p_product_id: "p-1", p_quantity: 1 });
  assert.equal(Object.keys(supabaseClient.calls[0].params).length, 3);
  assert.equal(result.id, "c-1");
});

test("addCartItem: throws the raw Supabase error unchanged on failure", async () => {
  const supabaseClient = createFakeSupabaseClient({ rpcResults: { add_cart_item: { error: { message: "insufficient stock for product p-1" } } } });
  const repository = createShopOpsRepositoryFromSupabaseClient({ supabaseClient });

  await assert.rejects(
    () => repository.addCartItem({ userId: "u-1", productId: "p-1", quantity: 1 }),
    { message: "insufficient stock for product p-1" }
  );
});

test("updateCartItemQuantity: calls update_cart_item_quantity with EXACTLY 3 params", async () => {
  const supabaseClient = createFakeSupabaseClient({
    rpcResults: { update_cart_item_quantity: { data: { id: "c-1", quantity: 3 } } }
  });
  const repository = createShopOpsRepositoryFromSupabaseClient({ supabaseClient });

  const result = await repository.updateCartItemQuantity({ userId: "u-1", cartId: "c-1", quantity: 3 });

  assert.deepEqual(supabaseClient.calls[0].params, { p_user_id: "u-1", p_cart_id: "c-1", p_quantity: 3 });
  assert.equal(result.quantity, 3);
});

test("removeCartItem: calls remove_cart_item with EXACTLY 2 params and normalizes to boolean", async () => {
  const supabaseClient = createFakeSupabaseClient({ rpcResults: { remove_cart_item: { data: true } } });
  const repository = createShopOpsRepositoryFromSupabaseClient({ supabaseClient });

  const removed = await repository.removeCartItem({ userId: "u-1", cartId: "c-1" });

  assert.deepEqual(supabaseClient.calls[0].params, { p_user_id: "u-1", p_cart_id: "c-1" });
  assert.equal(removed, true);
});

test("clearCart: calls clear_cart with EXACTLY 1 param and normalizes to a number", async () => {
  const supabaseClient = createFakeSupabaseClient({ rpcResults: { clear_cart: { data: 3 } } });
  const repository = createShopOpsRepositoryFromSupabaseClient({ supabaseClient });

  const removedCount = await repository.clearCart({ userId: "u-1" });

  assert.deepEqual(supabaseClient.calls[0].params, { p_user_id: "u-1" });
  assert.equal(removedCount, 3);
});

test("checkoutCart: calls checkout_cart with EXACTLY 2 params — no price/subtotal/total/owner input channel exists", async () => {
  const supabaseClient = createFakeSupabaseClient({
    rpcResults: { checkout_cart: { data: { order_id: "o-1", total_amount: 500, status: "pending", items: [] } } }
  });
  const repository = createShopOpsRepositoryFromSupabaseClient({ supabaseClient });

  const result = await repository.checkoutCart({ userId: "u-1", idempotencyKey: "key-1" });

  assert.deepEqual(supabaseClient.calls[0].params, { p_user_id: "u-1", p_idempotency_key: "key-1" });
  assert.equal(Object.keys(supabaseClient.calls[0].params).length, 2);
  assert.equal(result.order_id, "o-1");
  assert.equal(result.status, "pending");
});

test("checkoutCart: throws the raw Supabase error unchanged on failure", async () => {
  const supabaseClient = createFakeSupabaseClient({ rpcResults: { checkout_cart: { error: { message: "cart is empty (user=u-1)" } } } });
  const repository = createShopOpsRepositoryFromSupabaseClient({ supabaseClient });

  await assert.rejects(
    () => repository.checkoutCart({ userId: "u-1", idempotencyKey: "key-1" }),
    { message: "cart is empty (user=u-1)" }
  );
});
