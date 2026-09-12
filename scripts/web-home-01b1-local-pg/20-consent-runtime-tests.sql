\set ON_ERROR_STOP on

CREATE TEMP TABLE consent_test_context (
  user_a uuid NOT NULL,
  user_b uuid NOT NULL,
  started_at timestamptz NOT NULL
);

INSERT INTO consent_test_context
VALUES (gen_random_uuid(), gen_random_uuid(), clock_timestamp());

GRANT SELECT ON consent_test_context TO anon, authenticated, service_role;

INSERT INTO auth.users (id)
SELECT user_a FROM consent_test_context
UNION ALL
SELECT user_b FROM consent_test_context;

CREATE OR REPLACE FUNCTION public.local_expect_error(p_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_failed boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'Expected statement to fail: %', p_sql;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.local_expect_error(text) TO PUBLIC;

DO $$
DECLARE
  v_count integer;
  v_delete_action "char";
  v_default text;
  v_rls boolean;
  v_security_definer boolean;
  v_search_path text[];
BEGIN
  SELECT count(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'user_consents';
  IF v_count <> 1 THEN RAISE EXCEPTION 'user_consents table missing'; END IF;

  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid = 'public.user_consents'::regclass AND contype = 'p';
  IF v_count <> 1 THEN RAISE EXCEPTION 'primary key missing'; END IF;

  SELECT confdeltype INTO v_delete_action
  FROM pg_constraint
  WHERE conrelid = 'public.user_consents'::regclass
    AND contype = 'f'
    AND confrelid = 'auth.users'::regclass;
  IF v_delete_action IS NULL OR v_delete_action = 'c' THEN
    RAISE EXCEPTION 'auth.users FK missing or cascades';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid = 'public.user_consents'::regclass
    AND conname IN (
      'user_consents_scope_allowlist',
      'user_consents_source_allowlist',
      'user_consents_scope_versions',
      'user_consents_hash_shape',
      'user_consents_idempotency_key_shape',
      'user_consents_user_scope_idem_key'
    );
  IF v_count <> 6 THEN RAISE EXCEPTION 'required checks/unique constraint missing'; END IF;

  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user_consents' AND column_name = 'accepted_at';
  IF v_default IS NULL OR v_default !~* 'now\(\)' THEN
    RAISE EXCEPTION 'accepted_at default is not now()';
  END IF;

  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.user_consents'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'RLS is not enabled'; END IF;

  SELECT count(*) INTO v_count
  FROM pg_policy
  WHERE polrelid = 'public.user_consents'::regclass
    AND polname = 'user_consents_owner_select'
    AND polcmd = 'r';
  IF v_count <> 1 THEN RAISE EXCEPTION 'owner SELECT policy missing'; END IF;

  SELECT count(*) INTO v_count
  FROM pg_trigger
  WHERE tgrelid = 'public.user_consents'::regclass
    AND tgname = 'user_consents_append_only'
    AND NOT tgisinternal;
  IF v_count <> 1 THEN RAISE EXCEPTION 'append-only trigger missing'; END IF;

  SELECT prosecdef, proconfig
    INTO v_security_definer, v_search_path
  FROM pg_proc
  WHERE oid = 'public.record_user_consent(uuid,text,text,text,text,text,text,text,text)'::regprocedure;
  IF NOT v_security_definer THEN RAISE EXCEPTION 'RPC is not SECURITY DEFINER'; END IF;
  IF v_search_path IS NULL OR NOT ('search_path=public, pg_temp' = ANY(v_search_path)) THEN
    RAISE EXCEPTION 'RPC search_path is not pinned';
  END IF;

  IF has_function_privilege('public', 'public.record_user_consent(uuid,text,text,text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can execute RPC';
  END IF;
  IF has_function_privilege('anon', 'public.record_user_consent(uuid,text,text,text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute RPC';
  END IF;
  IF has_function_privilege('authenticated', 'public.record_user_consent(uuid,text,text,text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute RPC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.record_user_consent(uuid,text,text,text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute RPC';
  END IF;
END;
$$;

SET ROLE service_role;
SELECT * FROM public.record_user_consent(
  (SELECT user_a FROM consent_test_context),
  'account_upgrade', 'account_upgrade_form',
  '2026-09-15', '2026-09-15',
  repeat('a', 64), repeat('b', 64),
  'local-correlation-a', 'local-idem-shared-0001'
);
SELECT * FROM public.record_user_consent(
  (SELECT user_a FROM consent_test_context),
  'account_upgrade', 'account_upgrade_form',
  '2026-09-15', '2026-09-15',
  repeat('a', 64), repeat('b', 64),
  'local-correlation-a-retry', 'local-idem-shared-0001'
);
SELECT * FROM public.record_user_consent(
  (SELECT user_a FROM consent_test_context),
  'checkout', 'subscription_page',
  '2026-09-15', NULL,
  repeat('a', 64), NULL,
  'local-correlation-checkout', 'local-idem-shared-0001'
);
SELECT * FROM public.record_user_consent(
  (SELECT user_b FROM consent_test_context),
  'account_upgrade', 'account_upgrade_form',
  '2026-09-15', '2026-09-15',
  repeat('a', 64), repeat('b', 64),
  'local-correlation-b', 'local-idem-user-b-0001'
);
RESET ROLE;

DO $$
DECLARE
  v_count integer;
  v_min timestamptz;
  v_started timestamptz;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.user_consents
  WHERE user_id = (SELECT user_a FROM consent_test_context)
    AND consent_scope = 'account_upgrade'
    AND idempotency_key = 'local-idem-shared-0001';
  IF v_count <> 1 THEN RAISE EXCEPTION 'same-scope idempotency failed'; END IF;

  SELECT count(*) INTO v_count
  FROM public.user_consents
  WHERE user_id = (SELECT user_a FROM consent_test_context)
    AND idempotency_key = 'local-idem-shared-0001';
  IF v_count <> 2 THEN RAISE EXCEPTION 'different scopes did not create independent rows'; END IF;

  SELECT min(accepted_at), (SELECT started_at FROM consent_test_context)
    INTO v_min, v_started
  FROM public.user_consents;
  IF v_min < v_started OR v_min > clock_timestamp() THEN
    RAISE EXCEPTION 'accepted_at not generated within database test window';
  END IF;
END;
$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT user_a::text FROM consent_test_context), false);
DO $$
DECLARE
  v_own integer;
  v_other integer;
BEGIN
  SELECT count(*) INTO v_own FROM public.user_consents
  WHERE user_id = (SELECT user_a FROM consent_test_context);
  SELECT count(*) INTO v_other FROM public.user_consents
  WHERE user_id = (SELECT user_b FROM consent_test_context);
  IF v_own <> 2 THEN RAISE EXCEPTION 'authenticated A cannot read own records'; END IF;
  IF v_other <> 0 THEN RAISE EXCEPTION 'authenticated A can read B records'; END IF;
END;
$$;
SELECT public.local_expect_error(format(
  'INSERT INTO public.user_consents(user_id,consent_scope,terms_version,terms_content_sha256,source,idempotency_key) VALUES (%L,''checkout'',''2026-09-15'',%L,''subscription_page'',''direct-auth-insert'')',
  (SELECT user_a::text FROM consent_test_context), repeat('a', 64)
));
SELECT public.local_expect_error('UPDATE public.user_consents SET source=''subscription_page''');
SELECT public.local_expect_error('DELETE FROM public.user_consents');
SELECT public.local_expect_error(format(
  'SELECT * FROM public.record_user_consent(%L,''checkout'',''subscription_page'',''2026-09-15'',NULL,%L,NULL,NULL,''auth-rpc-denied'')',
  (SELECT user_a::text FROM consent_test_context), repeat('a', 64)
));
RESET ROLE;

SET ROLE anon;
SELECT public.local_expect_error('SELECT * FROM public.user_consents');
SELECT public.local_expect_error(format(
  'INSERT INTO public.user_consents(user_id,consent_scope,terms_version,terms_content_sha256,source,idempotency_key) VALUES (%L,''checkout'',''2026-09-15'',%L,''subscription_page'',''direct-anon-insert'')',
  (SELECT user_a::text FROM consent_test_context), repeat('a', 64)
));
SELECT public.local_expect_error(format(
  'SELECT * FROM public.record_user_consent(%L,''checkout'',''subscription_page'',''2026-09-15'',NULL,%L,NULL,NULL,''anon-rpc-denied'')',
  (SELECT user_a::text FROM consent_test_context), repeat('a', 64)
));
RESET ROLE;

CREATE ROLE local_public_probe NOLOGIN NOSUPERUSER;
GRANT USAGE ON SCHEMA public TO local_public_probe;
GRANT EXECUTE ON FUNCTION public.local_expect_error(text) TO local_public_probe;
GRANT SELECT ON consent_test_context TO local_public_probe;
SET ROLE local_public_probe;
SELECT public.local_expect_error(format(
  'SELECT * FROM public.record_user_consent(%L,''checkout'',''subscription_page'',''2026-09-15'',NULL,%L,NULL,NULL,''public-rpc-denied'')',
  (SELECT user_a::text FROM consent_test_context), repeat('a', 64)
));
RESET ROLE;

SET ROLE service_role;
SELECT public.local_expect_error('UPDATE public.user_consents SET source=''subscription_page''');
SELECT public.local_expect_error('DELETE FROM public.user_consents');
RESET ROLE;

-- Table owner (postgres) bypasses ordinary RLS but must still be stopped
-- by the append-only trigger.
SELECT public.local_expect_error('UPDATE public.user_consents SET source=''subscription_page''');
SELECT public.local_expect_error('DELETE FROM public.user_consents');

SELECT public.local_expect_error(format(
  'DELETE FROM auth.users WHERE id=%L',
  (SELECT user_a::text FROM consent_test_context)
));

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.user_consents
  WHERE user_id = (SELECT user_a FROM consent_test_context);
  IF v_count <> 2 THEN RAISE EXCEPTION 'user delete cascaded or orphaned consent rows'; END IF;
END;
$$;

DROP OWNED BY local_public_probe;
DROP ROLE local_public_probe;
DROP FUNCTION public.local_expect_error(text);

SELECT 'WEB_HOME_01B1_RUNTIME_PASS' AS result;
