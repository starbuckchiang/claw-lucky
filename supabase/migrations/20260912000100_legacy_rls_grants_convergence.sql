-- WEB-HOME-01B.1C: forward-only legacy RLS and grants convergence.
--
-- This migration removes only policies and the duplicate unique constraint
-- captured in the authoritative WEB-HOME-01B.1B manifest. It does not read or
-- mutate application rows, change primary/foreign keys, or alter trusted RPCs.
-- Existing p_* owner policies remain untouched.
--
-- Rollback: do not restore the insecure client-write or unrestricted-read
-- policies. Catalog SELECT policies and service_role privileges are preserved.
-- The removed duplicate UNIQUE constraint may be restored only if explicitly
-- required with:
--   ALTER TABLE public.user_mascots ADD CONSTRAINT
--     user_mascots_user_id_mascot_id_key UNIQUE (user_id, mascot_id);

DO $$
DECLARE
    v_table_name TEXT;
BEGIN
    FOREACH v_table_name IN ARRAY ARRAY[
        'users', 'mascots', 'gifts', 'user_mascots', 'redeem_history',
        'shop_products', 'shop_cart', 'orders', 'order_items'
    ] LOOP
        IF to_regclass(format('public.%I', v_table_name)) IS NULL THEN
            RAISE EXCEPTION 'Legacy security convergence requires public.%', v_table_name;
        END IF;
    END LOOP;
END $$;

-- Manifest-captured legacy owner-write and broad-read policies.
DROP POLICY IF EXISTS users_insert_own ON public.users;
DROP POLICY IF EXISTS users_select_own ON public.users;
DROP POLICY IF EXISTS users_update_own ON public.users;

DROP POLICY IF EXISTS "allow anon read mascots" ON public.mascots;

DROP POLICY IF EXISTS user_mascots_delete_own ON public.user_mascots;
DROP POLICY IF EXISTS user_mascots_insert_own ON public.user_mascots;
DROP POLICY IF EXISTS user_mascots_select_own ON public.user_mascots;
DROP POLICY IF EXISTS user_mascots_update_own ON public.user_mascots;

DROP POLICY IF EXISTS "allow anon select redeem history" ON public.redeem_history;
DROP POLICY IF EXISTS redeem_history_insert_own ON public.redeem_history;
DROP POLICY IF EXISTS redeem_history_select_own ON public.redeem_history;

DROP POLICY IF EXISTS shop_cart_delete_own ON public.shop_cart;
DROP POLICY IF EXISTS shop_cart_insert_own ON public.shop_cart;
DROP POLICY IF EXISTS shop_cart_select_own ON public.shop_cart;
DROP POLICY IF EXISTS shop_cart_update_own ON public.shop_cart;

DROP POLICY IF EXISTS orders_insert_all ON public.orders;
DROP POLICY IF EXISTS orders_select_all ON public.orders;
DROP POLICY IF EXISTS orders_update_all ON public.orders;

DROP POLICY IF EXISTS order_items_insert_all ON public.order_items;
DROP POLICY IF EXISTS order_items_select_all ON public.order_items;

-- Reassert the only client-visible catalog policies required by the product.
DROP POLICY IF EXISTS mascots_public_select ON public.mascots;
CREATE POLICY mascots_public_select
    ON public.mascots
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS gifts_public_select ON public.gifts;
CREATE POLICY gifts_public_select
    ON public.gifts
    FOR SELECT
    TO anon, authenticated
    USING (enabled = true);

DROP POLICY IF EXISTS shop_products_public_select ON public.shop_products;
CREATE POLICY shop_products_public_select
    ON public.shop_products
    FOR SELECT
    TO anon, authenticated
    USING (enabled = true);

-- Defense in depth: client roles receive only catalog or owner-scoped reads.
REVOKE ALL PRIVILEGES ON TABLE
    public.users,
    public.mascots,
    public.gifts,
    public.user_mascots,
    public.redeem_history,
    public.shop_products,
    public.shop_cart,
    public.orders,
    public.order_items
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.mascots, public.gifts, public.shop_products
TO anon, authenticated;

GRANT SELECT ON TABLE
    public.users,
    public.user_mascots,
    public.redeem_history,
    public.shop_cart,
    public.orders,
    public.order_items
TO authenticated;

REVOKE ALL PRIVILEGES ON SEQUENCE
    public.user_mascots_id_seq,
    public.redeem_history_id_seq
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.generate_order_no() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_order_no() FROM PUBLIC, anon, authenticated;

-- The later repository migration owns uq_user_mascots_user_mascot. Remove
-- the manifest-captured equivalent only after proving the survivor is exact.
DO $$
DECLARE
    v_survivor_definition TEXT;
    v_duplicate_definition TEXT;
BEGIN
    SELECT pg_get_constraintdef(oid)
      INTO v_survivor_definition
      FROM pg_constraint
     WHERE conrelid = 'public.user_mascots'::regclass
       AND conname = 'uq_user_mascots_user_mascot'
       AND contype = 'u';

    IF v_survivor_definition IS DISTINCT FROM 'UNIQUE (user_id, mascot_id)' THEN
        RAISE EXCEPTION 'Expected surviving user_mascots UNIQUE constraint is missing or incompatible';
    END IF;

    SELECT pg_get_constraintdef(oid)
      INTO v_duplicate_definition
      FROM pg_constraint
     WHERE conrelid = 'public.user_mascots'::regclass
       AND conname = 'user_mascots_user_id_mascot_id_key'
       AND contype = 'u';

    IF v_duplicate_definition IS NOT NULL THEN
        IF v_duplicate_definition IS DISTINCT FROM v_survivor_definition THEN
            RAISE EXCEPTION 'Refusing to remove non-equivalent user_mascots constraint';
        END IF;

        ALTER TABLE public.user_mascots
            DROP CONSTRAINT user_mascots_user_id_mascot_id_key;
    END IF;
END $$;