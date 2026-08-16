-- P-AUTH-05A: Existing Account Merge Security Foundation
-- Points Ledger (requirement 3): specs/003-spec-auth-subscription.md
-- Section 7 requires Points to be merged via a TRANSACTION RECORD, never a
-- raw sum. Today NO such ledger exists — `js/services/wallpaper/
-- points-repository.js`'s `deductPoints()` (Edge Function/service-role
-- context) and `js/api.js`'s `adjustBalance()` (BROWSER anon-key context)
-- both read `users.points`, do client-side arithmetic, then UPDATE the raw
-- column directly, with no audit trail and no way to safely combine two
-- accounts' points without risking a double-count or a lost update race.
--
-- This migration creates the ledger table plus the ONLY function allowed to
-- both write a ledger row AND update `users.points`, atomically, in one
-- transaction — `public.apply_point_transaction(...)`. Per requirement 6
-- (SECURITY DEFINER hardening) and requirement 3 ("此階段不得加入
-- service-role key 到前端"), this function's EXECUTE privilege is granted
-- ONLY to `service_role` (i.e. only callable from a trusted Edge Function
-- using the service-role key server-side) — never `anon`/`authenticated`.
-- `js/api.js`'s `adjustBalance()` direct-UPDATE pattern is now structurally
-- blocked by the RLS added in 20260816000000 (which denies ALL
-- authenticated UPDATEs on `public.users`) — the follow-up work to move
-- that call site onto an Edge Function calling this RPC is tracked as a
-- Blocker in review-auth-05A.md, NOT implemented here.
--
-- Column-type-agnostic FK (same technique as
-- 20260712040000_create_wallpaper_core_tables.sql): `users`'s primary key
-- column/type is detected dynamically since no live-schema introspection
-- was available when authoring this migration.
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: additive-only (new table, new
-- function); no existing table/column/row is modified. The one-time
-- backfill below only INSERTs new ledger rows, it never touches
-- `users.points` itself.
-- ROLLBACK (manual):
--   REVOKE EXECUTE ON FUNCTION public.apply_point_transaction(TEXT, INTEGER, TEXT, UUID) FROM service_role;
--   DROP FUNCTION IF EXISTS public.apply_point_transaction(TEXT, INTEGER, TEXT, UUID);
--   DROP POLICY IF EXISTS p_point_transactions_select_owner ON public.point_transactions;
--   DROP POLICY IF EXISTS p_point_transactions_deny_insert_authenticated ON public.point_transactions;
--   DROP POLICY IF EXISTS p_point_transactions_deny_update_authenticated ON public.point_transactions;
--   DROP POLICY IF EXISTS p_point_transactions_deny_delete_authenticated ON public.point_transactions;
--   DROP TABLE IF EXISTS public.point_transactions;
-- VERIFICATION (manual): see review-auth-05A.md "手動驗證步驟".

DO $$
DECLARE
    users_user_id_type TEXT;
BEGIN
    -- P-AUTH-05B-2B.2 hotfix: this originally searched for whichever
    -- column is `users`'s actual PRIMARY KEY (guessing it would be named
    -- `user_id` or `id`), on the theory that no live-schema introspection
    -- was available at authoring time. On the real project, `users`'s
    -- true PK is a SEPARATE surrogate column (`id`), while `user_id` (the
    -- real Supabase Auth UID — the column EVERY other table/RPC in this
    -- repo already keys identity on: shop_cart.user_id, orders.user_id,
    -- user_mascots.user_id, redeem_history.user_id, apply_point_transaction's
    -- own `WHERE user_id::text = p_user_id`) is a DIFFERENT, merely
    -- UNIQUE-constrained column. The original dynamic PK search picked
    -- `id` (since that IS the true PK), producing a FOREIGN KEY that
    -- referenced the wrong column entirely — every backfill INSERT then
    -- failed with "Key (user_id)=(...) is not present in table users"
    -- (comparing a real Auth UID against `users.id`, which are unrelated
    -- values). Fixed by targeting `user_id` BY NAME (matching the
    -- established, universal app convention) and dynamically detecting
    -- only its TYPE (still portable across environments where that type
    -- might differ), with an explicit check that it actually carries a
    -- PRIMARY KEY/UNIQUE constraint (required for any FK to reference it)
    -- before creating the table.
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
        RAISE EXCEPTION 'Cannot create point_transactions: public.users.user_id column not found.';
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
        RAISE EXCEPTION 'Cannot create point_transactions: public.users.user_id has no PRIMARY KEY/UNIQUE constraint to reference via foreign key.';
    END IF;

    EXECUTE format($sql$
        CREATE TABLE IF NOT EXISTS public.point_transactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id %1$s NOT NULL,
            delta INTEGER NOT NULL,
            reason TEXT NOT NULL,
            reference_id UUID,
            balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT fk_point_transactions_user FOREIGN KEY (user_id)
                REFERENCES public.users(user_id) ON DELETE RESTRICT
        );
    $sql$, users_user_id_type);
END $$;

CREATE INDEX IF NOT EXISTS idx_point_transactions_user_created_at_desc
    ON public.point_transactions (user_id, created_at DESC);

ALTER TABLE IF EXISTS public.point_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_point_transactions_select_owner ON public.point_transactions;
DROP POLICY IF EXISTS p_point_transactions_deny_insert_authenticated ON public.point_transactions;
DROP POLICY IF EXISTS p_point_transactions_deny_update_authenticated ON public.point_transactions;
DROP POLICY IF EXISTS p_point_transactions_deny_delete_authenticated ON public.point_transactions;

CREATE POLICY p_point_transactions_select_owner
    ON public.point_transactions
    FOR SELECT
    TO authenticated
    USING (user_id::text = public.request_user_key());

-- Ledger rows are append-only and written EXCLUSIVELY by
-- apply_point_transaction() (SECURITY DEFINER, service_role-only EXECUTE)
-- below — never directly by authenticated clients.
CREATE POLICY p_point_transactions_deny_insert_authenticated
    ON public.point_transactions
    AS RESTRICTIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

CREATE POLICY p_point_transactions_deny_update_authenticated
    ON public.point_transactions
    AS RESTRICTIVE
    FOR UPDATE
    TO authenticated
    USING (false)
    WITH CHECK (false);

CREATE POLICY p_point_transactions_deny_delete_authenticated
    ON public.point_transactions
    AS RESTRICTIVE
    FOR DELETE
    TO authenticated
    USING (false);

-- The ONLY sanctioned way to change `users.points`: atomically inserts a
-- ledger row AND updates the running balance in a single transaction
-- (implicit within the function body — if either step fails, both roll
-- back, so the ledger and `users.points` can never drift apart). Rejects a
-- delta that would take the balance negative.
--
-- Hardening (requirement 6):
-- - `SECURITY DEFINER` so it can update `users.points` even though
--   `authenticated`/`anon` have no direct UPDATE grant on that table.
-- - `SET search_path = public, pg_temp` pinned explicitly, so this function
--   can NEVER be tricked by a malicious search_path into resolving
--   `public.users`/`public.point_transactions` to an attacker-controlled
--   object in another schema (the classic SECURITY DEFINER search_path
--   hijack).
-- - EXECUTE is revoked from PUBLIC and only re-granted to `service_role` —
--   `anon`/`authenticated` can NEVER call this directly; it is only
--   reachable from a trusted Edge Function using the service-role key.
CREATE OR REPLACE FUNCTION public.apply_point_transaction(
    p_user_id TEXT,
    p_delta INTEGER,
    p_reason TEXT,
    p_reference_id UUID DEFAULT NULL
) RETURNS public.point_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_points INTEGER;
    v_next_points INTEGER;
    v_transaction public.point_transactions;
    -- P-AUTH-05B-2B.2 hotfix: `point_transactions.user_id`'s type was
    -- dynamically matched to `public.users`'s real PK type at CREATE TABLE
    -- time (see this migration's header) — on the real project that is
    -- `uuid`, NOT `text`. A bare `p_user_id` (declared TEXT) cannot be
    -- inserted directly into a `uuid` column (no implicit/assignment cast
    -- exists from text to uuid in plain SQL). Assigning it to a `%TYPE`
    -- variable first lets PL/pgSQL convert it via the target type's own
    -- input function (succeeds for any valid UUID-formatted string, which
    -- every real caller here always supplies — see auth.uid()-derived
    -- p_user_id at every call site).
    v_user_id public.point_transactions.user_id%TYPE;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'apply_point_transaction: p_user_id is required';
    END IF;

    v_user_id := p_user_id;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'apply_point_transaction: p_reason is required';
    END IF;

    SELECT points INTO v_current_points
      FROM public.users
     WHERE user_id::text = p_user_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'apply_point_transaction: user % not found', p_user_id;
    END IF;

    v_next_points := COALESCE(v_current_points, 0) + p_delta;

    IF v_next_points < 0 THEN
        RAISE EXCEPTION 'apply_point_transaction: resulting balance would be negative (user=%, delta=%)', p_user_id, p_delta;
    END IF;

    UPDATE public.users
       SET points = v_next_points,
           updated_at = NOW()
     WHERE user_id::text = p_user_id;

    INSERT INTO public.point_transactions (user_id, delta, reason, reference_id, balance_after)
    VALUES (v_user_id, p_delta, p_reason, p_reference_id, v_next_points)
    RETURNING * INTO v_transaction;

    RETURN v_transaction;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_point_transaction(TEXT, INTEGER, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_point_transaction(TEXT, INTEGER, TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.apply_point_transaction(TEXT, INTEGER, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_point_transaction(TEXT, INTEGER, TEXT, UUID) TO service_role;

-- One-time backfill: record EVERY existing user's current balance as an
-- opening ledger entry, so `SUM(delta) OVER (PARTITION BY user_id)` matches
-- `users.points` going forward for pre-existing accounts too. This ONLY
-- inserts new `point_transactions` rows — it never modifies `users.points`
-- itself, and is safe to re-run (skips users who already have a
-- 'ledger_backfill' row).
DO $$
BEGIN
    IF to_regclass('public.users') IS NOT NULL THEN
        -- P-AUTH-05B-2B.2 hotfix: NO cast here — `u.user_id`'s NATIVE type
        -- (whatever `public.users`'s real PK type is) always matches
        -- `point_transactions.user_id`'s dynamically-derived type exactly
        -- (see CREATE TABLE above), so passing it through unchanged is the
        -- only truly portable option; an explicit `::text` cast breaks
        -- this whenever the real column type is NOT text (e.g. uuid on
        -- the real project — this is what originally caused this INSERT
        -- to fail with "column \"user_id\" is of type uuid but expression
        -- is of type text").
        INSERT INTO public.point_transactions (user_id, delta, reason, balance_after)
        SELECT u.user_id, COALESCE(u.points, 0), 'ledger_backfill', COALESCE(u.points, 0)
          FROM public.users u
         WHERE NOT EXISTS (
                SELECT 1 FROM public.point_transactions pt
                 WHERE pt.user_id::text = u.user_id::text
                   AND pt.reason = 'ledger_backfill'
               );
    END IF;
END $$;
