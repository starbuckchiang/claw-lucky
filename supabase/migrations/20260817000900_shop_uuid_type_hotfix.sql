-- P-AUTH-05C.3: Shop UUID Type Hotfix — fixes `42804: column "product_id"
-- is of type uuid but expression is of type text` (found live during the
-- P-AUTH-05C.2 Cart smoke test against production) and evaluates the
-- `add_cart_item` vs. `checkout_cart` lock-ordering deadlock risk flagged
-- in `review-auth-05C-1-production-cart-recovery-preflight.md`.
--
-- ROOT CAUSE: `20260817000400_shop_cart_checkout_secure_rpc.sql` assumed
-- `shop_cart.product_id`/`shop_products.id`/`order_items.id`/
-- `order_items.order_id`/`order_items.product_id` were all `TEXT` (no
-- live-schema introspection was possible when it was authored) —
-- confirmed via read-only `information_schema.columns` queries against the
-- real production project that ALL of them are actually `uuid`. Only
-- `shop_cart.user_id`/`orders.user_id` are genuinely `TEXT` (correctly
-- assumed, NOT changed here). Full type matrix in
-- `review-auth-05C.3-shop-uuid-hotfix-preflight.md`.
--
-- THIS FILE DOES NOT MODIFY `20260817000400_shop_cart_checkout_secure_rpc.sql`
-- or `20260817000500_shop_checkout_atomic_claim_fix.sql` (both already
-- applied to production) — `CREATE OR REPLACE FUNCTION` supersedes
-- `add_cart_item`/`checkout_cart`'s bodies with the SAME signatures
-- (same parameter names/types/order, same return type) — no overload is
-- created, the existing `js/services/shop/shop-ops-repository.js`/
-- `.ts` RPC calls are unaffected. `update_cart_item_quantity`/
-- `remove_cart_item`/`clear_cart` were AUDITED (every `INSERT`/`UPDATE`/
-- `WHERE`/`RETURN QUERY` checked) and found to have NO type-mismatch bug
-- — they only ever compare via `column::text = p_param` (casting the
-- UUID/text column TO text for comparison, which is always safe
-- regardless of the underlying type) and never INSERT `p_product_id`/
-- `p_cart_id` into a UUID column directly — so they are intentionally
-- NOT redefined here (avoids touching working code, per this task's
-- explicit "不得重構" constraint).
--
-- FIX STRATEGY (no raw UUID-format validation/exception-catching needed —
-- see rationale below, satisfying requirement "無效UUID不得暴露原始
-- Postgres錯誤" structurally rather than via a runtime guard):
--   1. `add_cart_item`: the INSERT of a brand-new cart row now uses
--      `v_product.id` (the ALREADY-FETCHED, natively `uuid`-typed value
--      from the `shop_products` row this function just locked and
--      validated) instead of re-casting the raw `p_product_id` TEXT
--      parameter. Since that product lookup uses `WHERE id::text =
--      p_product_id` and REQUIRES `FOUND` before reaching the INSERT,
--      `p_product_id` is PROVEN to be a validly-formatted UUID string by
--      the time the INSERT runs (it necessarily equals a real
--      `shop_products.id`'s text form) — there is no code path where an
--      actually-invalid string could ever reach a `::uuid` cast, because
--      the raw parameter itself is never cast at all; only the
--      already-typed record field is used.
--   2. `checkout_cart`: the `order_items` INSERT casts
--      `(elem->>'product_id')::uuid`. That JSON value was itself
--      populated earlier in the SAME function call from `v_product.id`
--      (a real `uuid`, serialized into `jsonb` via `jsonb_build_object`,
--      which always produces the canonical UUID text form) — so this
--      cast is likewise guaranteed to succeed; it is never fed by
--      caller-supplied input.
--
-- LOCK-ORDERING FIX (deadlock risk, §四 of the preflight): `add_cart_item`
-- previously locked `shop_products` FIRST, then checked for an existing
-- `shop_cart` row — the INVERSE of `checkout_cart`'s `shop_cart` →
-- `shop_products` order, a real (if narrow) deadlock risk for the SAME
-- user concurrently checking out and adding more of an item already in
-- their cart. FIXED by reordering `add_cart_item` to check/lock the
-- existing `shop_cart` row FIRST (this is a no-op lock when 0 rows exist
-- yet — nothing to lock), THEN lock `shop_products` — now consistently
-- cart → product, matching `checkout_cart` and `update_cart_item_quantity`.
-- This was SAFE to fix in this hotfix (not deferred as a blocker) because
-- `shop_cart` already has a real `UNIQUE (user_id, product_id)` constraint
-- (`shop_cart_user_id_product_id_key`, confirmed via `pg_constraint`) —
-- two concurrent "add a brand-new item" calls for the SAME user+product
-- can never create a duplicate row (the second INSERT either waits then
-- sees a real conflict, or the first rolled back and the second becomes
-- the new row) — this is the EXACT same "two concurrent writers, unique
-- constraint prevents duplication" guarantee already relied on elsewhere
-- in this repo's 05B/05C migrations. A `unique_violation` in this rare
-- race window is explicitly caught and re-raised as a plain, classifiable
-- message — never a raw Postgres error leaks to the caller (the
-- `shop-ops-handler.js`'s existing generic-fallback classification already
-- maps ANY unrecognized message to `retryable: true`, so no handler
-- change was needed for this either).
--
-- PRESERVED UNCHANGED (per explicit requirement — verified below):
--   - SECURITY DEFINER + SET search_path = public, pg_temp on both functions.
--   - REVOKE ALL ... FROM PUBLIC/anon/authenticated + GRANT ... TO
--     service_role ONLY (re-asserted, idempotent).
--   - JWT-derived ownership: p_user_id is still the ONLY identity input;
--     nothing about the Edge Function handler's identity resolution
--     changed (only this file's SQL is superseded).
--   - Server-authoritative price/stock: still read from `shop_products`
--     inside the SAME row lock, never accepted as a parameter.
--   - checkout_cart's claim-then-lock idempotency
--     (INSERT...ON CONFLICT DO NOTHING + SELECT...FOR UPDATE, identity
--     check, completed/processing branch) — UNCHANGED, only the
--     order_items INSERT's product_id cast was touched.
--   - orders.status is still only ever 'pending' — no payment-success
--     claim.
--   - order_no is still never set explicitly by this function — the
--     existing `trigger_set_order_no`/`generate_order_no()` trigger
--     (confirmed live, see the 05C.1 preflight) still handles it exactly
--     as before.
--   - No RLS policy is touched. No frontend write path is reintroduced.
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: pure function-body fix, same
-- signatures, same grants; no schema/table/column/constraint change at
-- all in this migration.
-- ROLLBACK (manual): re-run the ORIGINAL `CREATE OR REPLACE FUNCTION`
-- blocks from `20260817000400_shop_cart_checkout_secure_rpc.sql` (their
-- text is untouched).
-- NOT APPLIED/NOT DEPLOYED by this task (P-AUTH-05C.3: local preparation
-- + tests only, per instruction — no `db push`, no deploy, no production
-- checkout).

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

    -- Lock-ordering fix: check/lock any EXISTING cart row FIRST (a no-op
    -- lock when 0 rows exist yet) — now consistently cart -> product,
    -- matching checkout_cart/update_cart_item_quantity. shop_cart's own
    -- UNIQUE (user_id, product_id) constraint protects against a
    -- duplicate row if two concurrent "add a brand-new item" calls race
    -- past this point (see migration header).
    SELECT * INTO v_existing
      FROM public.shop_cart
     WHERE user_id::text = p_user_id
       AND product_id::text = p_product_id
       FOR UPDATE;

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

    IF v_existing.id IS NOT NULL THEN
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

    BEGIN
        -- UUID fix: `v_product.id` (native uuid, already fetched/locked
        -- above) is used directly — NOT a re-cast of the raw
        -- `p_product_id` TEXT parameter. This is what closes the
        -- `column "product_id" is of type uuid but expression is of type
        -- text` bug found live in P-AUTH-05C.2.
        INSERT INTO public.shop_cart (
            user_id, product_id, quantity, selected, unlock_verified, created_at, updated_at
        ) VALUES (
            p_user_id, v_product.id, p_quantity, true, true, NOW(), NOW()
        ) RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
        -- A concurrent "add brand-new item" call for the SAME
        -- (user_id, product_id) won the race — shop_cart's own UNIQUE
        -- constraint prevented a duplicate row. Re-raised as a plain,
        -- classifiable message (never the raw constraint-violation
        -- detail); the caller's existing generic-failure handling
        -- already treats an unrecognized message as `retryable: true`,
        -- so a client retry safely lands on the UPDATE branch above.
        RAISE EXCEPTION 'add_cart_item: concurrent add detected for product %, please retry', p_product_id;
    END;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.add_cart_item(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_cart_item(TEXT, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.add_cart_item(TEXT, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.add_cart_item(TEXT, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.checkout_cart(
    p_user_id TEXT,
    p_idempotency_key TEXT
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_claim public.shop_checkout_requests;
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

    INSERT INTO public.shop_checkout_requests (idempotency_key, user_id, order_id, status)
    VALUES (p_idempotency_key, p_user_id, NULL, 'processing')
    ON CONFLICT (idempotency_key) DO NOTHING;

    SELECT * INTO v_claim
      FROM public.shop_checkout_requests
     WHERE idempotency_key = p_idempotency_key
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'checkout_cart: failed to claim idempotency key %', p_idempotency_key;
    END IF;

    IF v_claim.user_id <> p_user_id THEN
        RAISE EXCEPTION 'checkout_cart: idempotency key does not belong to this user';
    END IF;

    IF v_claim.status = 'completed' THEN
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
         WHERE o.id::text = v_claim.order_id
         GROUP BY o.id, o.order_no, o.total_amount, o.total_items, o.status, o.created_at;

        IF v_cached_result IS NULL THEN
            RAISE EXCEPTION 'checkout_cart: cached order % missing for idempotency key', v_claim.order_id;
        END IF;

        RETURN v_cached_result;
    END IF;

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

        UPDATE public.shop_products
           SET stock = stock - v_cart_row.quantity,
               updated_at = NOW()
         WHERE id::text = v_product.id::text;
    END LOOP;

    INSERT INTO public.orders (user_id, total_amount, total_items, status, created_at, updated_at)
    VALUES (p_user_id, v_total_amount, v_total_items, 'pending', NOW(), NOW())
    RETURNING * INTO v_order;

    -- UUID fix: `(elem->>'product_id')::uuid` — the raw jsonb text value
    -- was itself populated (above, in this SAME function call) from
    -- `v_product.id`, a real uuid, so this cast is guaranteed to succeed;
    -- it is never fed by caller-supplied input. Closes the identical
    -- `column "product_id" is of type uuid but expression is of type
    -- text` class of bug for order_items.
    INSERT INTO public.order_items (
        order_id, product_id, product_name, product_image, price, quantity, subtotal, created_at
    )
    SELECT
        v_order.id,
        (elem->>'product_id')::uuid,
        elem->>'product_name',
        elem->>'product_image',
        (elem->>'price')::numeric,
        (elem->>'quantity')::integer,
        (elem->>'subtotal')::numeric,
        NOW()
    FROM jsonb_array_elements(v_items) elem;

    DELETE FROM public.shop_cart WHERE user_id::text = p_user_id;

    UPDATE public.shop_checkout_requests
       SET status = 'completed',
           order_id = v_order.id::text
     WHERE idempotency_key = p_idempotency_key;

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
