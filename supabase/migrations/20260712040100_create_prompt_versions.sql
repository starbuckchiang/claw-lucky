CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    users_pk_column TEXT;
    users_pk_type TEXT;
BEGIN
    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
      INTO users_pk_column, users_pk_type
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
     WHERE n.nspname = 'public'
       AND c.relname = 'users'
       AND i.indisprimary
       AND i.indnatts = 1
       AND a.attname = ANY (ARRAY['user_id', 'mascot_id', 'gift_id', 'id'])
     LIMIT 1;

    IF users_pk_column IS NULL OR users_pk_type IS NULL THEN
        RAISE EXCEPTION 'Cannot create prompt_versions: public.users single-column PK with candidate name (user_id|mascot_id|gift_id|id) not found.';
    END IF;

    EXECUTE format($sql$
        CREATE TABLE IF NOT EXISTS public.prompt_versions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            prompt_type TEXT NOT NULL,
            version TEXT NOT NULL,
            template TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by %1$s,
            metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
            CONSTRAINT uq_prompt_versions_type_version UNIQUE (prompt_type, version),
            CONSTRAINT fk_prompt_versions_created_by FOREIGN KEY (created_by)
                REFERENCES public.users(%2$I) ON DELETE RESTRICT
        );
    $sql$, users_pk_type, users_pk_column);
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'prompt_versions'
           AND t.tgname = 'trg_prompt_versions_set_updated_at'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_prompt_versions_set_updated_at
                 BEFORE UPDATE ON public.prompt_versions
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_versions_active_per_type
    ON public.prompt_versions (prompt_type)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_type_is_active
    ON public.prompt_versions (prompt_type, is_active);

DO $$
BEGIN
    IF to_regclass('public.wallpaper_generations') IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
              FROM pg_constraint
             WHERE conname = 'fk_wallpaper_generations_prompt_version'
               AND conrelid = 'public.wallpaper_generations'::regclass
       ) THEN
        ALTER TABLE public.wallpaper_generations
            ADD CONSTRAINT fk_wallpaper_generations_prompt_version
            FOREIGN KEY (prompt_version)
            REFERENCES public.prompt_versions(id)
            ON DELETE RESTRICT;
    END IF;
END $$;
