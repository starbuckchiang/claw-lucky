-- P-AUTH-05B-2A: Gacha & Gift Secure Write APIs
-- Requirement 5: "points 只能走 apply_point_transaction ledger. tickets/
-- coins 若尚無安全 ledger，先提出最小相容 migration 與稽核規則，不得繼續用
-- 前端讀值後 UPDATE。"
--
-- `public.point_transactions` + `apply_point_transaction()` already exist
-- (20260816000100, P-AUTH-05A) for `users.points`. `users.tickets` and
-- `users.coins` have NO equivalent ledger at all — `js/api.js`'s
-- `adjustBalance()` (BROWSER anon-key context) reads `users.tickets`/
-- `users.coins`, does client-side arithmetic, then UPDATEs the raw columns
-- directly, with no audit trail (exactly the same shape of problem
-- `point_transactions` was created to fix for `points`).
--
-- This migration creates TWO new ledger tables (`ticket_transactions`,
-- `coin_transactions`) and their corresponding SECURITY DEFINER functions
-- (`apply_ticket_transaction`, `apply_coin_transaction`), mirroring
-- `point_transactions`/`apply_point_transaction` EXACTLY (same shape, same
-- hardening, same backfill strategy) — deliberately NOT a generalized
-- "one ledger table with a currency column" refactor of the EXISTING
-- points ledger (which is already relied upon by `finalize_account_merge`
-- and is out of scope to touch here); minimal, additive, and consistent
-- with the established pattern instead.
--
-- Per requirement 6 (SECURITY DEFINER hardening) and this repo's Supabase
-- rules, both new functions' EXECUTE privilege is granted ONLY to
-- `service_role` — never `anon`/`authenticated`. `js/api.js`'s
-- `adjustBalance()` direct-UPDATE pattern for `tickets`/`coins` is replaced
-- by Edge Function adapters calling these RPCs (P-AUTH-05B-2A, see
-- review-auth-05B-2A.md) — this migration only adds the ledger primitive,
-- it does not itself move any call site.
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: additive-only (two new tables, two new
-- functions); no existing table/column/row is modified. The one-time
-- backfill below only INSERTs new ledger rows, it never touches
-- `users.tickets`/`users.coins` themselves.
-- ROLLBACK (manual):
--   REVOKE EXECUTE ON FUNCTION public.apply_ticket_transaction(TEXT, INTEGER, TEXT, UUID) FROM service_role;
--   REVOKE EXECUTE ON FUNCTION public.apply_coin_transaction(TEXT, INTEGER, TEXT, UUID) FROM service_role;
--   DROP FUNCTION IF EXISTS public.apply_ticket_transaction(TEXT, INTEGER, TEXT, UUID);
--   DROP FUNCTION IF EXISTS public.apply_coin_transaction(TEXT, INTEGER, TEXT, UUID);
--   DROP TABLE IF EXISTS public.ticket_transactions;
--   DROP TABLE IF EXISTS public.coin_transactions;
-- VERIFICATION (manual): see review-auth-05B-2A.md "手動驗證步驟" / 05C plan.
-- NOT APPLIED by this task (P-AUTH-05B-2A requirement 10: local
-- implementation + tests only, no Production deploy).

DO $$
DECLARE
    users_user_id_type TEXT;
BEGIN
    -- P-AUTH-05B-2B.2 hotfix: see point_transactions' identical fix in
    -- 20260816000100_point_transactions_ledger.sql for the full
    -- rationale (the real PK of `users` is a separate `id` column; the
    -- FK here must target `user_id` BY NAME, which is merely
    -- UNIQUE-constrained, not the table's PK).
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
        RAISE EXCEPTION 'Cannot create ticket_transactions/coin_transactions: public.users.user_id column not found.';
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
        RAISE EXCEPTION 'Cannot create ticket_transactions/coin_transactions: public.users.user_id has no PRIMARY KEY/UNIQUE constraint to reference via foreign key.';
    END IF;

    EXECUTE format($sql$
        CREATE TABLE IF NOT EXISTS public.ticket_transactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id %1$s NOT NULL,
            delta INTEGER NOT NULL,
            reason TEXT NOT NULL,
            reference_id UUID,
            balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT fk_ticket_transactions_user FOREIGN KEY (user_id)
                REFERENCES public.users(user_id) ON DELETE RESTRICT
        );
    $sql$, users_user_id_type);

    EXECUTE format($sql$
        CREATE TABLE IF NOT EXISTS public.coin_transactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id %1$s NOT NULL,
            delta INTEGER NOT NULL,
            reason TEXT NOT NULL,
            reference_id UUID,
            balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT fk_coin_transactions_user FOREIGN KEY (user_id)
                REFERENCES public.users(user_id) ON DELETE RESTRICT
        );
    $sql$, users_user_id_type);
END $$;

CREATE INDEX IF NOT EXISTS idx_ticket_transactions_user_created_at_desc
    ON public.ticket_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_created_at_desc
    ON public.coin_transactions (user_id, created_at DESC);

ALTER TABLE IF EXISTS public.ticket_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.coin_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_ticket_transactions_select_owner ON public.ticket_transactions;
DROP POLICY IF EXISTS p_ticket_transactions_deny_insert_authenticated ON public.ticket_transactions;
DROP POLICY IF EXISTS p_ticket_transactions_deny_update_authenticated ON public.ticket_transactions;
DROP POLICY IF EXISTS p_ticket_transactions_deny_delete_authenticated ON public.ticket_transactions;
DROP POLICY IF EXISTS p_coin_transactions_select_owner ON public.coin_transactions;
DROP POLICY IF EXISTS p_coin_transactions_deny_insert_authenticated ON public.coin_transactions;
DROP POLICY IF EXISTS p_coin_transactions_deny_update_authenticated ON public.coin_transactions;
DROP POLICY IF EXISTS p_coin_transactions_deny_delete_authenticated ON public.coin_transactions;

CREATE POLICY p_ticket_transactions_select_owner
    ON public.ticket_transactions
    FOR SELECT
    TO authenticated
    USING (user_id::text = public.request_user_key());

CREATE POLICY p_coin_transactions_select_owner
    ON public.coin_transactions
    FOR SELECT
    TO authenticated
    USING (user_id::text = public.request_user_key());

-- Ledger rows are append-only and written EXCLUSIVELY by
-- apply_ticket_transaction()/apply_coin_transaction() (SECURITY DEFINER,
-- service_role-only EXECUTE) below — never directly by authenticated
-- clients.
CREATE POLICY p_ticket_transactions_deny_insert_authenticated
    ON public.ticket_transactions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY p_ticket_transactions_deny_update_authenticated
    ON public.ticket_transactions AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY p_ticket_transactions_deny_delete_authenticated
    ON public.ticket_transactions AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

CREATE POLICY p_coin_transactions_deny_insert_authenticated
    ON public.coin_transactions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY p_coin_transactions_deny_update_authenticated
    ON public.coin_transactions AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY p_coin_transactions_deny_delete_authenticated
    ON public.coin_transactions AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

-- The ONLY sanctioned way to change `users.tickets` — mirrors
-- `apply_point_transaction` exactly (same locking/negative-balance/
-- hardening pattern).
CREATE OR REPLACE FUNCTION public.apply_ticket_transaction(
    p_user_id TEXT,
    p_delta INTEGER,
    p_reason TEXT,
    p_reference_id UUID DEFAULT NULL
) RETURNS public.ticket_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_tickets INTEGER;
    v_next_tickets INTEGER;
    v_transaction public.ticket_transactions;
    -- P-AUTH-05B-2B.2 hotfix: see apply_point_transaction's identical fix
    -- in 20260816000100_point_transactions_ledger.sql for the full
    -- rationale (text->uuid via %TYPE assignment, since
    -- ticket_transactions.user_id was dynamically matched to
    -- users.user_id's real type, confirmed uuid on the real project).
    v_user_id public.ticket_transactions.user_id%TYPE;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'apply_ticket_transaction: p_user_id is required';
    END IF;

    v_user_id := p_user_id;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'apply_ticket_transaction: p_reason is required';
    END IF;

    SELECT tickets INTO v_current_tickets
      FROM public.users
     WHERE user_id::text = p_user_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'apply_ticket_transaction: user % not found', p_user_id;
    END IF;

    v_next_tickets := COALESCE(v_current_tickets, 0) + p_delta;

    IF v_next_tickets < 0 THEN
        RAISE EXCEPTION 'apply_ticket_transaction: resulting balance would be negative (user=%, delta=%)', p_user_id, p_delta;
    END IF;

    UPDATE public.users
       SET tickets = v_next_tickets,
           updated_at = NOW()
     WHERE user_id::text = p_user_id;

    INSERT INTO public.ticket_transactions (user_id, delta, reason, reference_id, balance_after)
    VALUES (v_user_id, p_delta, p_reason, p_reference_id, v_next_tickets)
    RETURNING * INTO v_transaction;

    RETURN v_transaction;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ticket_transaction(TEXT, INTEGER, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_ticket_transaction(TEXT, INTEGER, TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.apply_ticket_transaction(TEXT, INTEGER, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ticket_transaction(TEXT, INTEGER, TEXT, UUID) TO service_role;

-- The ONLY sanctioned way to change `users.coins` — mirrors
-- `apply_point_transaction` exactly.
CREATE OR REPLACE FUNCTION public.apply_coin_transaction(
    p_user_id TEXT,
    p_delta INTEGER,
    p_reason TEXT,
    p_reference_id UUID DEFAULT NULL
) RETURNS public.coin_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_coins INTEGER;
    v_next_coins INTEGER;
    v_transaction public.coin_transactions;
    -- P-AUTH-05B-2B.2 hotfix: see apply_point_transaction's identical fix
    -- in 20260816000100_point_transactions_ledger.sql for the full
    -- rationale.
    v_user_id public.coin_transactions.user_id%TYPE;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'apply_coin_transaction: p_user_id is required';
    END IF;

    v_user_id := p_user_id;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'apply_coin_transaction: p_reason is required';
    END IF;

    SELECT coins INTO v_current_coins
      FROM public.users
     WHERE user_id::text = p_user_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'apply_coin_transaction: user % not found', p_user_id;
    END IF;

    v_next_coins := COALESCE(v_current_coins, 0) + p_delta;

    IF v_next_coins < 0 THEN
        RAISE EXCEPTION 'apply_coin_transaction: resulting balance would be negative (user=%, delta=%)', p_user_id, p_delta;
    END IF;

    UPDATE public.users
       SET coins = v_next_coins,
           updated_at = NOW()
     WHERE user_id::text = p_user_id;

    INSERT INTO public.coin_transactions (user_id, delta, reason, reference_id, balance_after)
    VALUES (v_user_id, p_delta, p_reason, p_reference_id, v_next_coins)
    RETURNING * INTO v_transaction;

    RETURN v_transaction;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_coin_transaction(TEXT, INTEGER, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_coin_transaction(TEXT, INTEGER, TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.apply_coin_transaction(TEXT, INTEGER, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_coin_transaction(TEXT, INTEGER, TEXT, UUID) TO service_role;

-- One-time backfill (same strategy as point_transactions): record EVERY
-- existing user's current tickets/coins balance as an opening ledger
-- entry. Only INSERTs new rows; never modifies `users.tickets`/
-- `users.coins`. Safe to re-run (skips users who already have a
-- 'ledger_backfill' row).
DO $$
BEGIN
    IF to_regclass('public.users') IS NOT NULL THEN
        -- P-AUTH-05B-2B.2 hotfix: NO cast — see point_transactions'
        -- identical fix for the full rationale.
        INSERT INTO public.ticket_transactions (user_id, delta, reason, balance_after)
        SELECT u.user_id, COALESCE(u.tickets, 0), 'ledger_backfill', COALESCE(u.tickets, 0)
          FROM public.users u
         WHERE NOT EXISTS (
                SELECT 1 FROM public.ticket_transactions tt
                 WHERE tt.user_id::text = u.user_id::text
                   AND tt.reason = 'ledger_backfill'
               );

        INSERT INTO public.coin_transactions (user_id, delta, reason, balance_after)
        SELECT u.user_id, COALESCE(u.coins, 0), 'ledger_backfill', COALESCE(u.coins, 0)
          FROM public.users u
         WHERE NOT EXISTS (
                SELECT 1 FROM public.coin_transactions ct
                 WHERE ct.user_id::text = u.user_id::text
                   AND ct.reason = 'ledger_backfill'
               );
    END IF;
END $$;
