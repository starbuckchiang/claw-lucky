-- PROD-RELEASE-DAY3C: membership-aware wallpaper generation quota.
-- Confirmed rule (do not alter without new instruction):
--   - Free (non-paid) users: 3 generations TOTAL, ever, usable only within
--     30 days of the FIRST time this gate is ever evaluated for that user
--     (lazily anchors the trial window — this repo has no confirmed
--     `users.created_at` column to anchor to instead, see review notes).
--     Once spent or once the window closes, free quota is permanently 0
--     (never refilled by cancelling/resubscribing without ever paying).
--   - Paid (ACTIVE subscription, now < paid_through) users: 10 generations
--     per CALENDAR MONTH (Asia/Taipei), reset every month — including for
--     yearly-plan subscribers (yearly billing still only grants 10/month,
--     never a lump sum).
--   - Reservation is a two-phase RESERVE -> CONFIRM/RELEASE so concurrent
--     requests from the same user cannot both pass a stale check (atomic,
--     row-locked). A failed generation must RELEASE its reservation (never
--     consumes a confirmed slot); a stale un-released reservation (crashed
--     request) self-expires via a TTL sweep inside reserve itself, so it
--     never permanently blocks future attempts.
--
-- Rollback (manual, destructive to new objects only):
--   DROP FUNCTION IF EXISTS public.release_wallpaper_quota_reservation(TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.confirm_wallpaper_quota_usage(TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.reserve_wallpaper_quota(TEXT, TEXT, INTEGER, INTEGER, INTEGER);
--   DROP TABLE IF EXISTS public.wallpaper_quota_usage;

CREATE TABLE IF NOT EXISTS public.wallpaper_quota_usage (
    user_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    limit_count INTEGER NOT NULL CHECK (limit_count > 0),
    confirmed_count INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_count >= 0),
    pending_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
    pending_reserved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_wallpaper_quota_usage PRIMARY KEY (user_id, period_key)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'wallpaper_quota_usage'
           AND t.tgname = 'trg_wallpaper_quota_usage_set_updated_at'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_wallpaper_quota_usage_set_updated_at
                 BEFORE UPDATE ON public.wallpaper_quota_usage
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;
END $$;

ALTER TABLE public.wallpaper_quota_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.wallpaper_quota_usage FROM anon, authenticated;

DROP POLICY IF EXISTS wallpaper_quota_usage_owner_select ON public.wallpaper_quota_usage;
CREATE POLICY wallpaper_quota_usage_owner_select
    ON public.wallpaper_quota_usage
    FOR SELECT
    TO authenticated
    USING (user_id = public.request_user_key());

GRANT SELECT ON TABLE public.wallpaper_quota_usage TO authenticated;

-- ---------------------------------------------------------------------------
-- reserve_wallpaper_quota — atomic reserve with TTL-based stale-reservation
-- self-expiry (never permanently blocks on a crashed/abandoned request).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reserve_wallpaper_quota(
    p_user_id TEXT,
    p_period_key TEXT,
    p_limit INTEGER,
    p_ttl_seconds INTEGER DEFAULT 120,
    p_trial_window_seconds INTEGER DEFAULT NULL
) RETURNS TABLE (
    allowed BOOLEAN,
    remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.wallpaper_quota_usage;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'INVALID_USER_ID';
    END IF;
    IF p_period_key IS NULL OR btrim(p_period_key) = '' THEN
        RAISE EXCEPTION 'INVALID_PERIOD_KEY';
    END IF;
    IF p_limit IS NULL OR p_limit <= 0 THEN
        RAISE EXCEPTION 'INVALID_LIMIT';
    END IF;

    INSERT INTO public.wallpaper_quota_usage (user_id, period_key, limit_count)
    VALUES (p_user_id, p_period_key, p_limit)
    ON CONFLICT (user_id, period_key) DO NOTHING;

    SELECT * INTO v_row
      FROM public.wallpaper_quota_usage
     WHERE user_id = p_user_id AND period_key = p_period_key
     FOR UPDATE;

    -- A stale pending reservation (crashed/abandoned request) self-expires
    -- here rather than permanently blocking future attempts.
    IF v_row.pending_count > 0
       AND v_row.pending_reserved_at IS NOT NULL
       AND v_row.pending_reserved_at < NOW() - make_interval(secs => p_ttl_seconds) THEN
        v_row.pending_count := 0;
    END IF;

    -- Free-tier trial window: once it has closed, no new generations are
    -- allowed regardless of remaining count (the window is anchored to this
    -- row's own created_at = the first time this gate ever ran for the user).
    IF p_trial_window_seconds IS NOT NULL
       AND v_row.created_at < NOW() - make_interval(secs => p_trial_window_seconds) THEN
        allowed := FALSE;
        remaining := GREATEST(p_limit - v_row.confirmed_count - v_row.pending_count, 0);
        UPDATE public.wallpaper_quota_usage
           SET pending_count = v_row.pending_count,
               pending_reserved_at = CASE WHEN v_row.pending_count = 0 THEN NULL ELSE pending_reserved_at END,
               updated_at = NOW()
         WHERE user_id = p_user_id AND period_key = p_period_key;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_row.confirmed_count + v_row.pending_count >= p_limit THEN
        allowed := FALSE;
        remaining := 0;
        UPDATE public.wallpaper_quota_usage
           SET pending_count = v_row.pending_count,
               pending_reserved_at = CASE WHEN v_row.pending_count = 0 THEN NULL ELSE pending_reserved_at END,
               updated_at = NOW()
         WHERE user_id = p_user_id AND period_key = p_period_key;
        RETURN NEXT;
        RETURN;
    END IF;

    UPDATE public.wallpaper_quota_usage
       SET pending_count = v_row.pending_count + 1,
           pending_reserved_at = NOW(),
           updated_at = NOW()
     WHERE user_id = p_user_id AND period_key = p_period_key;

    allowed := TRUE;
    remaining := p_limit - v_row.confirmed_count - (v_row.pending_count + 1);
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_wallpaper_quota(TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_wallpaper_quota(TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_wallpaper_quota(TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_wallpaper_quota(TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- confirm_wallpaper_quota_usage — only called after a generation genuinely
-- succeeds; moves one pending slot to confirmed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_wallpaper_quota_usage(
    p_user_id TEXT,
    p_period_key TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pending INTEGER;
BEGIN
    SELECT pending_count INTO v_pending
      FROM public.wallpaper_quota_usage
     WHERE user_id = p_user_id AND period_key = p_period_key
     FOR UPDATE;

    IF v_pending IS NULL OR v_pending <= 0 THEN
        RETURN;
    END IF;

    UPDATE public.wallpaper_quota_usage
       SET pending_count = pending_count - 1,
           confirmed_count = confirmed_count + 1,
           pending_reserved_at = CASE WHEN pending_count - 1 <= 0 THEN NULL ELSE pending_reserved_at END,
           updated_at = NOW()
     WHERE user_id = p_user_id AND period_key = p_period_key;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_wallpaper_quota_usage(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_wallpaper_quota_usage(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_wallpaper_quota_usage(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_wallpaper_quota_usage(TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- release_wallpaper_quota_reservation — called when generation FAILS, so a
-- failed attempt never consumes quota.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_wallpaper_quota_reservation(
    p_user_id TEXT,
    p_period_key TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pending INTEGER;
BEGIN
    SELECT pending_count INTO v_pending
      FROM public.wallpaper_quota_usage
     WHERE user_id = p_user_id AND period_key = p_period_key
     FOR UPDATE;

    IF v_pending IS NULL OR v_pending <= 0 THEN
        RETURN;
    END IF;

    UPDATE public.wallpaper_quota_usage
       SET pending_count = pending_count - 1,
           pending_reserved_at = CASE WHEN pending_count - 1 <= 0 THEN NULL ELSE pending_reserved_at END,
           updated_at = NOW()
     WHERE user_id = p_user_id AND period_key = p_period_key;
END;
$$;

REVOKE ALL ON FUNCTION public.release_wallpaper_quota_reservation(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_wallpaper_quota_reservation(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.release_wallpaper_quota_reservation(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_wallpaper_quota_reservation(TEXT, TEXT) TO service_role;
