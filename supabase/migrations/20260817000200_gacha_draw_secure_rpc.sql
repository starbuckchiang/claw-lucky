-- P-AUTH-05B-2A Hotfix: Gacha Draw Secure Atomic RPC — server-authoritative
-- draw (mascot/rarity/reward decided ENTIRELY server-side)
--
-- Requirement 3 (P-AUTH-05B-2A): "抽扭蛋的扣款、獎勵、mascot累加及紀錄必須在
-- 單一交易內完成；重複請求使用伺服器端idempotency key，不能重複扣款或發獎。"
--
-- HOTFIX requirement 1 (P-AUTH-05B-2A Hotfix): the FIRST version of this
-- migration still accepted a caller-supplied `p_mascot_id` — i.e. the
-- CLIENT-SIDE draw engine (`js/game/gacha-engine.js`'s `Math.random()`)
-- decided WHICH mascot/rarity was drawn, and the RPC merely trusted that
-- choice when computing the reward. This is a real "business authority"
-- vulnerability distinct from (and layered on top of) the reward-amount
-- forgery this migration already closed: a modified client could ALWAYS
-- report the highest-rarity mascot's id, and `claim_gacha_draw` would
-- honestly (but wrongly) grant that reward every single time, without any
-- actual randomness. This hotfix removes `p_mascot_id` from the function
-- signature ENTIRELY — the RPC now rolls its OWN weighted random rarity
-- (against the new `public.mascot_rarities` config table) and picks its
-- OWN random enabled mascot within that rarity (against `public.mascots`),
-- then returns the result. The client's ONLY job is to play an animation
-- and display whatever this call returns — it has NO input into, and NO
-- way to influence, the outcome.
--
-- Today (`js/api.js` + `js/pages/gacha.js`, BROWSER anon-key context,
-- pre-hotfix history): originally THREE separate, non-atomic browser
-- writes trusting client-supplied cost/reward/ownership; P-AUTH-05B-2A
-- collapsed these into one atomic RPC but still trusted a client-supplied
-- `mascotId`. This hotfix closes that remaining gap.
--
-- `claim_gacha_draw()` below: caller supplies ONLY `p_user_id` (from the
-- Edge Function's own JWT-verified identity, NEVER the request body —
-- enforced at the handler layer) + `p_idempotency_key`. The function
-- itself:
--   1. Rolls a weighted-random rarity from `public.mascot_rarities`
--      (`random() * SUM(rate)`, subtract each rarity's rate in turn until
--      the roll goes negative — classic weighted-roulette selection).
--   2. Picks a uniformly random ENABLED mascot within that rarity from
--      `public.mascots` (`ORDER BY random() LIMIT 1`); if that rarity's
--      pool happens to be empty, falls back to a random enabled mascot
--      from ANY rarity (never fails the draw just because one rarity's
--      pool is temporarily empty).
--   3. Looks up that mascot's `points`/`tickets`/`duplicate_bonus` (the
--      CLIENT never supplies or influences these).
--   4. Determines new-vs-duplicate from the ACTUAL (locked) user_mascots
--      row — not a client-supplied flag, not a localStorage cache.
--   5. Awards the reward via the ledger functions, upserts user_mascots,
--      records the idempotent request — all in the SAME transaction.
--
-- Idempotency (requirement 3, unchanged by this hotfix): `gacha_draw_requests`
-- is a dedicated append-only table keyed by `idempotency_key` (UNIQUE). A
-- resend with the SAME key returns the cached original result verbatim (no
-- re-deduction, no re-award, no second `user_mascots` increment, and
-- CRUCIALLY no second random draw) — but ONLY if the cached row's `user_id`
-- matches the caller's OWN verified id (P-AUTH-05A.1 lesson).
--
-- DEPENDENCY (requirement 6, unchanged): the `ON CONFLICT (user_id,
-- mascot_id)` upsert below requires `uq_user_mascots_user_mascot`
-- (20260816000300_user_mascots_dedup_and_unique_constraint.sql) to exist.
-- That migration is NOT applied by this task either (dry-run + backup
-- required first, per its own header) — this migration MUST be deployed
-- to any environment strictly AFTER 20260816000300 has been dry-run,
-- backed up, and applied there (see review-auth-05B-2A-hotfix.md's 05C
-- plan).
--
-- RANDOMNESS NOTE: Postgres's `random()` is NOT cryptographically secure,
-- but this is an acceptable, common choice for a game drop-rate mechanic
-- (not a security-critical secret) — the security property this hotfix
-- actually protects is "the CLIENT cannot choose or influence the
-- outcome", not "the outcome is unpredictable to a privileged database
-- observer".
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: additive-only (one new config table,
-- new columns on an already-unapplied table, function signature change on
-- an already-unapplied function); no APPLIED table/column/row is affected
-- anywhere (this migration itself has never been applied — see repo
-- policy: never rewrite an APPLIED migration; this one simply never
-- reached that stage yet).
-- ROLLBACK (manual):
--   REVOKE EXECUTE ON FUNCTION public.upsert_user_mascot_obtain(TEXT, TEXT, TEXT, TEXT, TEXT) FROM service_role;
--   DROP FUNCTION IF EXISTS public.upsert_user_mascot_obtain(TEXT, TEXT, TEXT, TEXT, TEXT);
--   REVOKE EXECUTE ON FUNCTION public.claim_gacha_draw(TEXT, TEXT) FROM service_role;
--   DROP FUNCTION IF EXISTS public.claim_gacha_draw(TEXT, TEXT);
--   DROP TABLE IF EXISTS public.gacha_draw_requests;
--   DROP TABLE IF EXISTS public.mascot_rarities;
-- NOT APPLIED by this task (P-AUTH-05B-2A / hotfix requirement 8: no
-- deployment until real staging validation).

-- Rarity weight config — mirrors the CLIENT-SIDE `js/data/gacha-data.js`
-- `rarities` table's existing rates EXACTLY (N:62, R:25, SR:10, SSR:3) so
-- moving the roll server-side does not change the game's actual drop
-- rates. Read-only reference data (no user_id column) — RLS is still kept
-- ENABLED per repo policy, with a simple "any authenticated caller may
-- read it" policy (no ownership concept applies to shared config), and
-- writes denied to authenticated (changed only via migration).
CREATE TABLE IF NOT EXISTS public.mascot_rarities (
    rarity_code TEXT PRIMARY KEY,
    rate NUMERIC NOT NULL CHECK (rate > 0),
    sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public.mascot_rarities (rarity_code, rate, sort_order) VALUES
    ('N', 62, 1),
    ('R', 25, 2),
    ('SR', 10, 3),
    ('SSR', 3, 4)
ON CONFLICT (rarity_code) DO NOTHING;

ALTER TABLE IF EXISTS public.mascot_rarities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_mascot_rarities_select_authenticated ON public.mascot_rarities;
DROP POLICY IF EXISTS p_mascot_rarities_deny_write_authenticated ON public.mascot_rarities;

CREATE POLICY p_mascot_rarities_select_authenticated
    ON public.mascot_rarities
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY p_mascot_rarities_deny_write_authenticated
    ON public.mascot_rarities
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

-- gacha_draw_requests: hotfix adds mascot_name/rarity/image so an
-- idempotent resend can return the FULL result deterministically without
-- re-joining `public.mascots` (whose catalog could theoretically change
-- between the original draw and a later resend).
CREATE TABLE IF NOT EXISTS public.gacha_draw_requests (
    idempotency_key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    mascot_id TEXT NOT NULL,
    mascot_name TEXT NOT NULL DEFAULT '',
    rarity TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    is_new BOOLEAN NOT NULL,
    points_earned INTEGER NOT NULL,
    tickets_earned INTEGER NOT NULL,
    obtain_count_after INTEGER NOT NULL,
    coins_delta INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Additive columns for anyone re-running this against a copy of the
-- (never-applied) first draft of this migration.
ALTER TABLE public.gacha_draw_requests ADD COLUMN IF NOT EXISTS mascot_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.gacha_draw_requests ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT '';
ALTER TABLE public.gacha_draw_requests ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_gacha_draw_requests_user_created_at_desc
    ON public.gacha_draw_requests (user_id, created_at DESC);

ALTER TABLE IF EXISTS public.gacha_draw_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_gacha_draw_requests_select_owner ON public.gacha_draw_requests;
DROP POLICY IF EXISTS p_gacha_draw_requests_deny_write_authenticated ON public.gacha_draw_requests;

CREATE POLICY p_gacha_draw_requests_select_owner
    ON public.gacha_draw_requests
    FOR SELECT
    TO authenticated
    USING (user_id = public.request_user_key());

-- Written EXCLUSIVELY by claim_gacha_draw() (SECURITY DEFINER,
-- service_role-only EXECUTE) below.
CREATE POLICY p_gacha_draw_requests_deny_write_authenticated
    ON public.gacha_draw_requests
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

-- Shared mascot-upsert helper: called ONLY from inside claim_gacha_draw()
-- below (hotfix requirement 3 — there is NO standalone public route to
-- this anymore; `Api.upsertUserMascot()` is now a deprecated, always-
-- rejecting stub, see js/api.js). Requires uq_user_mascots_user_mascot
-- (see dependency note above).
CREATE OR REPLACE FUNCTION public.upsert_user_mascot_obtain(
    p_user_id TEXT,
    p_mascot_id TEXT,
    p_mascot_name TEXT DEFAULT '',
    p_rarity TEXT DEFAULT '',
    p_image TEXT DEFAULT ''
) RETURNS public.user_mascots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.user_mascots;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'upsert_user_mascot_obtain: p_user_id is required';
    END IF;

    IF p_mascot_id IS NULL OR btrim(p_mascot_id) = '' THEN
        RAISE EXCEPTION 'upsert_user_mascot_obtain: p_mascot_id is required';
    END IF;

    INSERT INTO public.user_mascots (user_id, mascot_id, mascot_name, rarity, image, obtain_count, first_obtained_at, last_obtained_at)
    VALUES (p_user_id, p_mascot_id, p_mascot_name, p_rarity, p_image, 1, NOW(), NOW())
    ON CONFLICT (user_id, mascot_id) DO UPDATE
        SET mascot_name = COALESCE(NULLIF(EXCLUDED.mascot_name, ''), public.user_mascots.mascot_name),
            rarity = COALESCE(NULLIF(EXCLUDED.rarity, ''), public.user_mascots.rarity),
            image = COALESCE(NULLIF(EXCLUDED.image, ''), public.user_mascots.image),
            obtain_count = public.user_mascots.obtain_count + 1,
            last_obtained_at = NOW()
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_user_mascot_obtain(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_user_mascot_obtain(TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_user_mascot_obtain(TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_user_mascot_obtain(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- Drop the pre-hotfix 3-argument signature if it happens to exist in some
-- intermediate local state (never applied to any real environment, but
-- `CREATE OR REPLACE` cannot change a function's parameter list/types).
DROP FUNCTION IF EXISTS public.claim_gacha_draw(TEXT, TEXT, TEXT);

-- The one atomic Gacha Draw transaction (hotfix: NO p_mascot_id parameter
-- — the draw itself happens HERE). Rolls a weighted-random rarity, picks a
-- random enabled mascot within it, deducts 1 coin, looks up the server-
-- authoritative reward, determines new-vs-duplicate from the ACTUAL
-- user_mascots row (locked), awards points/tickets via the ledger, upserts
-- user_mascots, and records the idempotent request — all in one
-- transaction (any failure rolls back everything, including the coin
-- deduction and the random pick itself).
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

    -- Idempotency lookup FIRST, but ownership-checked (P-AUTH-05A.1
    -- lesson): a cached row belonging to a DIFFERENT user_id must never be
    -- returned to this caller, even if the key happens to match. CRUCIALLY
    -- this means a resend NEVER re-rolls the random draw.
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

    -- Lock the user row for the whole transaction (balance check + ledger
    -- updates must be consistent with each other).
    SELECT * INTO v_user FROM public.users WHERE user_id::text = p_user_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'claim_gacha_draw: user % not found', p_user_id;
    END IF;

    IF COALESCE(v_user.coins, 0) < v_draw_cost THEN
        RAISE EXCEPTION 'claim_gacha_draw: insufficient coins (user=%, coins=%)', p_user_id, v_user.coins;
    END IF;

    -- Hotfix requirement 1: roll the rarity SERVER-SIDE — the client has
    -- no input into this whatsoever. Weighted-roulette selection: roll a
    -- random value in [0, SUM(rate)), then walk the ordered rarity list
    -- subtracting each rate until the remainder goes negative.
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
        -- Floating-point edge case (roll landed exactly on the boundary) —
        -- fall back to the last configured rarity rather than failing the
        -- draw.
        SELECT rarity_code INTO v_rarity_code FROM public.mascot_rarities ORDER BY sort_order DESC LIMIT 1;
    END IF;

    -- Pick a uniformly random ENABLED mascot within the rolled rarity.
    SELECT id, name, points, tickets, duplicate_bonus, image, rarity INTO v_mascot
      FROM public.mascots
     WHERE rarity = v_rarity_code AND enabled = true
     ORDER BY random()
     LIMIT 1;

    IF NOT FOUND THEN
        -- That rarity's pool is empty right now — fall back to ANY
        -- enabled mascot rather than failing the draw outright.
        SELECT id, name, points, tickets, duplicate_bonus, image, rarity INTO v_mascot
          FROM public.mascots
         WHERE enabled = true
         ORDER BY random()
         LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'claim_gacha_draw: no enabled mascots available';
        END IF;
    END IF;

    -- Determine new-vs-duplicate from the ACTUAL row (locked so a
    -- concurrent draw of the SAME mascot can't race past this check).
    SELECT * INTO v_existing_mascot
      FROM public.user_mascots
     WHERE user_id = p_user_id AND mascot_id = v_mascot.id
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

