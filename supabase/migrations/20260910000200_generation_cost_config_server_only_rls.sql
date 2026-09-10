-- Auth-SEC-01B: public.generation_cost_config RLS emergency fix (SERVER_ONLY).
--
-- Sibling of 20260910000100_prompt_versions_server_only_rls.sql — same root
-- cause (see docs/0-review/review-auth/review-auth-SEC-01-public-rls-audit.md):
-- 20260712040000_create_wallpaper_core_tables.sql created this table WITHOUT
-- ENABLE ROW LEVEL SECURITY and 20260712122000_rls_wallpaper_core.sql skipped
-- it. With Supabase's default full grants, the anon key had full R/W since
-- 2026-07-12 (Security Advisor CRITICAL rls_disabled_in_public).
--
-- Access model: SERVER_ONLY.
--   Only consumer is the wallpaper-generate Edge Function (service-role
--   client) via points-repository.{js,ts} getActiveGenerationCost(). Zero
--   browser references. No seed migration exists; points-service.js falls
--   back to defaultGenerationCost=10 when the table is empty (its live state,
--   verified 2026-09-10: 0 rows — integrity MATCH, no tampering).
--
-- Effect: RLS enabled + ZERO policies = deny-all for anon/authenticated;
-- REVOKE = defense in depth. service_role bypasses RLS — Edge Function
-- unaffected. No FORCE RLS. No data/table-shape changes. Idempotent.
--
-- Rollback (manual, only if SERVER_ONLY turns out to be wrong): re-grant the
-- specific privilege + add explicit policies; never disable RLS.
--
-- Verification (read-only, after db push):
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid='public.generation_cost_config'::regclass;              -- true
--   SELECT count(*) FROM information_schema.role_table_grants
--    WHERE table_schema='public' AND table_name='generation_cost_config'
--      AND grantee IN ('anon','authenticated');                        -- 0
--   PostgREST as anon: any verb on /rest/v1/generation_cost_config -> denied.
--   wallpaper-generate: cost lookup still succeeds (service_role).

ALTER TABLE public.generation_cost_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.generation_cost_config FROM anon, authenticated;
