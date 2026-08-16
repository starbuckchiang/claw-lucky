-- P-AUTH-05B-2A: ensure_user_row (secure create-if-missing).
--
-- Requirement 1/2: `js/api.js`'s `createUserIfNotExists({userId, nickname})`
-- currently does `.upsert({user_id, nickname, points:0, tickets:0,
-- coins:20, ...}, {onConflict:"user_id"})` from the BROWSER with an anon
-- key and a CLIENT-SUPPLIED `userId` — this has TWO real problems:
--   1. `userId` is never checked against the caller's own verified session
--      at all — any authenticated (or even just correctly-shaped) caller
--      can invoke this with an ARBITRARY user_id.
--   2. Because it is an UPSERT (not a true "create if missing"), calling it
--      again for an user_id that ALREADY has real data OVERWRITES that
--      existing row's nickname/points/tickets/coins back to the hardcoded
--      defaults (0/0/20) — a live griefing vector: anyone who knows or
--      guesses another user's `user_id` can reset their entire balance to
--      zero by simply calling this function with that id.
-- `ensure_user_row()` below fixes BOTH: it is a true insert-if-missing
-- (`ON CONFLICT (user_id) DO NOTHING`, never touching an existing row's
-- balance columns), and (per requirement 2) the calling Edge Function
-- handler is the ONLY place `p_user_id` may originate from — always the
-- caller's own JWT-verified id, NEVER the request body (enforced at the
-- handler layer, see supabase/functions/_shared/wallet-ops-handler.js).
--
-- P-AUTH-05B-2A HOTFIX (requirement 2): this file originally ALSO defined
-- `apply_generic_balance_adjustment()` — a generic RPC accepting arbitrary
-- `p_points_delta`/`p_tickets_delta`/`p_coins_delta`, exposed to the
-- browser via a public `wallet-ops/adjust-balance` route. That route (and
-- this function) have been REMOVED ENTIRELY by the hotfix: "每種獎勵改為
-- 伺服器定義的明確 operation" (each reward becomes its own explicit,
-- server-defined operation) rather than one generic delta-accepting RPC.
-- Gacha draws and Gift redemptions already use their OWN dedicated, more
-- atomic RPCs (20260817000200/20260817000300). The ONLY other caller of
-- the old generic path — the "watch ad" coin reward
-- (`js/game/ad-reward.js`) — has NO server-verifiable proof the ad was
-- actually watched (see review-auth-05B-2A-hotfix.md's threat model) and
-- is now explicitly PAUSED (an honest "目前維護中" message, no server call
-- at all) rather than kept working through a generic RPC. If a real,
-- server-verifiable ad-completion callback is ever built, it should get
-- its OWN dedicated `claim_watch_ad_reward(p_user_id, p_idempotency_key)`
-- RPC with a FIXED server-defined reward amount and its own idempotent
-- request-tracking table — NOT a revival of a generic adjustment function.
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: additive-only (one new function); no
-- existing table/column/row is modified.
-- ROLLBACK (manual):
--   REVOKE EXECUTE ON FUNCTION public.ensure_user_row(TEXT, TEXT) FROM service_role;
--   DROP FUNCTION IF EXISTS public.ensure_user_row(TEXT, TEXT);
-- NOT APPLIED by this task (P-AUTH-05B-2A requirement 10 / hotfix
-- requirement 8).

DO $$
DECLARE
    users_user_id_type TEXT;
BEGIN
    -- P-AUTH-05B-2B.2 hotfix: this originally searched for whichever
    -- column is `users`'s actual PRIMARY KEY (candidates `user_id`/`id`),
    -- assuming `user_id` itself would be that PK. On the real project,
    -- `users`'s true PK is a SEPARATE surrogate column (`id`), while
    -- `user_id` (the real Supabase Auth UID — the column EVERY other
    -- table/RPC in this repo already keys identity on) is merely
    -- UNIQUE-constrained, not the PK. The original dynamic search picked
    -- `id`, which would have made this function `INSERT`/`ON CONFLICT` on
    -- the WRONG column entirely — a new row would get `id = <the auth
    -- UID>` while `user_id` itself stayed NULL, so every other function's
    -- `WHERE user_id::text = p_user_id` lookup (claim_gacha_draw,
    -- redeem_gift_transaction, apply_point_transaction, etc.) would never
    -- find that user again. Fixed by targeting `user_id` BY NAME
    -- (matching the established, universal app convention) and only
    -- dynamically detecting its TYPE, with an explicit check that it
    -- actually carries a PRIMARY KEY/UNIQUE constraint (required for
    -- `ON CONFLICT` to target it) before defining the function.
    SELECT format_type(a.atttypid, a.atttypmod)
      INTO users_user_id_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'users'
       AND a.attname = 'user_id'
       AND a.attnum > 0
       AND NOT a.attisdropped;

    IF users_user_id_type IS NULL THEN
        RAISE EXCEPTION 'Cannot create ensure_user_row: public.users.user_id column not found.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
         WHERE con.conrelid = 'public.users'::regclass
           AND con.contype IN ('p', 'u')
           AND con.conkey = ARRAY[a.attnum]
           AND a.attname = 'user_id'
    ) THEN
        RAISE EXCEPTION 'Cannot create ensure_user_row: public.users.user_id has no PRIMARY KEY/UNIQUE constraint for ON CONFLICT to target.';
    END IF;

    -- `ensure_user_row`: dynamic EXECUTE is required (unlike
    -- apply_point_transaction's `WHERE user_id::text = p_user_id` trick)
    -- because this is an INSERT of a genuinely NEW row — the VALUES list
    -- must be cast to the users.user_id column's REAL type (TEXT or UUID),
    -- which cannot be known statically when authoring this migration (see
    -- 20260712040000_create_wallpaper_core_tables.sql's precedent for the
    -- same technique).
    EXECUTE format($sql$
        CREATE OR REPLACE FUNCTION public.ensure_user_row(
            p_user_id TEXT,
            p_nickname TEXT DEFAULT ''
        ) RETURNS public.users
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $fn$
        DECLARE
            v_user public.users;
        BEGIN
            IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
                RAISE EXCEPTION 'ensure_user_row: p_user_id is required';
            END IF;

            INSERT INTO public.users (user_id, nickname, points, tickets, coins, updated_at)
            VALUES (p_user_id::%1$s, COALESCE(btrim(p_nickname), ''), 0, 0, 20, NOW())
            ON CONFLICT (user_id) DO NOTHING
            RETURNING * INTO v_user;

            IF NOT FOUND THEN
                SELECT * INTO v_user FROM public.users WHERE user_id::text = p_user_id;
            END IF;

            IF v_user IS NULL THEN
                RAISE EXCEPTION 'ensure_user_row: failed to create or find user %%', p_user_id;
            END IF;

            RETURN v_user;
        END;
        $fn$;
    $sql$, users_user_id_type);
END $$;

REVOKE ALL ON FUNCTION public.ensure_user_row(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_user_row(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_user_row(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_row(TEXT, TEXT) TO service_role;

-- Drop the hotfix-removed generic adjustment function if it happens to
-- exist in some intermediate local state (never applied to any real
-- environment — see header note above).
DROP FUNCTION IF EXISTS public.apply_generic_balance_adjustment(TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT);
