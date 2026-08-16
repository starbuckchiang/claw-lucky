-- P-AUTH-05A Hotfix: user_mascots dedup pre-cleanup + unique constraint
-- (Gate blocker #6).
--
-- `public.user_mascots` currently has NO database-level uniqueness
-- guarantee on `(user_id, mascot_id)` — `js/api.js`'s `upsertUserMascot()`
-- does a SELECT-then-INSERT-or-UPDATE (NOT atomic), so a race between two
-- concurrent draws for the same user+mascot can produce TWO rows instead
-- of one row with `obtain_count = 2`. `finalize_account_merge()`
-- (20260816000400) relies on an `ON CONFLICT (user_id, mascot_id)` upsert
-- to merge an anonymous user's mascots into an existing account's — that
-- requires this unique constraint to exist FIRST, so this migration MUST
-- be applied before 20260816000400.
--
-- THIS MIGRATION IS DATA-MUTATING AND NOT FULLY REVERSIBLE: the cleanup
-- step below CONSOLIDATES duplicate `(user_id, mascot_id)` rows into a
-- single row (summing `obtain_count`, keeping the earliest
-- `first_obtained_at` and latest `last_obtained_at`) and DELETES the
-- now-redundant duplicate rows. No mascot ownership is lost (every
-- duplicate row represents the SAME user owning the SAME mascot — the
-- consolidated row's `obtain_count` sum equals the total across the
-- duplicates), but the original row-level history (e.g. exactly which
-- duplicate row had which internal `id`) cannot be recovered after the
-- fact.
--
-- REQUIRED BEFORE RUNNING ON A REAL PROJECT (per copilot-instructions.md
-- "For destructive changes, stop and report the risk before editing" —
-- reported here; a human operator must confirm before applying):
--   1. Take a full database backup/snapshot immediately before applying
--      this migration.
--   2. Run the DRY-RUN query in review-auth-05A-hotfix.md ("手動驗證步驟")
--      first, on a copy of production data, to see exactly how many
--      duplicate groups exist and preview the consolidated result.
-- This migration is idempotent and a safe no-op if no duplicates exist
-- (the CTE's `HAVING COUNT(*) > 1` matches nothing) or if this migration
-- has already been applied (the UNIQUE constraint's `IF NOT EXISTS`-style
-- guard below skips re-adding it).
-- ROLLBACK (manual — the dedup itself cannot be un-done without restoring
-- the pre-migration backup taken in step 1 above; the constraint alone can
-- be dropped without touching data):
--   ALTER TABLE IF EXISTS public.user_mascots DROP CONSTRAINT IF EXISTS uq_user_mascots_user_mascot;
--   -- (the deleted duplicate rows themselves can only be restored from the
--   --  backup taken before running this migration)
-- VERIFICATION (manual): see review-auth-05A-hotfix.md "手動驗證步驟".

DO $$
DECLARE
    v_has_id_column BOOLEAN;
    v_duplicate_groups INTEGER;
BEGIN
    IF to_regclass('public.user_mascots') IS NULL THEN
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'user_mascots'
           AND column_name = 'id'
    ) INTO v_has_id_column;

    IF NOT v_has_id_column THEN
        RAISE NOTICE 'user_mascots has no `id` column — skipping dedup (no live-schema access was available when authoring this migration; verify the actual PK column name and adapt before applying).';
        RETURN;
    END IF;

    SELECT COUNT(*) INTO v_duplicate_groups
      FROM (
          SELECT user_id, mascot_id
            FROM public.user_mascots
           GROUP BY user_id, mascot_id
          HAVING COUNT(*) > 1
      ) dup_groups;

    RAISE NOTICE 'user_mascots dedup: % duplicate (user_id, mascot_id) group(s) found.', v_duplicate_groups;

    -- Consolidate: for every duplicate group, fold every row's
    -- obtain_count/first_obtained_at/last_obtained_at into the row we keep
    -- (the earliest-created row, i.e. smallest `first_obtained_at`, tied
    -- by smallest `id`), then delete the rest.
    WITH duplicate_groups AS (
        SELECT
            user_id,
            mascot_id,
            SUM(obtain_count) AS total_obtain_count,
            MIN(first_obtained_at) AS earliest_first_obtained_at,
            MAX(last_obtained_at) AS latest_last_obtained_at,
            (ARRAY_AGG(id ORDER BY first_obtained_at ASC, id ASC))[1] AS keep_id,
            (ARRAY_AGG(mascot_name ORDER BY last_obtained_at DESC, id DESC))[1] AS keep_mascot_name,
            (ARRAY_AGG(rarity ORDER BY last_obtained_at DESC, id DESC))[1] AS keep_rarity,
            (ARRAY_AGG(image ORDER BY last_obtained_at DESC, id DESC))[1] AS keep_image
        FROM public.user_mascots
        GROUP BY user_id, mascot_id
        HAVING COUNT(*) > 1
    ),
    updated_keep_rows AS (
        UPDATE public.user_mascots um
           SET obtain_count = dg.total_obtain_count,
               first_obtained_at = dg.earliest_first_obtained_at,
               last_obtained_at = dg.latest_last_obtained_at,
               mascot_name = dg.keep_mascot_name,
               rarity = dg.keep_rarity,
               image = dg.keep_image
          FROM duplicate_groups dg
         WHERE um.id = dg.keep_id
        RETURNING um.id
    )
    DELETE FROM public.user_mascots um
     USING duplicate_groups dg
     WHERE um.user_id = dg.user_id
       AND um.mascot_id = dg.mascot_id
       AND um.id <> dg.keep_id;

    -- Only add the constraint once duplicates are gone — this will fail
    -- loudly (instead of silently leaving data inconsistent) if the dedup
    -- above somehow missed a group.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'uq_user_mascots_user_mascot'
           AND conrelid = 'public.user_mascots'::regclass
    ) THEN
        ALTER TABLE public.user_mascots
            ADD CONSTRAINT uq_user_mascots_user_mascot UNIQUE (user_id, mascot_id);
    END IF;
END $$;
