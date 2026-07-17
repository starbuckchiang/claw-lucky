-- P2-AI-02: allow wallpaper_generation_jobs.wallpaper_id to be created before
-- the corresponding wallpaper_generations row exists.
--
-- Rationale:
-- ADR-004 / the already-approved Generation Orchestrator workflow creates the
-- Job BEFORE calling the Generation Service (Create Generation Job -> Mark
-- Job Running -> Call Generation Service). The original P1-INF-01 migration
-- declared `wallpaper_id` as NOT NULL, which makes that already-approved
-- orchestration order impossible against a real Postgres instance (the job
-- row cannot reference a generation id that does not exist yet).
--
-- This migration only relaxes the NOT NULL constraint so the job can be
-- created first and linked to its generation afterwards via
-- `jobService.markSuccess(jobId, { generationId })`. The FK constraint is
-- preserved (NULL is allowed by FK, non-null values must still reference an
-- existing wallpaper_generations row).

ALTER TABLE IF EXISTS public.wallpaper_generation_jobs
    ALTER COLUMN wallpaper_id DROP NOT NULL;
