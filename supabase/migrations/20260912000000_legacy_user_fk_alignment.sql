-- WEB-HOME-01B.1C: align clean-rebuild wallpaper identity foreign keys.
--
-- The historical wallpaper migrations choose public.users' primary key,
-- which is the surrogate `id` in the authoritative legacy baseline. The
-- production/application identity contract instead uses the UNIQUE
-- `users.user_id` column. Existing production is already aligned, so each
-- block is a no-op when its constraint target and delete action are correct.
-- No rows, primary keys, or application columns are changed.
--
-- Rollback is intentionally not provided: restoring the incorrect FK target
-- would break the application identity contract on a clean rebuild.

DO $$
DECLARE
    v_user_id_attnum SMALLINT;
BEGIN
    IF to_regclass('public.users') IS NULL
       OR to_regclass('public.wallpaper_generations') IS NULL
       OR to_regclass('public.wallpaper_generation_jobs') IS NULL
       OR to_regclass('public.daily_generation_usage') IS NULL THEN
        RAISE EXCEPTION 'Legacy user FK alignment requires users and all wallpaper tables';
    END IF;

    SELECT attnum
      INTO v_user_id_attnum
      FROM pg_attribute
     WHERE attrelid = 'public.users'::regclass
       AND attname = 'user_id'
       AND NOT attisdropped;

    IF v_user_id_attnum IS NULL THEN
        RAISE EXCEPTION 'Legacy user FK alignment requires public.users.user_id';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.wallpaper_generations'::regclass
           AND conname = 'fk_wallpaper_generations_user'
           AND confrelid = 'public.users'::regclass
           AND confkey = ARRAY[v_user_id_attnum]::SMALLINT[]
           AND confdeltype = 'r'
    ) THEN
        ALTER TABLE public.wallpaper_generations
            DROP CONSTRAINT IF EXISTS fk_wallpaper_generations_user;
        ALTER TABLE public.wallpaper_generations
            ADD CONSTRAINT fk_wallpaper_generations_user
            FOREIGN KEY (user_id) REFERENCES public.users(user_id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.wallpaper_generation_jobs'::regclass
           AND conname = 'fk_wallpaper_generation_jobs_user'
           AND confrelid = 'public.users'::regclass
           AND confkey = ARRAY[v_user_id_attnum]::SMALLINT[]
           AND confdeltype = 'c'
    ) THEN
        ALTER TABLE public.wallpaper_generation_jobs
            DROP CONSTRAINT IF EXISTS fk_wallpaper_generation_jobs_user;
        ALTER TABLE public.wallpaper_generation_jobs
            ADD CONSTRAINT fk_wallpaper_generation_jobs_user
            FOREIGN KEY (user_id) REFERENCES public.users(user_id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.daily_generation_usage'::regclass
           AND conname = 'fk_daily_generation_usage_user'
           AND confrelid = 'public.users'::regclass
           AND confkey = ARRAY[v_user_id_attnum]::SMALLINT[]
           AND confdeltype = 'r'
    ) THEN
        ALTER TABLE public.daily_generation_usage
            DROP CONSTRAINT IF EXISTS fk_daily_generation_usage_user;
        ALTER TABLE public.daily_generation_usage
            ADD CONSTRAINT fk_daily_generation_usage_user
            FOREIGN KEY (user_id) REFERENCES public.users(user_id)
            ON DELETE RESTRICT;
    END IF;
END $$;