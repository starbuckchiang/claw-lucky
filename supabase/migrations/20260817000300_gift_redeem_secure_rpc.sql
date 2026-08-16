-- P-AUTH-05B-2A: Gift Redemption Secure Atomic RPC
--
-- Requirement 4: "禮物兌換必須鎖定users與gift資料，驗證points/tickets/coins
-- 餘額，扣款、redeem_history及必要獎勵在單一交易完成；失敗全部rollback。"
--
-- Today (`js/api.js` + `js/gift.js`, BROWSER anon-key context):
--   1. `Api.redeemGift({pointsCost, ticketsCost, coinsCost, giftName, ...})`
--      — the CLIENT computes and sends the cost values itself (read from a
--      gift object the client already fetched) — a malicious caller can
--      call this directly with `pointsCost:0, ticketsCost:0, giftId:
--      '<expensive-item>'` from devtools and redeem ANY item for FREE.
--      Internally this calls `adjustBalance()` (a SEPARATE, non-atomic
--      UPDATE) then `addRedeemHistory()` (ANOTHER separate INSERT).
--   2. `Api.decreaseGiftStock(giftId, 1)` — a THIRD, entirely separate call
--      the page makes AFTER `redeemGift()` resolves; no locking, a race
--      between two concurrent redemptions of the last unit of stock can
--      both "succeed" (oversell).
-- None of these three steps are atomic or protected by row locks.
--
-- `redeem_gift_transaction()` below replaces all of this with ONE
-- SECURITY DEFINER transaction: the caller supplies ONLY `p_user_id` (from
-- the Edge Function's JWT-verified identity, NEVER the request body) +
-- `p_gift_id` + `p_idempotency_key`. `points_cost`/`tickets_cost`/
-- `coins_cost`/`gift_name` are ALWAYS read from `public.gifts` itself
-- (locked `FOR UPDATE`) — the client's opinion of the cost is never read
-- anywhere in this function. Stock decrement, balance deduction, and the
-- `redeem_history` insert all happen in the SAME transaction as each
-- other — if ANY step fails (insufficient balance, out of stock, etc.)
-- the whole thing rolls back, including any ledger writes already
-- attempted earlier in the same call.
--
-- Idempotency: `gift_redemption_requests` (UNIQUE `idempotency_key`),
-- mirroring `gacha_draw_requests`'s pattern exactly, including the
-- ownership check on resend (P-AUTH-05A.1 lesson — a cached row belonging
-- to a different user_id is never returned to another caller).
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: additive-only (one new table, one new
-- function); no existing table/column/row is modified.
-- ROLLBACK (manual):
--   REVOKE EXECUTE ON FUNCTION public.redeem_gift_transaction(TEXT, TEXT, TEXT) FROM service_role;
--   DROP FUNCTION IF EXISTS public.redeem_gift_transaction(TEXT, TEXT, TEXT);
--   DROP TABLE IF EXISTS public.gift_redemption_requests;
-- NOT APPLIED by this task (P-AUTH-05B-2A requirement 10).

CREATE TABLE IF NOT EXISTS public.gift_redemption_requests (
    idempotency_key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    gift_id TEXT NOT NULL,
    redeem_history_id UUID,
    points_cost INTEGER NOT NULL,
    tickets_cost INTEGER NOT NULL,
    coins_cost INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gift_redemption_requests_user_created_at_desc
    ON public.gift_redemption_requests (user_id, created_at DESC);

ALTER TABLE IF EXISTS public.gift_redemption_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_gift_redemption_requests_select_owner ON public.gift_redemption_requests;
DROP POLICY IF EXISTS p_gift_redemption_requests_deny_write_authenticated ON public.gift_redemption_requests;

CREATE POLICY p_gift_redemption_requests_select_owner
    ON public.gift_redemption_requests
    FOR SELECT
    TO authenticated
    USING (user_id = public.request_user_key());

-- Written EXCLUSIVELY by redeem_gift_transaction() (SECURITY DEFINER,
-- service_role-only EXECUTE) below.
CREATE POLICY p_gift_redemption_requests_deny_write_authenticated
    ON public.gift_redemption_requests
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

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
    user_points INTEGER,
    user_tickets INTEGER,
    user_coins INTEGER
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

    -- Idempotency lookup FIRST, ownership-checked (P-AUTH-05A.1 lesson).
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

    -- Lock BOTH the user row and the gift row for the whole transaction
    -- (requirement 4: "必須鎖定 users 與 gift 資料").
    SELECT * INTO v_user FROM public.users WHERE user_id::text = p_user_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'redeem_gift_transaction: user % not found', p_user_id;
    END IF;

    SELECT id, name, points_cost, tickets_cost, coins_cost, stock, enabled INTO v_gift
      FROM public.gifts
     WHERE id = p_gift_id
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
