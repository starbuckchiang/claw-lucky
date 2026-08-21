-- gift-redeem-refresh-hotfix: fixes a CRITICAL, currently-live production
-- bug that makes EVERY gift redemption fail at the database layer.
--
-- REPORTED SYMPTOM: on gift.html, after clicking "立即兌換", the redeem
-- record never appears and points/tickets never refresh.
--
-- ROOT CAUSE (confirmed live via a read-only, rollback-wrapped
-- `supabase db query --linked "BEGIN; SELECT * FROM
-- public.redeem_gift_transaction(...); ROLLBACK;"` call against a real
-- user + a real enabled gift — zero data was written, this was a
-- diagnostic-only call):
--   `redeem_gift_transaction()` (from `20260817000300_gift_redeem_secure_rpc.sql`,
--   last redefined by `20260817000800_gacha_gift_bigint_balance_fix.sql`)
--   declares `v_redeem_id UUID;` and does
--     `INSERT INTO public.redeem_history (...) RETURNING id INTO v_redeem_id;`
--   but `public.redeem_history.id` is REALLY `bigint` (confirmed via
--   `information_schema.columns`), not `uuid`. This assignment fails at
--   runtime with:
--     ERROR: 22P02: invalid input syntax for type uuid: "23"
--   Because the whole function body executes as ONE Postgres
--   transaction, this error rolls back EVERYTHING already done in the
--   SAME call (points/tickets/coins deduction, `gifts.stock` decrement,
--   the `redeem_history` INSERT itself, and the
--   `gift_redemption_requests` INSERT) — nothing is left partially
--   written (confirmed: the diagnostic call left `users.points`,
--   `gifts.stock`, and both tables' row counts completely unchanged).
--   This is Diagnosis Case B ("DB完全未寫入，API呼叫失敗") — every real
--   gift-redeem call since `20260817000800` was applied has returned an
--   error to the frontend and written NOTHING, matching the reported
--   symptom exactly. Confirmed via read-only counts at authoring time:
--   `public.gift_redemption_requests` has 0 rows; `public.redeem_history`
--   has 17 rows, ALL with `created_at` before this migration set was ever
--   applied (legacy rows from the pre-P-AUTH-05B-2A direct-write flow,
--   not evidence of any successful call to this function).
--
-- The SAME wrong assumption exists in the `gift_redemption_requests`
-- TABLE's own `redeem_history_id` column (declared `UUID` in
-- `20260817000300_gift_redeem_secure_rpc.sql`, never altered since) and in
-- the function's `RETURNS TABLE (redeem_history_id UUID, ...)` signature
-- and its idempotency-cache read branch (`v_cached.redeem_history_id`) —
-- ALL of these must become `BIGINT` together for the function to ever
-- successfully insert/return a real `redeem_history.id` value.
--
-- Confirmed via `information_schema.columns` at authoring time:
-- `public.gift_redemption_requests` has exactly 0 rows, so the column
-- type ALTER below is a pure, lossless type change (nothing to migrate).
--
-- THIS FILE DOES NOT MODIFY any already-applied migration file. Postgres
-- requires `DROP FUNCTION` before `CREATE OR REPLACE FUNCTION` when the
-- RETURN TYPE changes (same precedent as `20260817000800`), so this
-- migration explicitly drops the existing signature before recreating
-- it. The function's PARAMETER list is UNCHANGED — every existing caller
-- (`js/services/wallet/wallet-ops-repository.js`'s `redeemGift()`) is
-- unaffected.
--
-- SCOPE: ONLY the `redeem_history_id` type is changed (UUID -> BIGINT),
-- everywhere it appears (table column, RETURNS TABLE column, the
-- idempotency-cache SELECT, the DECLARE'd variable, and the final INSERT/
-- RETURN QUERY). No other column, business rule, lock order, grant, or
-- RLS policy in this migration set is touched — this is a pure type-
-- mismatch bug fix, not a refactor.
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: the table has 0 rows, so the column
-- type ALTER cannot lose data. The function change only WIDENS what was a
-- permanently-broken call path (every call before this fix already
-- errored 100% of the time) into a working one — no existing successful
-- caller behavior can regress.
-- ROLLBACK (manual, before this is applied to any real database):
--   simply do not apply this file. After it IS applied, rolling back
--   would mean re-introducing the confirmed-broken UUID version, which is
--   never correct — a genuine rollback should instead re-apply this same
--   BIGINT fix under a later migration if ever needed again.
--
-- NOT APPLIED / NOT DEPLOYED by this task (gift-redeem-refresh-hotfix:
-- local preparation + structural tests only, per instruction — this is a
-- database migration and requires separate, explicit approval before
-- `supabase db push`).

-- gift_redemption_requests has 0 rows at authoring time (verified via
-- `supabase db query --linked "SELECT COUNT(*) FROM
-- public.gift_redemption_requests"`) — `USING NULL::bigint` is used
-- instead of attempting any per-row cast, since there is deliberately
-- nothing to migrate.
ALTER TABLE public.gift_redemption_requests
    ALTER COLUMN redeem_history_id TYPE BIGINT USING NULL::bigint;

DROP FUNCTION IF EXISTS public.redeem_gift_transaction(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.redeem_gift_transaction(
    p_user_id TEXT,
    p_gift_id TEXT,
    p_idempotency_key TEXT
) RETURNS TABLE (
    redeem_history_id BIGINT,
    gift_id TEXT,
    gift_name TEXT,
    points_cost INTEGER,
    tickets_cost INTEGER,
    coins_cost INTEGER,
    user_points BIGINT,
    user_tickets BIGINT,
    user_coins BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cached public.gift_redemption_requests;
    v_user public.users;
    v_gift RECORD;
    v_redeem_id BIGINT;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'redeem_gift_transaction: p_user_id is required';
    END IF;

    IF p_gift_id IS NULL OR btrim(p_gift_id) = '' THEN
        RAISE EXCEPTION 'redeem_gift_transaction: p_gift_id is required';
    END IF;

    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'redeem_gift_transaction: p_idempotency_key is required';
    END IF;

    SELECT * INTO v_cached FROM public.gift_redemption_requests WHERE idempotency_key = p_idempotency_key FOR UPDATE;

    IF FOUND THEN
        IF v_cached.user_id <> p_user_id THEN
            RAISE EXCEPTION 'redeem_gift_transaction: idempotency key does not belong to this user';
        END IF;

        RETURN QUERY SELECT
            v_cached.redeem_history_id, v_cached.gift_id, rh.gift_name,
            v_cached.points_cost, v_cached.tickets_cost, v_cached.coins_cost,
            u.points, u.tickets, u.coins
        FROM public.users u
        LEFT JOIN public.redeem_history rh ON rh.id = v_cached.redeem_history_id
        WHERE u.user_id::text = p_user_id;
        RETURN;
    END IF;

    SELECT * INTO v_user FROM public.users WHERE user_id::text = p_user_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'redeem_gift_transaction: user % not found', p_user_id;
    END IF;

    SELECT g.id, g.name, g.points_cost, g.tickets_cost, g.coins_cost, g.stock, g.enabled INTO v_gift
      FROM public.gifts g
     WHERE g.id = p_gift_id
       FOR UPDATE;

    IF NOT FOUND OR v_gift.enabled IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'redeem_gift_transaction: gift % not found or not enabled', p_gift_id;
    END IF;

    IF COALESCE(v_gift.stock, 0) <= 0 THEN
        RAISE EXCEPTION 'redeem_gift_transaction: gift % is out of stock', p_gift_id;
    END IF;

    IF COALESCE(v_user.points, 0) < COALESCE(v_gift.points_cost, 0) THEN
        RAISE EXCEPTION 'redeem_gift_transaction: insufficient points (user=%, required=%)', p_user_id, v_gift.points_cost;
    END IF;

    IF COALESCE(v_user.tickets, 0) < COALESCE(v_gift.tickets_cost, 0) THEN
        RAISE EXCEPTION 'redeem_gift_transaction: insufficient tickets (user=%, required=%)', p_user_id, v_gift.tickets_cost;
    END IF;

    IF COALESCE(v_user.coins, 0) < COALESCE(v_gift.coins_cost, 0) THEN
        RAISE EXCEPTION 'redeem_gift_transaction: insufficient coins (user=%, required=%)', p_user_id, v_gift.coins_cost;
    END IF;

    IF COALESCE(v_gift.points_cost, 0) <> 0 THEN
        PERFORM public.apply_point_transaction(p_user_id, -v_gift.points_cost, 'gift_redeem', NULL);
    END IF;

    IF COALESCE(v_gift.tickets_cost, 0) <> 0 THEN
        PERFORM public.apply_ticket_transaction(p_user_id, -v_gift.tickets_cost, 'gift_redeem', NULL);
    END IF;

    IF COALESCE(v_gift.coins_cost, 0) <> 0 THEN
        PERFORM public.apply_coin_transaction(p_user_id, -v_gift.coins_cost, 'gift_redeem', NULL);
    END IF;

    UPDATE public.gifts
       SET stock = stock - 1,
           updated_at = NOW()
     WHERE id = p_gift_id;

    INSERT INTO public.redeem_history (
        user_id, nickname, gift_id, gift_name, quantity, points_cost, tickets_cost, coins_cost, status, note, created_at, updated_at
    ) VALUES (
        p_user_id, COALESCE(v_user.nickname, ''), v_gift.id, v_gift.name, 1,
        COALESCE(v_gift.points_cost, 0), COALESCE(v_gift.tickets_cost, 0), COALESCE(v_gift.coins_cost, 0),
        'completed', '兌換禮物：' || v_gift.name, NOW(), NOW()
    ) RETURNING id INTO v_redeem_id;

    INSERT INTO public.gift_redemption_requests (
        idempotency_key, user_id, gift_id, redeem_history_id, points_cost, tickets_cost, coins_cost
    ) VALUES (
        p_idempotency_key, p_user_id, v_gift.id, v_redeem_id,
        COALESCE(v_gift.points_cost, 0), COALESCE(v_gift.tickets_cost, 0), COALESCE(v_gift.coins_cost, 0)
    );

    RETURN QUERY SELECT
        v_redeem_id, v_gift.id, v_gift.name,
        COALESCE(v_gift.points_cost, 0), COALESCE(v_gift.tickets_cost, 0), COALESCE(v_gift.coins_cost, 0),
        u.points, u.tickets, u.coins
    FROM public.users u WHERE u.user_id::text = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_gift_transaction(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_gift_transaction(TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.redeem_gift_transaction(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_gift_transaction(TEXT, TEXT, TEXT) TO service_role;
