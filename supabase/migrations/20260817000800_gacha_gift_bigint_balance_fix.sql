-- P-AUTH-05C Hotfix (3): fix a RETURNS TABLE type mismatch in
-- claim_gacha_draw / redeem_gift_transaction, found immediately after
-- fixing the ambiguous-column bugs (20260817000600/700) during live
-- wallet-ops staging verification.
--
-- ROOT CAUSE: both functions declare `user_points INTEGER, user_tickets
-- INTEGER, user_coins INTEGER` in their `RETURNS TABLE(...)` signature,
-- populated from `public.users.points/tickets/coins` — those THREE
-- columns are actually `bigint` on the real project (confirmed via
-- `information_schema.columns`), not `integer`. Postgres enforces an
-- EXACT type match between a `RETURN QUERY SELECT ...`'s projected column
-- types and the function's declared `RETURNS TABLE` types — a bigint
-- value is NOT automatically narrowed to fit an `integer` OUT column, so
-- every call failed at RUNTIME with:
--   ERROR: structure of query does not match function result type
--   DETAIL: Returned type bigint does not match expected type integer in
--   column 10.
-- (Same class of "invisible until executed against a real Postgres
-- instance" bug as 20260817000600/700 — this repo has no local Postgres
-- to catch it earlier.)
--
-- FIX: change `user_points`/`user_tickets`/`user_coins` from `INTEGER` to
-- `BIGINT` in both functions' `RETURNS TABLE(...)` signatures. No other
-- column changes — `points_cost`/`tickets_cost`/`coins_cost` (from
-- `public.gifts`) and `points_earned`/`tickets_earned`/`duplicate_bonus`
-- (from `public.mascots`) were verified via the SAME
-- `information_schema.columns` query to genuinely be `integer` on the
-- real project — those are correct as-is and are NOT changed here.
--
-- THIS FILE DOES NOT MODIFY any prior migration. `CREATE OR REPLACE
-- FUNCTION` cannot change a function's RETURN TYPE in place (Postgres
-- requires `DROP FUNCTION` first when the return type changes, even for
-- `CREATE OR REPLACE`) — so this migration explicitly `DROP FUNCTION`s
-- both old signatures before recreating them. Parameter lists are
-- UNCHANGED (only the RETURNS TABLE column types changed), so every
-- existing caller (the `wallet-ops` handler/repository) is unaffected —
-- same function names, same input parameters.
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: pure function-signature fix (OUT
-- column type widening only); no table/schema change.
-- APPLIED to the staging project as part of the 05C wallet-ops CORS
-- hotfix (see review-auth-05C-wallet-ops-cors-hotfix.md).

DROP FUNCTION IF EXISTS public.claim_gacha_draw(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.claim_gacha_draw(
    p_user_id TEXT,
    p_idempotency_key TEXT
) RETURNS TABLE (
    mascot_id TEXT,
    mascot_name TEXT,
    rarity TEXT,
    image TEXT,
    is_new BOOLEAN,
    points_earned INTEGER,
    tickets_earned INTEGER,
    obtain_count_after INTEGER,
    coins_delta INTEGER,
    user_points BIGINT,
    user_tickets BIGINT,
    user_coins BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cached public.gacha_draw_requests;
    v_user public.users;
    v_total_rate NUMERIC;
    v_roll NUMERIC;
    v_rarity_row RECORD;
    v_rarity_code TEXT;
    v_mascot RECORD;
    v_existing_mascot public.user_mascots;
    v_is_new BOOLEAN;
    v_points_earned INTEGER;
    v_tickets_earned INTEGER;
    v_upserted public.user_mascots;
    v_draw_cost CONSTANT INTEGER := 1;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'claim_gacha_draw: p_user_id is required';
    END IF;

    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'claim_gacha_draw: p_idempotency_key is required';
    END IF;

    SELECT * INTO v_cached FROM public.gacha_draw_requests WHERE idempotency_key = p_idempotency_key FOR UPDATE;

    IF FOUND THEN
        IF v_cached.user_id <> p_user_id THEN
            RAISE EXCEPTION 'claim_gacha_draw: idempotency key does not belong to this user';
        END IF;

        RETURN QUERY SELECT
            v_cached.mascot_id, v_cached.mascot_name, v_cached.rarity, v_cached.image,
            v_cached.is_new, v_cached.points_earned, v_cached.tickets_earned,
            v_cached.obtain_count_after, v_cached.coins_delta,
            u.points, u.tickets, u.coins
        FROM public.users u WHERE u.user_id::text = p_user_id;
        RETURN;
    END IF;

    SELECT * INTO v_user FROM public.users WHERE user_id::text = p_user_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'claim_gacha_draw: user % not found', p_user_id;
    END IF;

    IF COALESCE(v_user.coins, 0) < v_draw_cost THEN
        RAISE EXCEPTION 'claim_gacha_draw: insufficient coins (user=%, coins=%)', p_user_id, v_user.coins;
    END IF;

    SELECT SUM(rate) INTO v_total_rate FROM public.mascot_rarities;

    IF v_total_rate IS NULL OR v_total_rate <= 0 THEN
        RAISE EXCEPTION 'claim_gacha_draw: no rarity weights configured';
    END IF;

    v_roll := random() * v_total_rate;
    v_rarity_code := NULL;

    FOR v_rarity_row IN SELECT rarity_code, rate FROM public.mascot_rarities ORDER BY sort_order LOOP
        v_roll := v_roll - v_rarity_row.rate;
        IF v_roll < 0 THEN
            v_rarity_code := v_rarity_row.rarity_code;
            EXIT;
        END IF;
    END LOOP;

    IF v_rarity_code IS NULL THEN
        SELECT rarity_code INTO v_rarity_code FROM public.mascot_rarities ORDER BY sort_order DESC LIMIT 1;
    END IF;

    SELECT m.id, m.name, m.points, m.tickets, m.duplicate_bonus, m.image, m.rarity INTO v_mascot
      FROM public.mascots m
     WHERE m.rarity = v_rarity_code AND m.enabled = true
     ORDER BY random()
     LIMIT 1;

    IF NOT FOUND THEN
        SELECT m.id, m.name, m.points, m.tickets, m.duplicate_bonus, m.image, m.rarity INTO v_mascot
          FROM public.mascots m
         WHERE m.enabled = true
         ORDER BY random()
         LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'claim_gacha_draw: no enabled mascots available';
        END IF;
    END IF;

    SELECT * INTO v_existing_mascot
      FROM public.user_mascots um
     WHERE um.user_id = p_user_id AND um.mascot_id = v_mascot.id
       FOR UPDATE;

    v_is_new := NOT FOUND;

    IF v_is_new THEN
        v_points_earned := COALESCE(v_mascot.points, 0);
        v_tickets_earned := COALESCE(v_mascot.tickets, 0);
    ELSE
        v_points_earned := COALESCE(v_mascot.duplicate_bonus, 0);
        v_tickets_earned := 0;
    END IF;

    PERFORM public.apply_coin_transaction(p_user_id, -v_draw_cost, 'gacha_draw', NULL);

    IF v_points_earned <> 0 THEN
        PERFORM public.apply_point_transaction(p_user_id, v_points_earned, 'gacha_draw', NULL);
    END IF;

    IF v_tickets_earned <> 0 THEN
        PERFORM public.apply_ticket_transaction(p_user_id, v_tickets_earned, 'gacha_draw', NULL);
    END IF;

    v_upserted := public.upsert_user_mascot_obtain(p_user_id, v_mascot.id, v_mascot.name, v_mascot.rarity, v_mascot.image);

    INSERT INTO public.gacha_draw_requests (
        idempotency_key, user_id, mascot_id, mascot_name, rarity, image,
        is_new, points_earned, tickets_earned, obtain_count_after, coins_delta
    ) VALUES (
        p_idempotency_key, p_user_id, v_mascot.id, COALESCE(v_mascot.name, ''), COALESCE(v_mascot.rarity, ''), COALESCE(v_mascot.image, ''),
        v_is_new, v_points_earned, v_tickets_earned, v_upserted.obtain_count, -v_draw_cost
    );

    RETURN QUERY SELECT
        v_mascot.id, COALESCE(v_mascot.name, ''), COALESCE(v_mascot.rarity, ''), COALESCE(v_mascot.image, ''),
        v_is_new, v_points_earned, v_tickets_earned, v_upserted.obtain_count, -v_draw_cost,
        u.points, u.tickets, u.coins
    FROM public.users u WHERE u.user_id::text = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_gacha_draw(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_gacha_draw(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.claim_gacha_draw(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_gacha_draw(TEXT, TEXT) TO service_role;

DROP FUNCTION IF EXISTS public.redeem_gift_transaction(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.redeem_gift_transaction(
    p_user_id TEXT,
    p_gift_id TEXT,
    p_idempotency_key TEXT
) RETURNS TABLE (
    redeem_history_id UUID,
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
    v_redeem_id UUID;
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
