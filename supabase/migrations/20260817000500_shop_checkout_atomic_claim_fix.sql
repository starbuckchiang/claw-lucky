-- P-AUTH-05B-2B.1 Hotfix: Checkout Idempotency Race Fix
--
-- ROOT CAUSE: `checkout_cart()` (as originally written in
-- `20260817000400_shop_cart_checkout_secure_rpc.sql`) looked up
-- `shop_checkout_requests` with a plain `SELECT ... FOR UPDATE` and
-- treated "no matching row" as "this is a fresh checkout intent, proceed".
-- Two genuinely concurrent requests carrying the SAME idempotency key can
-- BOTH run that SELECT before EITHER has inserted anything — Postgres's
-- MVCC snapshot means neither transaction sees the other's not-yet-
-- committed row, so BOTH conclude "not found" and both proceed to lock
-- `shop_cart`. The loser of that second lock then finds the cart already
-- emptied by the winner (which already ran `DELETE FROM shop_cart`) and
-- fails with `CART_EMPTY` — instead of the required behavior: waiting for
-- the winner to finish, then returning the WINNER'S order.
--
-- THIS FILE DOES NOT MODIFY `20260817000400_shop_cart_checkout_secure_rpc.sql`
-- (per this task's explicit constraint). It is a NEW, ADDITIVE migration
-- that:
--   1. ALTERS the EXISTING `public.shop_checkout_requests` table (created
--      by the 05B-2B migration above) — this IS a schema ALTER of an
--      already-defined table, disclosed explicitly here and in
--      review-auth-05B-2B.1-hotfix.md (NOT a no-op, NOT "no existing
--      schema touched"):
--        - adds `status TEXT NOT NULL DEFAULT 'processing'` (values
--          'processing' | 'completed'), so a row can represent an
--          IN-FLIGHT claim before an order exists;
--        - drops the `NOT NULL` constraint on `order_id` (a claim row is
--          inserted BEFORE the order is created, so `order_id` must be
--          allowed to start out NULL).
--   2. `CREATE OR REPLACE FUNCTION public.checkout_cart(...)` — same
--      signature as the 05B-2B migration (Postgres allows replacing a
--      function body in a LATER migration without touching the file that
--      first created it; this is the standard, explicitly-sanctioned
--      pattern this repo already uses — e.g. this is exactly how a bug in
--      a previously-migrated function would always be fixed). When BOTH
--      migrations are applied in order, this is the version that actually
--      runs.
--
-- FIX DESIGN ("claim, then lock" — chosen over an advisory lock because
-- it needs no new lock-key-hashing scheme and naturally cleans itself up
-- via the SAME row that already exists for idempotency, and because it
-- reuses Postgres's own well-defined `INSERT ... ON CONFLICT` conflict-
-- resolution semantics instead of a hand-rolled retry loop):
--   1. `INSERT INTO shop_checkout_requests (idempotency_key, user_id,
--      order_id, status) VALUES (..., NULL, 'processing') ON CONFLICT
--      (idempotency_key) DO NOTHING`. Postgres's own `ON CONFLICT` conflict
--      resolution is defined to WAIT for any OTHER in-flight transaction
--      that is concurrently inserting the SAME key before deciding whether
--      this is a real conflict — this is what actually serializes two
--      concurrent same-key requests; it is NOT implemented by catching a
--      unique-violation exception (there is no `EXCEPTION WHEN
--      unique_violation` anywhere in this function, by design — the
--      caller-visible outcome must never be "CART_EMPTY", so nothing here
--      is allowed to short-circuit into that error path just because a
--      conflict was detected).
--        - If the other transaction later COMMITS, this INSERT resolves
--          to "conflict exists, do nothing" (0 rows), and the row this
--          waiter subsequently reads (step 2) is the COMMITTED,
--          'completed' row.
--        - If the other transaction ROLLS BACK (e.g. `CART_EMPTY`/
--          `insufficient stock`/any other failure), its own INSERT is
--          undone as part of that rollback — this INSERT then sees NO
--          conflict at all and actually performs the insert, becoming the
--          new legitimate claimant that proceeds with a full, fresh
--          checkout attempt using the SAME idempotency key.
--   2. `SELECT * FROM shop_checkout_requests WHERE idempotency_key = ...
--      FOR UPDATE` — locks whichever row now exists (ours, if we just
--      won the claim; or the pre-existing row, otherwise) for the
--      remainder of THIS transaction.
--   3. Identity check (`v_claim.user_id <> p_user_id`) ALWAYS runs
--      immediately after the lock is acquired, BEFORE branching on
--      `status` — a caller can never observe another user's claim or
--      order, regardless of whether that claim is still in-flight or
--      already completed (same "verify identity before returning
--      anything" ordering as every prior P-AUTH-05A.1-derived RPC in this
--      repo).
--   4. If `status = 'completed'`: return the SAME cached order this
--      function already returned before (no re-execution of ANY of the
--      steps below — this branch runs BEFORE the empty-cart check, so a
--      resend can never have its already-completed result overwritten by
--      a stale `CART_EMPTY` just because the cart happens to be empty by
--      the time of the resend).
--   5. Otherwise (`status = 'processing'`, and by the `ON CONFLICT`
--      semantics above this can ONLY be OUR OWN just-created claim,
--      never someone else's still-running one — we would have blocked on
--      step 1/2 until that other transaction fully finished): proceed
--      with the UNCHANGED cart-lock / product-lock / total computation /
--      order + order_items creation / stock decrement / cart-clear logic
--      from the 05B-2B migration, then `UPDATE shop_checkout_requests SET
--      status = 'completed', order_id = ...` (instead of the old
--      `INSERT INTO shop_checkout_requests` — the row already exists from
--      step 1).
--
-- LOCK ORDERING (deadlock avoidance): every call to this function now
-- always locks rows in the SAME fixed order — `shop_checkout_requests`
-- row first, THEN `shop_cart` rows, THEN `shop_products` rows. Since every
-- caller (there is only one entry point into this logic) follows this
-- same order, two different transactions can never hold a lock the other
-- one is waiting for while waiting for a lock the other one holds.
--
-- `order_no` STAGING BLOCKER (unchanged from 05B-2B, re-confirmed here):
-- no migration in this repo defines `public.orders` or its `order_no`
-- column, so this repo cannot prove whether `order_no` has a NOT NULL
-- constraint, a DEFAULT, or a trigger that generates it. The `INSERT INTO
-- public.orders (...)` statement below (identical to the 05B-2B original)
-- still does NOT set `order_no` explicitly — this migration does not
-- invent an unverified generation scheme. See
-- review-auth-05B-2B.1-hotfix.md §"order_no 查核結果" for the explicit
-- staging blocker and the verification query that MUST be run against the
-- real project before this can be called resolved.
--
-- BACKWARD-COMPATIBLE / REVERSIBLE:
-- - The `status`/`order_id` ALTERs are additive/loosening only (no data
--   loss, no existing row can violate the new constraints since the table
--   has never been applied to any real project — see Deployment status).
-- - `CREATE OR REPLACE FUNCTION` on the same signature is always
--   reversible by re-running the ORIGINAL migration's `CREATE OR REPLACE
--   FUNCTION` statement (its text is untouched, still present in
--   `20260817000400_shop_cart_checkout_secure_rpc.sql`).
-- ROLLBACK (manual):
--   -- restore the pre-hotfix function body:
--   \i 20260817000400_shop_cart_checkout_secure_rpc.sql   -- (re-run just its CREATE OR REPLACE FUNCTION checkout_cart block)
--   ALTER TABLE IF EXISTS public.shop_checkout_requests ALTER COLUMN order_id SET NOT NULL;
--   ALTER TABLE IF EXISTS public.shop_checkout_requests DROP COLUMN IF EXISTS status;
-- NOT APPLIED and NOT DEPLOYED by this task (P-AUTH-05B-2B.1 hotfix —
-- implementation + local static tests only, per instruction).

-- --- Schema ALTER of the EXISTING shop_checkout_requests table (defined
-- in 20260817000400_shop_cart_checkout_secure_rpc.sql, NOT modified here) ---

ALTER TABLE IF EXISTS public.shop_checkout_requests
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processing';

DO $$
BEGIN
    IF to_regclass('public.shop_checkout_requests') IS NOT NULL THEN
        ALTER TABLE public.shop_checkout_requests
            ALTER COLUMN order_id DROP NOT NULL;
    END IF;
END $$;

ALTER TABLE IF EXISTS public.shop_checkout_requests
    DROP CONSTRAINT IF EXISTS shop_checkout_requests_status_check;

ALTER TABLE IF EXISTS public.shop_checkout_requests
    ADD CONSTRAINT shop_checkout_requests_status_check
    CHECK (status IN ('processing', 'completed'));

-- --- checkout_cart: CREATE OR REPLACE with the atomic claim-then-lock fix ---

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

    -- Step 1: ATOMICALLY CLAIM this idempotency key. Postgres's own
    -- ON CONFLICT resolution — NOT an exception handler — is what
    -- serializes two concurrent same-key requests: this statement WAITS
    -- for any other in-flight transaction holding the same key before
    -- deciding whether a real conflict exists.
    INSERT INTO public.shop_checkout_requests (idempotency_key, user_id, order_id, status)
    VALUES (p_idempotency_key, p_user_id, NULL, 'processing')
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- Step 2: lock whichever row now exists for this key (ours, if we
    -- just won the claim above; the pre-existing row, if someone else
    -- claimed it first — by the time this SELECT returns, that other
    -- transaction has definitely committed or rolled back).
    SELECT * INTO v_claim
      FROM public.shop_checkout_requests
     WHERE idempotency_key = p_idempotency_key
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'checkout_cart: failed to claim idempotency key %', p_idempotency_key;
    END IF;

    -- Step 3: identity check ALWAYS runs before ANY branch on status — a
    -- caller can never observe another user's in-flight or completed
    -- claim (P-AUTH-05A.1 pattern).
    IF v_claim.user_id <> p_user_id THEN
        RAISE EXCEPTION 'checkout_cart: idempotency key does not belong to this user';
    END IF;

    -- Step 4: an already-completed claim returns its cached result
    -- UNCONDITIONALLY, BEFORE the empty-cart check below — a resend can
    -- never have its completed result masked by a stale CART_EMPTY.
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
            -- A completed marker with no matching order is a
            -- data-inconsistency, not a normal "not found" — reject
            -- loudly rather than silently re-running the checkout.
            RAISE EXCEPTION 'checkout_cart: cached order % missing for idempotency key', v_claim.order_id;
        END IF;

        RETURN v_cached_result;
    END IF;

    -- Step 5: `v_claim.status = 'processing'` and `v_claim.user_id =
    -- p_user_id` here. By the ON CONFLICT semantics above, this can ONLY
    -- be OUR OWN just-created claim (order_id IS NULL) — any OTHER
    -- transaction's 'processing' claim would have made step 1/2 above
    -- WAIT until it fully finished (and if it committed, we would have
    -- observed 'completed' here instead). Proceed with a fresh checkout,
    -- reusing the exact business logic from the 05B-2B migration
    -- unchanged.
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
        -- (or the rest of the function) rolls this back too, INCLUDING
        -- the claim row inserted in Step 1 (see the migration header for
        -- why that is exactly what allows a legitimate retry to re-claim
        -- the same key after a rollback).
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

    -- Mark OUR OWN claim (from Step 1) as completed — this UPDATEs the
    -- SAME row, it does not INSERT a new one (the old 05B-2B version
    -- inserted a brand-new row here; that is exactly the design this
    -- hotfix replaces).
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
