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
    users_pk_column TEXT;
    users_pk_type TEXT;
BEGIN
    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
      INTO users_pk_column, users_pk_type
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
     WHERE n.nspname = 'public'
       AND c.relname = 'users'
       AND i.indisprimary
       AND i.indnatts = 1
       AND a.attname = ANY (ARRAY['user_id', 'id'])
     LIMIT 1;

    IF users_pk_column IS NULL OR users_pk_type IS NULL THEN
        RAISE EXCEPTION 'Cannot create ensure_user_row: public.users single-column PK with candidate name (user_id|id) not found.';
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

            INSERT INTO public.users (%2$I, nickname, points, tickets, coins, updated_at)
            VALUES (p_user_id::%1$s, COALESCE(btrim(p_nickname), ''), 0, 0, 20, NOW())
            ON CONFLICT (%2$I) DO NOTHING
            RETURNING * INTO v_user;

            IF NOT FOUND THEN
                SELECT * INTO v_user FROM public.users WHERE %2$I::text = p_user_id;
            END IF;

            IF v_user IS NULL THEN
                RAISE EXCEPTION 'ensure_user_row: failed to create or find user %%', p_user_id;
            END IF;

            RETURN v_user;
        END;
        $fn$;
    $sql$, users_pk_type, users_pk_column);
END $$;

REVOKE ALL ON FUNCTION public.ensure_user_row(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_user_row(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_user_row(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_row(TEXT, TEXT) TO service_role;

-- Drop the hotfix-removed generic adjustment function if it happens to
-- exist in some intermediate local state (never applied to any real
-- environment — see header note above).
DROP FUNCTION IF EXISTS public.apply_generic_balance_adjustment(TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT);
