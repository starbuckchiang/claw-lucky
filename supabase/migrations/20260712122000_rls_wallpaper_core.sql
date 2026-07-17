CREATE OR REPLACE FUNCTION public.request_user_key()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.user_id', true), ''),
        NULLIF(current_setting('request.jwt.claim.sub', true), ''),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'user_id'),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    );
$$;

ALTER TABLE IF EXISTS public.wallpaper_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wallpaper_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.daily_generation_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_wallpaper_generations_select_owner ON public.wallpaper_generations;
DROP POLICY IF EXISTS p_wallpaper_generations_deny_insert_authenticated ON public.wallpaper_generations;
DROP POLICY IF EXISTS p_wallpaper_generations_deny_update_authenticated ON public.wallpaper_generations;
DROP POLICY IF EXISTS p_wallpaper_generations_deny_delete_authenticated ON public.wallpaper_generations;
DROP POLICY IF EXISTS p_wallpaper_generation_jobs_select_owner ON public.wallpaper_generation_jobs;
DROP POLICY IF EXISTS p_wallpaper_generation_jobs_deny_insert_authenticated ON public.wallpaper_generation_jobs;
DROP POLICY IF EXISTS p_wallpaper_generation_jobs_deny_update_authenticated ON public.wallpaper_generation_jobs;
DROP POLICY IF EXISTS p_wallpaper_generation_jobs_deny_delete_authenticated ON public.wallpaper_generation_jobs;
DROP POLICY IF EXISTS p_daily_generation_usage_select_owner ON public.daily_generation_usage;
DROP POLICY IF EXISTS p_daily_generation_usage_deny_insert_authenticated ON public.daily_generation_usage;
DROP POLICY IF EXISTS p_daily_generation_usage_deny_update_authenticated ON public.daily_generation_usage;
DROP POLICY IF EXISTS p_daily_generation_usage_deny_delete_authenticated ON public.daily_generation_usage;

CREATE POLICY p_wallpaper_generations_select_owner
    ON public.wallpaper_generations
    FOR SELECT
    TO authenticated
    USING (user_id::text = public.request_user_key());

CREATE POLICY p_wallpaper_generation_jobs_select_owner
    ON public.wallpaper_generation_jobs
    FOR SELECT
    TO authenticated
    USING (user_id::text = public.request_user_key());

CREATE POLICY p_daily_generation_usage_select_owner
    ON public.daily_generation_usage
    FOR SELECT
    TO authenticated
    USING (user_id::text = public.request_user_key());

-- Service Role isolation:
-- generation/job lifecycle transitions (queued->processing->succeeded/failed/expired),
-- retry scheduling, and daily usage mutations are backend-controlled operations.
-- These writes are intentionally blocked for authenticated clients and must run via
-- Backend / Edge Functions / SECURITY DEFINER RPC.
CREATE POLICY p_wallpaper_generations_deny_insert_authenticated
    ON public.wallpaper_generations
    AS RESTRICTIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

CREATE POLICY p_wallpaper_generations_deny_update_authenticated
    ON public.wallpaper_generations
    AS RESTRICTIVE
    FOR UPDATE
    TO authenticated
    USING (false)
    WITH CHECK (false);

CREATE POLICY p_wallpaper_generations_deny_delete_authenticated
    ON public.wallpaper_generations
    AS RESTRICTIVE
    FOR DELETE
    TO authenticated
    USING (false);

CREATE POLICY p_wallpaper_generation_jobs_deny_insert_authenticated
    ON public.wallpaper_generation_jobs
    AS RESTRICTIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

CREATE POLICY p_wallpaper_generation_jobs_deny_update_authenticated
    ON public.wallpaper_generation_jobs
    AS RESTRICTIVE
    FOR UPDATE
    TO authenticated
    USING (false)
    WITH CHECK (false);

CREATE POLICY p_wallpaper_generation_jobs_deny_delete_authenticated
    ON public.wallpaper_generation_jobs
    AS RESTRICTIVE
    FOR DELETE
    TO authenticated
    USING (false);

CREATE POLICY p_daily_generation_usage_deny_insert_authenticated
    ON public.daily_generation_usage
    AS RESTRICTIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

CREATE POLICY p_daily_generation_usage_deny_update_authenticated
    ON public.daily_generation_usage
    AS RESTRICTIVE
    FOR UPDATE
    TO authenticated
    USING (false)
    WITH CHECK (false);

CREATE POLICY p_daily_generation_usage_deny_delete_authenticated
    ON public.daily_generation_usage
    AS RESTRICTIVE
    FOR DELETE
    TO authenticated
    USING (false);
