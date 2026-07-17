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
    mascots_pk_column TEXT;
    mascots_pk_type TEXT;
    gifts_pk_column TEXT;
    gifts_pk_type TEXT;
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

    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
      INTO mascots_pk_column, mascots_pk_type
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
     WHERE n.nspname = 'public'
       AND c.relname = 'mascots'
       AND i.indisprimary
       AND i.indnatts = 1
       AND a.attname = ANY (ARRAY['user_id', 'mascot_id', 'gift_id', 'id'])
     LIMIT 1;

    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
      INTO gifts_pk_column, gifts_pk_type
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
     WHERE n.nspname = 'public'
       AND c.relname = 'gifts'
       AND i.indisprimary
       AND i.indnatts = 1
       AND a.attname = ANY (ARRAY['user_id', 'mascot_id', 'gift_id', 'id'])
     LIMIT 1;

    IF users_pk_column IS NULL OR users_pk_type IS NULL THEN
        RAISE EXCEPTION 'Cannot create wallpaper tables: public.users single-column PK with candidate name (user_id|mascot_id|gift_id|id) not found.';
    END IF;

    IF mascots_pk_column IS NULL OR mascots_pk_type IS NULL THEN
        RAISE EXCEPTION 'Cannot create wallpaper tables: public.mascots single-column PK with candidate name (user_id|mascot_id|gift_id|id) not found.';
    END IF;

    IF gifts_pk_column IS NULL OR gifts_pk_type IS NULL THEN
        RAISE EXCEPTION 'Cannot create wallpaper tables: public.gifts single-column PK with candidate name (user_id|mascot_id|gift_id|id) not found.';
    END IF;

    EXECUTE format($sql$
        CREATE TABLE IF NOT EXISTS public.wallpaper_generations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id %1$s NOT NULL,
            mascot_id %2$s NOT NULL,
            gift_id %3$s NOT NULL,
            lucky_theme TEXT NOT NULL,
            blessing TEXT NOT NULL,
            wallpaper_style TEXT NOT NULL,
            ai_model TEXT NOT NULL,
            prompt_version UUID,
            generation_seed TEXT,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'expired')),
            storage_bucket TEXT,
            storage_path TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
            failure_code TEXT,
            failure_message TEXT,
            metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            CONSTRAINT ck_wallpaper_generations_expires_after_created CHECK (expires_at > created_at),
            CONSTRAINT fk_wallpaper_generations_user FOREIGN KEY (user_id)
                REFERENCES public.users(%4$I) ON DELETE RESTRICT,
            CONSTRAINT fk_wallpaper_generations_mascot FOREIGN KEY (mascot_id)
                REFERENCES public.mascots(%5$I) ON DELETE RESTRICT,
            CONSTRAINT fk_wallpaper_generations_gift FOREIGN KEY (gift_id)
                REFERENCES public.gifts(%6$I) ON DELETE RESTRICT
        );
    $sql$, users_pk_type, mascots_pk_type, gifts_pk_type, users_pk_column, mascots_pk_column, gifts_pk_column);

    EXECUTE format($sql$
        CREATE TABLE IF NOT EXISTS public.wallpaper_generation_jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            wallpaper_id UUID NOT NULL,
            user_id %1$s NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
            progress_percent INTEGER NOT NULL DEFAULT 0
                CHECK (progress_percent >= 0 AND progress_percent <= 100),
            progress_stage TEXT NOT NULL DEFAULT 'preparing',
            estimated_remaining_seconds INTEGER CHECK (estimated_remaining_seconds >= 0),
            attempt_no INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
            next_retry_at TIMESTAMPTZ,
            locked_at TIMESTAMPTZ,
            locked_by TEXT,
            idempotency_key TEXT NOT NULL,
            started_at TIMESTAMPTZ,
            finished_at TIMESTAMPTZ,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_wallpaper_generation_jobs_idempotency_key UNIQUE (idempotency_key),
            CONSTRAINT fk_wallpaper_generation_jobs_wallpaper FOREIGN KEY (wallpaper_id)
                REFERENCES public.wallpaper_generations(id) ON DELETE RESTRICT,
            CONSTRAINT fk_wallpaper_generation_jobs_user FOREIGN KEY (user_id)
                REFERENCES public.users(%2$I) ON DELETE RESTRICT
        );
    $sql$, users_pk_type, users_pk_column);

    EXECUTE format($sql$
        CREATE TABLE IF NOT EXISTS public.daily_generation_usage (
            user_id %1$s NOT NULL,
            usage_date DATE NOT NULL,
            success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT pk_daily_generation_usage PRIMARY KEY (user_id, usage_date),
            CONSTRAINT fk_daily_generation_usage_user FOREIGN KEY (user_id)
                REFERENCES public.users(%2$I) ON DELETE RESTRICT
        );
    $sql$, users_pk_type, users_pk_column);
END $$;

CREATE TABLE IF NOT EXISTS public.generation_cost_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cost_points INTEGER NOT NULL CHECK (cost_points >= 0),
    effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_generation_cost_config_effective_window
        CHECK (effective_to IS NULL OR effective_to > effective_from)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'wallpaper_generations'
           AND t.tgname = 'trg_wallpaper_generations_set_updated_at'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_wallpaper_generations_set_updated_at
                 BEFORE UPDATE ON public.wallpaper_generations
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'wallpaper_generation_jobs'
           AND t.tgname = 'trg_wallpaper_generation_jobs_set_updated_at'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_wallpaper_generation_jobs_set_updated_at
                 BEFORE UPDATE ON public.wallpaper_generation_jobs
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'daily_generation_usage'
           AND t.tgname = 'trg_daily_generation_usage_set_updated_at'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_daily_generation_usage_set_updated_at
                 BEFORE UPDATE ON public.daily_generation_usage
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'generation_cost_config'
           AND t.tgname = 'trg_generation_cost_config_set_updated_at'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_generation_cost_config_set_updated_at
                 BEFORE UPDATE ON public.generation_cost_config
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_generation_cost_config_single_active
    ON public.generation_cost_config (is_active)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_wallpaper_generations_user_created_at_desc
    ON public.wallpaper_generations (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallpaper_generations_status_expires_at
    ON public.wallpaper_generations (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_wallpaper_generation_jobs_status_next_retry_at
    ON public.wallpaper_generation_jobs (status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_wallpaper_generation_jobs_wallpaper_attempt_no
    ON public.wallpaper_generation_jobs (wallpaper_id, attempt_no);
