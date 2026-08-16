-- P-AUTH-05A: Existing Account Merge Security Foundation
-- Owner-scoped RLS (auth.uid()-based) for the "identity-linked" tables that
-- specs/003-spec-auth-subscription.md Section 7 requires to eventually be
-- merged, plus legacy-ID compatibility tracking.
--
-- Per docs/adr/ADR-009-existing-account-data-merge.md's inventory, these
-- tables currently have NO committed RLS policies at all, and every write
-- today goes through the browser's anon key trusting a CLIENT-SUPPLIED
-- `userId` (ultimately read from `localStorage.supabaseAuthUserId` via
-- `window.ClawUser.getUserId()` in js/api.js / js/shop/shop_cart.js /
-- js/shop/shop-api.js). This migration closes that gap the same way the
-- existing `wallpaper_generations`/`wallpaper_generation_jobs`/
-- `daily_generation_usage` tables already do (see
-- 20260712122000_rls_wallpaper_core.sql): authenticated users may only
-- SELECT their own rows (ownership resolved from the verified JWT via
-- `public.request_user_key()`, already defined in that migration — NEVER
-- from a request parameter), and INSERT/UPDATE/DELETE are blocked entirely
-- for `authenticated` — those must move to Edge Functions/RPCs using the
-- service-role key server-side (a required, currently NOT YET DONE,
-- follow-up — see review-auth-05A.md "Blockers").
--
-- Column-type-agnostic by design: every comparison casts `user_id::text`
-- so this works whether `user_id` is a legacy TEXT id, a native UUID
-- column, or a mix of both — no live-schema introspection was available
-- when authoring this migration (see review-auth-05A.md "資料表盤點方法與
-- 限制"), matching the SAME defensive style already used by
-- 20260712040000_create_wallpaper_core_tables.sql (dynamic PK detection).
--
-- BACKWARD-COMPATIBLE / REVERSIBLE:
-- - No table is dropped, no column is dropped, no existing row is modified.
-- - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` is additive-only.
-- - Every block is guarded by `to_regclass(...) IS NOT NULL` so this
--   migration is a safe no-op on any environment missing one of these
--   tables (e.g. a fresh/test project), and re-running it is idempotent.
-- ROLLBACK (manual, run only if this migration must be reverted):
--   ALTER TABLE IF EXISTS public.users DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE IF EXISTS public.user_mascots DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE IF EXISTS public.redeem_history DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE IF EXISTS public.shop_cart DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE IF EXISTS public.orders DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE IF EXISTS public.order_items DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS p_users_select_owner ON public.users;
--   DROP POLICY IF EXISTS p_users_deny_insert_authenticated ON public.users;
--   DROP POLICY IF EXISTS p_users_deny_update_authenticated ON public.users;
--   DROP POLICY IF EXISTS p_users_deny_delete_authenticated ON public.users;
--   -- (repeat DROP POLICY p_<table>_select_owner / _deny_insert_authenticated /
--   --  _deny_update_authenticated / _deny_delete_authenticated for
--   --  user_mascots, redeem_history, shop_cart, orders, order_items)
--   ALTER TABLE IF EXISTS public.users DROP COLUMN IF EXISTS legacy_user_id;
-- VERIFICATION (manual, after applying): see review-auth-05A.md "手動驗證步驟"
-- for the exact two-user owner/cross-account SELECT/INSERT/UPDATE/DELETE
-- checks to run against a real Supabase project before relying on this.

-- --- Legacy-ID compatibility (requirement 2) ---
-- `users.user_id` has historically been populated with EITHER a legacy
-- local id (`oss_u_xxx`, from js/user.js's `getOrCreateLegacyUserId()`)
-- OR a real Supabase Auth UUID (from `authUser.id`), depending on the app
-- version at the time a row was created. Every CURRENT write path
-- (js/user.js's `initUser()` -> `Api.createUserIfNotExists({ userId:
-- authUserId, ... })`) uses the Auth UUID exclusively, so `auth.uid()`-based
-- RLS is expected to work for all rows created going forward and for any
-- row already keyed by a real Auth UUID. Rows that (if any still exist)
-- were created before Auth UUID tracking existed and are keyed only by a
-- legacy string id will simply become inaccessible via RLS until manually
-- re-linked (a data-backfill task, explicitly OUT of scope here — RLS never
-- deletes/modifies those rows, it only restricts access, so no data is
-- destroyed). `legacy_user_id` is added purely as an additive, nullable
-- audit/compatibility column so such rows CAN be identified and re-linked
-- later without any schema change at that time.
DO $$
BEGIN
    IF to_regclass('public.users') IS NOT NULL THEN
        ALTER TABLE public.users ADD COLUMN IF NOT EXISTS legacy_user_id TEXT;
    END IF;
END $$;

-- --- users ---
DO $$
BEGIN
    IF to_regclass('public.users') IS NOT NULL THEN
        ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS p_users_select_owner ON public.users;
        DROP POLICY IF EXISTS p_users_deny_insert_authenticated ON public.users;
        DROP POLICY IF EXISTS p_users_deny_update_authenticated ON public.users;
        DROP POLICY IF EXISTS p_users_deny_delete_authenticated ON public.users;

        -- Owner-only read. `request_user_key()` resolves the CALLER's own
        -- verified JWT claim (sub/user_id) — never a client-supplied value.
        EXECUTE format($sql$
            CREATE POLICY p_users_select_owner
                ON public.users
                FOR SELECT
                TO authenticated
                USING (user_id::text = public.request_user_key())
        $sql$);

        -- All mutations (profile creation, points/tickets/coins changes)
        -- must move to Edge Functions/RPCs using the service-role key —
        -- see review-auth-05A.md "Blockers" for the exact call sites
        -- (js/api.js's createUserIfNotExists/adjustBalance) that this
        -- breaks until that follow-up work lands.
        EXECUTE format($sql$
            CREATE POLICY p_users_deny_insert_authenticated
                ON public.users
                AS RESTRICTIVE
                FOR INSERT
                TO authenticated
                WITH CHECK (false)
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_users_deny_update_authenticated
                ON public.users
                AS RESTRICTIVE
                FOR UPDATE
                TO authenticated
                USING (false)
                WITH CHECK (false)
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_users_deny_delete_authenticated
                ON public.users
                AS RESTRICTIVE
                FOR DELETE
                TO authenticated
                USING (false)
        $sql$);
    END IF;
END $$;

-- --- user_mascots ---
DO $$
BEGIN
    IF to_regclass('public.user_mascots') IS NOT NULL THEN
        ALTER TABLE public.user_mascots ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS p_user_mascots_select_owner ON public.user_mascots;
        DROP POLICY IF EXISTS p_user_mascots_deny_insert_authenticated ON public.user_mascots;
        DROP POLICY IF EXISTS p_user_mascots_deny_update_authenticated ON public.user_mascots;
        DROP POLICY IF EXISTS p_user_mascots_deny_delete_authenticated ON public.user_mascots;

        EXECUTE format($sql$
            CREATE POLICY p_user_mascots_select_owner
                ON public.user_mascots
                FOR SELECT
                TO authenticated
                USING (user_id::text = public.request_user_key())
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_user_mascots_deny_insert_authenticated
                ON public.user_mascots
                AS RESTRICTIVE
                FOR INSERT
                TO authenticated
                WITH CHECK (false)
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_user_mascots_deny_update_authenticated
                ON public.user_mascots
                AS RESTRICTIVE
                FOR UPDATE
                TO authenticated
                USING (false)
                WITH CHECK (false)
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_user_mascots_deny_delete_authenticated
                ON public.user_mascots
                AS RESTRICTIVE
                FOR DELETE
                TO authenticated
                USING (false)
        $sql$);
    END IF;
END $$;

-- --- redeem_history ---
DO $$
BEGIN
    IF to_regclass('public.redeem_history') IS NOT NULL THEN
        ALTER TABLE public.redeem_history ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS p_redeem_history_select_owner ON public.redeem_history;
        DROP POLICY IF EXISTS p_redeem_history_deny_insert_authenticated ON public.redeem_history;
        DROP POLICY IF EXISTS p_redeem_history_deny_update_authenticated ON public.redeem_history;
        DROP POLICY IF EXISTS p_redeem_history_deny_delete_authenticated ON public.redeem_history;

        EXECUTE format($sql$
            CREATE POLICY p_redeem_history_select_owner
                ON public.redeem_history
                FOR SELECT
                TO authenticated
                USING (user_id::text = public.request_user_key())
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_redeem_history_deny_insert_authenticated
                ON public.redeem_history
                AS RESTRICTIVE
                FOR INSERT
                TO authenticated
                WITH CHECK (false)
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_redeem_history_deny_update_authenticated
                ON public.redeem_history
                AS RESTRICTIVE
                FOR UPDATE
                TO authenticated
                USING (false)
                WITH CHECK (false)
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_redeem_history_deny_delete_authenticated
                ON public.redeem_history
                AS RESTRICTIVE
                FOR DELETE
                TO authenticated
                USING (false)
        $sql$);
    END IF;
END $$;

-- --- shop_cart ---
DO $$
BEGIN
    IF to_regclass('public.shop_cart') IS NOT NULL THEN
        ALTER TABLE public.shop_cart ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS p_shop_cart_select_owner ON public.shop_cart;
        DROP POLICY IF EXISTS p_shop_cart_deny_insert_authenticated ON public.shop_cart;
        DROP POLICY IF EXISTS p_shop_cart_deny_update_authenticated ON public.shop_cart;
        DROP POLICY IF EXISTS p_shop_cart_deny_delete_authenticated ON public.shop_cart;

        EXECUTE format($sql$
            CREATE POLICY p_shop_cart_select_owner
                ON public.shop_cart
                FOR SELECT
                TO authenticated
                USING (user_id::text = public.request_user_key())
        $sql$);

        -- NOTE: js/shop/shop-api.js's updateCartItem()/removeCartItem()
        -- currently do `.eq("id", cartId)` with NO owner check at all in
        -- the query itself — today's ONLY protection against one user
        -- mutating another user's cart row is the ABSENCE of any check,
        -- i.e. none. Blocking all authenticated writes here closes that
        -- gap structurally; the follow-up Edge Function/RPC replacing
        -- these call sites MUST re-verify ownership itself, not just move
        -- the same unchecked query server-side.
        EXECUTE format($sql$
            CREATE POLICY p_shop_cart_deny_insert_authenticated
                ON public.shop_cart
                AS RESTRICTIVE
                FOR INSERT
                TO authenticated
                WITH CHECK (false)
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_shop_cart_deny_update_authenticated
                ON public.shop_cart
                AS RESTRICTIVE
                FOR UPDATE
                TO authenticated
                USING (false)
                WITH CHECK (false)
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_shop_cart_deny_delete_authenticated
                ON public.shop_cart
                AS RESTRICTIVE
                FOR DELETE
                TO authenticated
                USING (false)
        $sql$);
    END IF;
END $$;

-- --- orders ---
DO $$
BEGIN
    IF to_regclass('public.orders') IS NOT NULL THEN
        ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS p_orders_select_owner ON public.orders;
        DROP POLICY IF EXISTS p_orders_deny_insert_authenticated ON public.orders;
        DROP POLICY IF EXISTS p_orders_deny_update_authenticated ON public.orders;
        DROP POLICY IF EXISTS p_orders_deny_delete_authenticated ON public.orders;

        EXECUTE format($sql$
            CREATE POLICY p_orders_select_owner
                ON public.orders
                FOR SELECT
                TO authenticated
                USING (user_id::text = public.request_user_key())
        $sql$);

        -- Order creation (Checkout) moves to an Edge Function/RPC — order
        -- numbering, total re-verification against actual product prices,
        -- and stock decrement must all happen server-side, never trusting
        -- the client-computed `total_amount`/`total_items` currently sent
        -- by js/shop/shop_cart.js.
        EXECUTE format($sql$
            CREATE POLICY p_orders_deny_insert_authenticated
                ON public.orders
                AS RESTRICTIVE
                FOR INSERT
                TO authenticated
                WITH CHECK (false)
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_orders_deny_update_authenticated
                ON public.orders
                AS RESTRICTIVE
                FOR UPDATE
                TO authenticated
                USING (false)
                WITH CHECK (false)
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_orders_deny_delete_authenticated
                ON public.orders
                AS RESTRICTIVE
                FOR DELETE
                TO authenticated
                USING (false)
        $sql$);
    END IF;
END $$;

-- --- order_items --- (no user_id column of its own; ownership is via the
-- parent orders.user_id, so the owner-read policy uses an EXISTS subquery)
DO $$
BEGIN
    IF to_regclass('public.order_items') IS NOT NULL AND to_regclass('public.orders') IS NOT NULL THEN
        ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS p_order_items_select_owner ON public.order_items;
        DROP POLICY IF EXISTS p_order_items_deny_insert_authenticated ON public.order_items;
        DROP POLICY IF EXISTS p_order_items_deny_update_authenticated ON public.order_items;
        DROP POLICY IF EXISTS p_order_items_deny_delete_authenticated ON public.order_items;

        EXECUTE format($sql$
            CREATE POLICY p_order_items_select_owner
                ON public.order_items
                FOR SELECT
                TO authenticated
                USING (
                    EXISTS (
                        SELECT 1 FROM public.orders o
                         WHERE o.id = order_items.order_id
                           AND o.user_id::text = public.request_user_key()
                    )
                )
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_order_items_deny_insert_authenticated
                ON public.order_items
                AS RESTRICTIVE
                FOR INSERT
                TO authenticated
                WITH CHECK (false)
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_order_items_deny_update_authenticated
                ON public.order_items
                AS RESTRICTIVE
                FOR UPDATE
                TO authenticated
                USING (false)
                WITH CHECK (false)
        $sql$);

        EXECUTE format($sql$
            CREATE POLICY p_order_items_deny_delete_authenticated
                ON public.order_items
                AS RESTRICTIVE
                FOR DELETE
                TO authenticated
                USING (false)
        $sql$);
    END IF;
END $$;
