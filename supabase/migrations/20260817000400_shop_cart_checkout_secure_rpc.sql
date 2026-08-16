-- P-AUTH-05B-2B: Cart & Orders Secure Atomic RPCs
--
-- Requirement (05B-2B): "將 Cart / Orders 的關鍵寫入改為 server-authoritative，
-- 防止使用者竄改 user_id、商品價格、數量、庫存、訂單總額或重送請求造成重複
-- 訂單。"
--
-- BACKGROUND: `20260816000000_core_user_tables_owner_rls.sql` already
-- locked down `shop_cart`/`orders`/`order_items` to owner-only SELECT and
-- denied ALL authenticated INSERT/UPDATE/DELETE (see that migration's
-- header, explicitly flagging "Order creation (Checkout) moves to an Edge
-- Function/RPC" and "the follow-up Edge Function/RPC replacing these call
-- sites MUST re-verify ownership itself" as required follow-up work). This
-- migration is that follow-up: it does NOT touch any existing RLS policy
-- (per this task's explicit constraint) — it only ADDS new SECURITY
-- DEFINER functions (granted to `service_role` ONLY, same as every prior
-- P-AUTH-05B-2A wallet-ops RPC) that the new `shop-ops` Edge Function
-- calls server-side, plus one new idempotency-ledger table for Checkout.
--
-- Today (`js/shop/shop-api.js` + `js/shop/shop_cart.js`, BROWSER anon-key
-- context, PRE-fix):
--   - `addToCart`/`updateCartItem`/`removeCartItem`/`clearCart` write
--     directly to `shop_cart` trusting a CLIENT-SUPPLIED `userId` (from
--     localStorage), with `updateCartItem`/`removeCartItem` doing
--     `.eq("id", cartId)` with **NO ownership check at all** in the query.
--   - `handleCheckout()` computes `total_amount`/`total_items` in the
--     BROWSER from whatever product prices happen to be in its own local
--     `cartItems` array (which itself came from an earlier, now
--     possibly-stale read), inserts `orders` and `order_items` directly
--     (the `order_items.price`/`subtotal`/`product_name`/`product_image`
--     snapshot is 100% client-supplied), then deletes the cart — THREE
--     separate, non-atomic writes with no idempotency protection at all
--     (a lost response / double-click could create two orders from the
--     same cart).
--   - Stock is NEVER decremented anywhere in the current checkout flow.
--
-- This migration's five functions close all of this:
--   - `add_cart_item` / `update_cart_item_quantity` / `remove_cart_item` /
--     `clear_cart`: ownership ALWAYS resolved from `p_user_id` (which the
--     Edge Function derives SOLELY from the caller's verified JWT — never
--     the request body); product existence/enabled/stock/unlock-eligibility
--     are ALWAYS re-verified server-side from `shop_products`/
--     `user_mascots`, never trusted from any caller-supplied value (there
--     IS no price/name/owner parameter in any of these signatures at all).
--   - `checkout_cart`: ONE atomic transaction that locks the caller's own
--     cart rows + every referenced `shop_products` row, re-verifies
--     price/stock/enabled from those LOCKED rows, computes
--     subtotal/total_amount SERVER-SIDE, creates `orders` +
--     `order_items` (snapshot fields taken from the locked product rows,
--     never from the caller), decrements stock (never negative), clears
--     the cart, and records the result under `p_idempotency_key` — a
--     resend with the SAME key returns the IDENTICAL cached order,
--     re-executing NONE of the above. No payment integration exists yet,
--     so every order is created with `status = 'pending'` — this function
--     never claims a payment succeeded.
--
-- Idempotency table `shop_checkout_requests` mirrors
-- `gift_redemption_requests`'s exact pattern (UNIQUE idempotency_key,
-- looked up FIRST inside the function, cached row's `user_id` ALWAYS
-- compared against the caller before being returned — P-AUTH-05A.1
-- lesson). Cart add/update/remove/clear are NOT given idempotency keys:
-- there is no pre-existing client-side retry mechanism for them today (see
-- review-auth-05B-2B.md "Idempotency 設計" for the explicit reasoning), and
-- each of them is a plain ownership+validation operation whose own natural
-- semantics (remove/clear are already safe to repeat; add's "each explicit
-- click adds one unit" semantics are unchanged from today's behavior).
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: additive-only (one new table, five new
-- functions); no existing table/column/row/policy is modified.
-- ROLLBACK (manual):
--   REVOKE EXECUTE ON FUNCTION public.checkout_cart(TEXT, TEXT) FROM service_role;
--   DROP FUNCTION IF EXISTS public.checkout_cart(TEXT, TEXT);
--   REVOKE EXECUTE ON FUNCTION public.clear_cart(TEXT) FROM service_role;
--   DROP FUNCTION IF EXISTS public.clear_cart(TEXT);
--   REVOKE EXECUTE ON FUNCTION public.remove_cart_item(TEXT, TEXT) FROM service_role;
--   DROP FUNCTION IF EXISTS public.remove_cart_item(TEXT, TEXT);
--   REVOKE EXECUTE ON FUNCTION public.update_cart_item_quantity(TEXT, TEXT, INTEGER) FROM service_role;
--   DROP FUNCTION IF EXISTS public.update_cart_item_quantity(TEXT, TEXT, INTEGER);
--   REVOKE EXECUTE ON FUNCTION public.add_cart_item(TEXT, TEXT, INTEGER) FROM service_role;
--   DROP FUNCTION IF EXISTS public.add_cart_item(TEXT, TEXT, INTEGER);
--   DROP TABLE IF EXISTS public.shop_checkout_requests;
-- NOT APPLIED by this task (P-AUTH-05B-2B requirement: no deployment
-- until real staging validation — see review-auth-05B-2B.md's 05C plan).

-- Column-type-agnostic by design (same convention as every prior P-AUTH-05B
-- migration in this repo — no live-schema introspection was available):
-- every comparison casts `::text` on both sides so this works whether
-- `shop_cart.id`/`shop_products.id`/`orders.id`/`user_id` are TEXT or a
-- native UUID column.

CREATE TABLE IF NOT EXISTS public.shop_checkout_requests (
    idempotency_key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_checkout_requests_user_created_at_desc
    ON public.shop_checkout_requests (user_id, created_at DESC);

ALTER TABLE IF EXISTS public.shop_checkout_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_shop_checkout_requests_select_owner ON public.shop_checkout_requests;
DROP POLICY IF EXISTS p_shop_checkout_requests_deny_write_authenticated ON public.shop_checkout_requests;

CREATE POLICY p_shop_checkout_requests_select_owner
    ON public.shop_checkout_requests
    FOR SELECT
    TO authenticated
    USING (user_id = public.request_user_key());

-- Written EXCLUSIVELY by checkout_cart() (SECURITY DEFINER,
-- service_role-only EXECUTE) below.
CREATE POLICY p_shop_checkout_requests_deny_write_authenticated
    ON public.shop_checkout_requests
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

-- --- add_cart_item ---
--
-- No price/name/owner parameter exists at all — `p_user_id` comes from the
-- Edge Function's verified JWT (never the request body); price/stock/
-- enabled/unlock-eligibility are ALWAYS re-read from `shop_products`/
-- `user_mascots` here, never accepted as input.
CREATE OR REPLACE FUNCTION public.add_cart_item(
    p_user_id TEXT,
    p_product_id TEXT,
    p_quantity INTEGER DEFAULT 1
) RETURNS public.shop_cart
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_product RECORD;
    v_existing public.shop_cart;
    v_row public.shop_cart;
    v_next_quantity INTEGER;
    v_unlocked_count INTEGER;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'add_cart_item: p_user_id is required';
    END IF;

    IF p_product_id IS NULL OR btrim(p_product_id) = '' THEN
        RAISE EXCEPTION 'add_cart_item: p_product_id is required';
    END IF;

    IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 99 THEN
        RAISE EXCEPTION 'add_cart_item: invalid quantity (must be an integer between 1 and 99)';
    END IF;

    SELECT id, name, price, stock, enabled, required_mascot_id, required_mascot_count
      INTO v_product
      FROM public.shop_products
     WHERE id::text = p_product_id
       FOR UPDATE;

    IF NOT FOUND OR v_product.enabled IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'add_cart_item: product % not found or not enabled', p_product_id;
    END IF;

    IF v_product.required_mascot_id IS NOT NULL AND btrim(v_product.required_mascot_id::text) <> '' THEN
        SELECT COALESCE(obtain_count, 0) INTO v_unlocked_count
          FROM public.user_mascots
         WHERE user_id::text = p_user_id
           AND mascot_id::text = v_product.required_mascot_id::text;

        IF NOT FOUND OR COALESCE(v_unlocked_count, 0) < COALESCE(v_product.required_mascot_count, 1) THEN
            RAISE EXCEPTION 'add_cart_item: required mascot not unlocked for product %', p_product_id;
        END IF;
    END IF;

    SELECT * INTO v_existing
      FROM public.shop_cart
     WHERE user_id::text = p_user_id
       AND product_id::text = p_product_id
       FOR UPDATE;

    IF FOUND THEN
        v_next_quantity := COALESCE(v_existing.quantity, 0) + p_quantity;

        IF v_next_quantity > COALESCE(v_product.stock, 0) THEN
            RAISE EXCEPTION 'add_cart_item: insufficient stock for product %', p_product_id;
        END IF;

        UPDATE public.shop_cart
           SET quantity = v_next_quantity,
               selected = true,
               unlock_verified = true,
               updated_at = NOW()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;

        RETURN v_row;
    END IF;

    IF p_quantity > COALESCE(v_product.stock, 0) THEN
        RAISE EXCEPTION 'add_cart_item: insufficient stock for product %', p_product_id;
    END IF;

    INSERT INTO public.shop_cart (
        user_id, product_id, quantity, selected, unlock_verified, created_at, updated_at
    ) VALUES (
        p_user_id, p_product_id, p_quantity, true, true, NOW(), NOW()
    ) RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.add_cart_item(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_cart_item(TEXT, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.add_cart_item(TEXT, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.add_cart_item(TEXT, TEXT, INTEGER) TO service_role;

-- --- update_cart_item_quantity ---
--
-- Ownership is enforced by the initial `SELECT ... FOR UPDATE` matching
-- BOTH `id` AND `user_id` in the same WHERE clause — a cart row belonging
-- to a different user is indistinguishable from "not found" (never
-- leaked), matching the account-merge "collapse to one generic outcome"
-- convention used throughout this repo.
CREATE OR REPLACE FUNCTION public.update_cart_item_quantity(
    p_user_id TEXT,
    p_cart_id TEXT,
    p_quantity INTEGER
) RETURNS public.shop_cart
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cart_row public.shop_cart;
    v_product RECORD;
    v_row public.shop_cart;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'update_cart_item_quantity: p_user_id is required';
    END IF;

    IF p_cart_id IS NULL OR btrim(p_cart_id) = '' THEN
        RAISE EXCEPTION 'update_cart_item_quantity: p_cart_id is required';
    END IF;

    IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 99 THEN
        RAISE EXCEPTION 'update_cart_item_quantity: invalid quantity (must be an integer between 1 and 99)';
    END IF;

    SELECT * INTO v_cart_row
      FROM public.shop_cart
     WHERE id::text = p_cart_id
       AND user_id::text = p_user_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'update_cart_item_quantity: cart item % not found', p_cart_id;
    END IF;

    SELECT id, stock, enabled INTO v_product
      FROM public.shop_products
     WHERE id::text = v_cart_row.product_id::text
       FOR UPDATE;

    IF NOT FOUND OR v_product.enabled IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'update_cart_item_quantity: product % not found or not enabled', v_cart_row.product_id;
    END IF;

    IF p_quantity > COALESCE(v_product.stock, 0) THEN
        RAISE EXCEPTION 'update_cart_item_quantity: insufficient stock for product %', v_cart_row.product_id;
    END IF;

    UPDATE public.shop_cart
       SET quantity = p_quantity,
           updated_at = NOW()
     WHERE id = v_cart_row.id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_cart_item_quantity(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_cart_item_quantity(TEXT, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.update_cart_item_quantity(TEXT, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_cart_item_quantity(TEXT, TEXT, INTEGER) TO service_role;

-- --- remove_cart_item ---
--
-- Deliberately tolerant of "already removed" / "never existed" / "belongs
-- to someone else" — all three collapse to `removed = false` rather than
-- an exception, since removal is a naturally idempotent, safe-to-repeat
-- operation (a lost response + retry must not surface as an error).
CREATE OR REPLACE FUNCTION public.remove_cart_item(
    p_user_id TEXT,
    p_cart_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deleted_id TEXT;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'remove_cart_item: p_user_id is required';
    END IF;

    IF p_cart_id IS NULL OR btrim(p_cart_id) = '' THEN
        RAISE EXCEPTION 'remove_cart_item: p_cart_id is required';
    END IF;

    DELETE FROM public.shop_cart
     WHERE id::text = p_cart_id
       AND user_id::text = p_user_id
    RETURNING id::text INTO v_deleted_id;

    RETURN v_deleted_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_cart_item(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_cart_item(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.remove_cart_item(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.remove_cart_item(TEXT, TEXT) TO service_role;

-- --- clear_cart ---
CREATE OR REPLACE FUNCTION public.clear_cart(
    p_user_id TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'clear_cart: p_user_id is required';
    END IF;

    DELETE FROM public.shop_cart WHERE user_id::text = p_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_cart(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_cart(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.clear_cart(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.clear_cart(TEXT) TO service_role;

-- --- checkout_cart ---
--
-- ONE atomic, server-authoritative Checkout transaction. `p_user_id` is
-- the ONLY identity input (from the Edge Function's verified JWT); there
-- is NO price/subtotal/total/product-name/product-image/owner parameter
-- anywhere in this signature — every one of those fields is derived
-- EXCLUSIVELY from the LOCKED `shop_products`/`shop_cart` rows read inside
-- this function. No payment integration exists yet, so every order this
-- function creates is `status = 'pending'` — it never claims a payment
-- succeeded.
--
-- Idempotency (P-AUTH-05A.1 lesson, same as every prior wallet-ops RPC):
-- the cache lookup happens FIRST, but the returned cached row's `user_id`
-- is ALWAYS compared against `p_user_id` before anything is returned — a
-- resend by a DIFFERENT user of a leaked/guessed key is rejected, never
-- silently handed someone else's order.
CREATE OR REPLACE FUNCTION public.checkout_cart(
    p_user_id TEXT,
    p_idempotency_key TEXT
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cached public.shop_checkout_requests;
    v_cached_result jsonb;
    v_cart_row RECORD;
    v_product RECORD;
    v_order public.orders;
    v_total_amount NUMERIC := 0;
    v_total_items INTEGER := 0;
    v_items jsonb := '[]'::jsonb;
    v_unit_price NUMERIC;
    v_subtotal NUMERIC;
    v_has_cart_rows BOOLEAN;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'checkout_cart: p_user_id is required';
    END IF;

    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'checkout_cart: p_idempotency_key is required';
    END IF;

    -- Idempotency lookup FIRST (before any lock/mutation of cart/product
    -- rows), but STILL identity-checked before returning anything.
    SELECT * INTO v_cached
      FROM public.shop_checkout_requests
     WHERE idempotency_key = p_idempotency_key
       FOR UPDATE;

    IF FOUND THEN
        IF v_cached.user_id <> p_user_id THEN
            RAISE EXCEPTION 'checkout_cart: idempotency key does not belong to this user';
        END IF;

        SELECT jsonb_build_object(
                   'order_id', o.id,
                   'order_no', o.order_no,
                   'total_amount', o.total_amount,
                   'total_items', o.total_items,
                   'status', o.status,
                   'created_at', o.created_at,
                   'items', COALESCE(jsonb_agg(jsonb_build_object(
                       'product_id', oi.product_id,
                       'product_name', oi.product_name,
                       'product_image', oi.product_image,
                       'price', oi.price,
                       'quantity', oi.quantity,
                       'subtotal', oi.subtotal
                   )) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb)
               )
          INTO v_cached_result
          FROM public.orders o
          LEFT JOIN public.order_items oi ON oi.order_id::text = o.id::text
         WHERE o.id::text = v_cached.order_id
         GROUP BY o.id, o.order_no, o.total_amount, o.total_items, o.status, o.created_at;

        IF v_cached_result IS NULL THEN
            -- A consumed idempotency marker with no matching order is a
            -- data-inconsistency, not a normal "not found" — reject
            -- loudly rather than silently re-running the checkout.
            RAISE EXCEPTION 'checkout_cart: cached order % missing for idempotency key', v_cached.order_id;
        END IF;

        RETURN v_cached_result;
    END IF;

    -- Lock every one of the caller's own cart rows for the rest of this
    -- transaction (blocks a concurrent add/update/remove/checkout on the
    -- SAME rows until this transaction commits or rolls back).
    SELECT EXISTS (SELECT 1 FROM public.shop_cart WHERE user_id::text = p_user_id FOR UPDATE)
      INTO v_has_cart_rows;

    IF NOT v_has_cart_rows THEN
        RAISE EXCEPTION 'checkout_cart: cart is empty (user=%)', p_user_id;
    END IF;

    FOR v_cart_row IN
        SELECT * FROM public.shop_cart WHERE user_id::text = p_user_id ORDER BY created_at ASC
    LOOP
        SELECT id, name, price, stock, enabled, thumbnail, image
          INTO v_product
          FROM public.shop_products
         WHERE id::text = v_cart_row.product_id::text
           FOR UPDATE;

        IF NOT FOUND OR v_product.enabled IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'checkout_cart: product % not found or not enabled', v_cart_row.product_id;
        END IF;

        IF COALESCE(v_cart_row.quantity, 0) <= 0 THEN
            RAISE EXCEPTION 'checkout_cart: invalid quantity for product %', v_cart_row.product_id;
        END IF;

        IF COALESCE(v_product.stock, 0) < v_cart_row.quantity THEN
            RAISE EXCEPTION 'checkout_cart: insufficient stock for product %', v_cart_row.product_id;
        END IF;

        v_unit_price := COALESCE(v_product.price, 0);
        v_subtotal := ROUND(v_unit_price * v_cart_row.quantity, 2);
        v_total_amount := v_total_amount + v_subtotal;
        v_total_items := v_total_items + v_cart_row.quantity;

        v_items := v_items || jsonb_build_object(
            'product_id', v_product.id,
            'product_name', v_product.name,
            'product_image', COALESCE(v_product.thumbnail, v_product.image, ''),
            'price', v_unit_price,
            'quantity', v_cart_row.quantity,
            'subtotal', v_subtotal
        );

        -- Stock decrement happens HERE, inside the same row lock, using
        -- the JUST-VALIDATED quantity — never goes negative because of
        -- the check immediately above, and any later failure in this loop
        -- (or the rest of the function) rolls this back too.
        UPDATE public.shop_products
           SET stock = stock - v_cart_row.quantity,
               updated_at = NOW()
         WHERE id::text = v_product.id::text;
    END LOOP;

    -- No payment integration exists yet — every order starts 'pending'.
    INSERT INTO public.orders (user_id, total_amount, total_items, status, created_at, updated_at)
    VALUES (p_user_id, v_total_amount, v_total_items, 'pending', NOW(), NOW())
    RETURNING * INTO v_order;

    INSERT INTO public.order_items (
        order_id, product_id, product_name, product_image, price, quantity, subtotal, created_at
    )
    SELECT
        v_order.id,
        elem->>'product_id',
        elem->>'product_name',
        elem->>'product_image',
        (elem->>'price')::numeric,
        (elem->>'quantity')::integer,
        (elem->>'subtotal')::numeric,
        NOW()
    FROM jsonb_array_elements(v_items) elem;

    DELETE FROM public.shop_cart WHERE user_id::text = p_user_id;

    INSERT INTO public.shop_checkout_requests (idempotency_key, user_id, order_id)
    VALUES (p_idempotency_key, p_user_id, v_order.id::text);

    RETURN jsonb_build_object(
        'order_id', v_order.id,
        'order_no', v_order.order_no,
        'total_amount', v_order.total_amount,
        'total_items', v_order.total_items,
        'status', v_order.status,
        'created_at', v_order.created_at,
        'items', v_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.checkout_cart(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.checkout_cart(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.checkout_cart(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_cart(TEXT, TEXT) TO service_role;
