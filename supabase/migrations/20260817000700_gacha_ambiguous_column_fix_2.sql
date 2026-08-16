-- P-AUTH-05C Hotfix (2): fix a SECOND ambiguous column reference in
-- claim_gacha_draw, found immediately after applying
-- 20260817000600_gacha_gift_ambiguous_column_fix.sql (which fixed the
-- `mascots` table read but missed this one).
--
-- ROOT CAUSE (same class as 20260817000600 — see its header for the full
-- explanation of why `RETURNS TABLE(...)` makes every OUT column name an
-- implicit PL/pgSQL variable for the WHOLE function body): the lookup
-- `SELECT * INTO v_existing_mascot FROM public.user_mascots WHERE user_id
-- = p_user_id AND mascot_id = v_mascot.id FOR UPDATE` references bare
-- `mascot_id`, which collides with claim_gacha_draw's own `mascot_id` OUT
-- column.
--
-- THIS FILE DOES NOT MODIFY any prior migration — `CREATE OR REPLACE
-- FUNCTION` supersedes `claim_gacha_draw`'s body again with the SAME
-- signature. `redeem_gift_transaction` is NOT touched here (already fully
-- fixed by 20260817000600 — re-verified: it has no remaining bare
-- reference to any of its own OUT column names anywhere in its body).
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: pure function-body fix, same
-- signature, same grants.
-- APPLIED to the staging project as part of the 05C wallet-ops CORS
-- hotfix (see review-auth-05C-wallet-ops-cors-hotfix.md).

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
    user_points INTEGER,
    user_tickets INTEGER,
    user_coins INTEGER
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

    -- Hotfix (2): `um.` alias qualifies every column — never ambiguous
    -- with the RETURNS TABLE OUT parameter `mascot_id`.
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
