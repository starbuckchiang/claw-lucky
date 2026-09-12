\set ON_ERROR_STOP on

CREATE TEMP TABLE local_expected_legacy_policies (policy_name text PRIMARY KEY);
INSERT INTO local_expected_legacy_policies VALUES
  ('users_insert_own'), ('users_select_own'), ('users_update_own'),
  ('allow anon read mascots'),
  ('user_mascots_delete_own'), ('user_mascots_insert_own'),
  ('user_mascots_select_own'), ('user_mascots_update_own'),
  ('allow anon select redeem history'), ('redeem_history_insert_own'),
  ('redeem_history_select_own'), ('shop_cart_delete_own'),
  ('shop_cart_insert_own'), ('shop_cart_select_own'),
  ('shop_cart_update_own'), ('orders_insert_all'), ('orders_select_all'),
  ('orders_update_all'), ('order_items_insert_all'), ('order_items_select_all');

CREATE FUNCTION pg_temp.expect_error(p_sql text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
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
GRANT EXECUTE ON FUNCTION pg_temp.expect_error(text) TO anon, authenticated;

DO $$
DECLARE
  v_count integer;
  v_table text;
  v_privilege text;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_policy p
    JOIN local_expected_legacy_policies e ON e.policy_name = p.polname;
  IF v_count <> 0 THEN RAISE EXCEPTION 'legacy permissive policies remain: %', v_count; END IF;

  SELECT count(*) INTO v_count
    FROM pg_policy
   WHERE (polrelid, polname) IN (
     ('public.mascots'::regclass, 'mascots_public_select'),
     ('public.gifts'::regclass, 'gifts_public_select'),
     ('public.shop_products'::regclass, 'shop_products_public_select')
   );
  IF v_count <> 3 THEN RAISE EXCEPTION 'catalog SELECT policies incomplete'; END IF;

  SELECT count(*) INTO v_count
    FROM pg_policy
   WHERE polname IN (
     'p_users_select_owner', 'p_user_mascots_select_owner',
     'p_redeem_history_select_owner', 'p_shop_cart_select_owner',
     'p_orders_select_owner', 'p_order_items_select_owner'
   );
  IF v_count <> 6 THEN RAISE EXCEPTION 'owner SELECT policies were not preserved'; END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'users', 'mascots', 'gifts', 'user_mascots', 'redeem_history',
    'shop_products', 'shop_cart', 'orders', 'order_items'
  ] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', v_table)::regclass) THEN
      RAISE EXCEPTION 'RLS disabled on %', v_table;
    END IF;
    FOREACH v_privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      IF has_table_privilege('anon', format('public.%I', v_table), v_privilege)
         OR has_table_privilege('authenticated', format('public.%I', v_table), v_privilege) THEN
        RAISE EXCEPTION 'client % remains on %', v_privilege, v_table;
      END IF;
    END LOOP;
  END LOOP;

  IF has_sequence_privilege('anon', 'public.user_mascots_id_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.redeem_history_id_seq', 'USAGE') THEN
    RAISE EXCEPTION 'client sequence privilege remains';
  END IF;

  IF has_function_privilege('anon', 'public.generate_order_no()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.set_order_no()', 'EXECUTE') THEN
    RAISE EXCEPTION 'client order-function EXECUTE remains';
  END IF;

  SELECT count(*) INTO v_count
    FROM pg_constraint
   WHERE conrelid = 'public.user_mascots'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) = 'UNIQUE (user_id, mascot_id)';
  IF v_count <> 1 THEN RAISE EXCEPTION 'user_mascots unique constraint count is %', v_count; END IF;

  IF NOT has_function_privilege('service_role', 'public.ensure_user_row(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost ensure_user_row EXECUTE';
  END IF;
END;
$$;

SET ROLE service_role;
SELECT (public.ensure_user_row('00000000-0000-0000-0000-0000000000a1', 'owner-a')).user_id;
SELECT (public.ensure_user_row('00000000-0000-0000-0000-0000000000a2', 'owner-b')).user_id;
INSERT INTO public.mascots (id, name, rarity, enabled) VALUES ('local-visible-mascot', 'local', 'N', true) ON CONFLICT DO NOTHING;
INSERT INTO public.gifts (id, name, enabled) VALUES ('local-visible-gift', 'local', true) ON CONFLICT DO NOTHING;
INSERT INTO public.gifts (id, name, enabled) VALUES ('local-hidden-gift', 'local', false) ON CONFLICT DO NOTHING;
INSERT INTO public.shop_products (id, name, enabled)
VALUES ('00000000-0000-0000-0000-0000000000c1', 'local', true) ON CONFLICT DO NOTHING;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
DO $$
DECLARE
  v_own integer;
  v_other integer;
BEGIN
  SELECT count(*) INTO v_own FROM public.users WHERE user_id = '00000000-0000-0000-0000-0000000000a1';
  SELECT count(*) INTO v_other FROM public.users WHERE user_id = '00000000-0000-0000-0000-0000000000a2';
  IF v_own <> 1 OR v_other <> 0 THEN RAISE EXCEPTION 'two-user owner boundary failed'; END IF;
END;
$$;
SELECT pg_temp.expect_error(
  'INSERT INTO public.orders(user_id,total_amount,total_items) VALUES (''blocked'',0,0)'
);
RESET ROLE;

SET ROLE anon;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.mascots WHERE id = 'local-visible-mascot';
  IF v_count <> 1 THEN RAISE EXCEPTION 'anon mascot catalog read failed'; END IF;
  SELECT count(*) INTO v_count FROM public.gifts WHERE id = 'local-visible-gift';
  IF v_count <> 1 THEN RAISE EXCEPTION 'anon enabled gift read failed'; END IF;
  SELECT count(*) INTO v_count FROM public.gifts WHERE id = 'local-hidden-gift';
  IF v_count <> 0 THEN RAISE EXCEPTION 'anon can read disabled gift'; END IF;
  SELECT count(*) INTO v_count FROM public.shop_products WHERE id = '00000000-0000-0000-0000-0000000000c1';
  IF v_count <> 1 THEN RAISE EXCEPTION 'anon enabled product read failed'; END IF;
END;
$$;
SELECT pg_temp.expect_error(
  'INSERT INTO public.mascots(id,name,rarity) VALUES (''blocked-mascot'',''blocked'',''N'')'
);
RESET ROLE;

SELECT 'WEB_HOME_01B1C_SECURITY_RUNTIME_PASS' AS result;