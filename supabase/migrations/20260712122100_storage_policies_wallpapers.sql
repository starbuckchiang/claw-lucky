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

INSERT INTO storage.buckets (id, name, public)
VALUES ('wallpapers', 'wallpapers', false)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS p_storage_wallpapers_select_owner ON storage.objects;
DROP POLICY IF EXISTS p_storage_wallpapers_block_insert ON storage.objects;
DROP POLICY IF EXISTS p_storage_wallpapers_block_update ON storage.objects;
DROP POLICY IF EXISTS p_storage_wallpapers_block_delete ON storage.objects;

CREATE POLICY p_storage_wallpapers_select_owner
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'wallpapers'
        AND (
            owner::text = public.request_user_key()
            OR split_part(name, '/', 1) = public.request_user_key()
        )
    );

CREATE POLICY p_storage_wallpapers_block_insert
    ON storage.objects
    AS RESTRICTIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id <> 'wallpapers');

CREATE POLICY p_storage_wallpapers_block_update
    ON storage.objects
    AS RESTRICTIVE
    FOR UPDATE
    TO authenticated
    USING (bucket_id <> 'wallpapers')
    WITH CHECK (bucket_id <> 'wallpapers');

CREATE POLICY p_storage_wallpapers_block_delete
    ON storage.objects
    AS RESTRICTIVE
    FOR DELETE
    TO authenticated
    USING (bucket_id <> 'wallpapers');

-- Service Role isolation:
-- Wallpaper objects are written/updated/deleted by backend-controlled workers only.
-- Authenticated users only read their own objects through RLS; no direct lifecycle writes.

-- TODO(Phase 4): add equivalent private bucket + storage.objects policies
-- for `selfies-encrypted` with service-only access and stricter retention controls.
