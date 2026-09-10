-- Auth-07C.2A real PostgreSQL behavioral verification.
-- Run as postgres on isolated local DB only.

\set ON_ERROR_STOP on

CREATE TEMP TABLE _t_results (
  test_name TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('PASS','FAIL')),
  detail TEXT
);

CREATE OR REPLACE FUNCTION pg_temp.assert_pass(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '')
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    INSERT INTO _t_results VALUES (p_name, 'FAIL', p_detail)
    ON CONFLICT (test_name) DO UPDATE SET status='FAIL', detail=EXCLUDED.detail;
    RAISE EXCEPTION 'TEST_FAIL %: %', p_name, p_detail;
  END IF;
  INSERT INTO _t_results VALUES (p_name, 'PASS', p_detail)
  ON CONFLICT (test_name) DO UPDATE SET status='PASS', detail=EXCLUDED.detail;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_exception(p_sql TEXT, p_needle TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_msg TEXT;
BEGIN
  BEGIN
    EXECUTE p_sql;
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RETURN position(p_needle in v_msg) > 0;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- Schema checks
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_cnt FROM information_schema.tables
   WHERE table_schema='public'
     AND table_name IN ('paypal_subscriptions','user_subscription_slots','paypal_subscription_transactions');
  PERFORM pg_temp.assert_pass('schema_tables', v_cnt = 3, format('count=%s', v_cnt));

  SELECT COUNT(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.paypal_subscriptions'::regclass
     AND contype = 'u';
  PERFORM pg_temp.assert_pass('schema_unique_subs', v_cnt >= 2, format('unique=%s', v_cnt));

  SELECT COUNT(*) INTO v_cnt FROM pg_indexes
   WHERE schemaname='public' AND tablename='paypal_subscriptions';
  PERFORM pg_temp.assert_pass('schema_indexes', v_cnt >= 1, format('idx=%s', v_cnt));

  SELECT COUNT(*) INTO v_cnt
    FROM information_schema.check_constraints c
    JOIN information_schema.constraint_column_usage u
      ON c.constraint_name = u.constraint_name
   WHERE u.table_name = 'payment_webhook_events'
     AND c.check_clause ILIKE '%pending_resolution%';
  PERFORM pg_temp.assert_pass('webhook_check_widened', v_cnt >= 1, format('checks=%s', v_cnt));
END $$;

-- ---------------------------------------------------------------------------
-- Legacy seed preserved
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_order public.payment_orders;
  v_evt public.payment_webhook_events;
  v_pts BIGINT;
  v_tix BIGINT;
  v_coins BIGINT;
BEGIN
  SELECT * INTO v_order FROM public.payment_orders WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  PERFORM pg_temp.assert_pass(
    'legacy_order_preserved',
    v_order.status = 'paid'
      AND v_order.amount = 5.00
      AND v_order.paypal_order_id = 'LEGACY-ORDER-SEED-1'
      AND v_order.paypal_capture_id = 'LEGACY-CAPTURE-SEED-1',
    format('status=%s amount=%s', v_order.status, v_order.amount)
  );

  SELECT * INTO v_evt FROM public.payment_webhook_events WHERE paypal_event_id = 'WH-LEGACY-SEED-1';
  PERFORM pg_temp.assert_pass(
    'legacy_webhook_preserved',
    v_evt.processing_status = 'processed'
      AND v_evt.event_type = 'PAYMENT.CAPTURE.COMPLETED',
    v_evt.processing_status
  );

  SELECT points, tickets, coins INTO v_pts, v_tix, v_coins
    FROM public.users WHERE user_id = 'user-a';
  PERFORM pg_temp.assert_pass(
    'wallet_untouched_baseline',
    v_pts = 100 AND v_tix = 7 AND v_coins = 33,
    format('p=%s t=%s c=%s', v_pts, v_tix, v_coins)
  );
END $$;

-- ---------------------------------------------------------------------------
-- Different users acquire
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r1 RECORD;
  r2 RECORD;
BEGIN
  SELECT * INTO r1 FROM public.acquire_subscription_slot('user-a', 'monthly', 'P-PLAN-MONTHLY-TEST');
  SELECT * INTO r2 FROM public.acquire_subscription_slot('user-b', 'yearly', 'P-PLAN-YEARLY-TEST');
  PERFORM pg_temp.assert_pass(
    'different_user_acquire',
    r1.plan_code = 'monthly' AND r1.recurring_amount = 5.00
      AND r2.plan_code = 'yearly' AND r2.recurring_amount = 48.00
      AND r1.checkout_session_id IS DISTINCT FROM r2.checkout_session_id,
    format('a=%s b=%s', r1.checkout_session_id, r2.checkout_session_id)
  );
  -- stash sessions for later tests
  CREATE TEMP TABLE IF NOT EXISTS _t_sessions (
    user_id TEXT PRIMARY KEY,
    checkout_session_id TEXT NOT NULL,
    subscription_id UUID NOT NULL
  );
  DELETE FROM _t_sessions;
  INSERT INTO _t_sessions VALUES
    ('user-a', r1.checkout_session_id, r1.subscription_id),
    ('user-b', r2.checkout_session_id, r2.subscription_id);
END $$;

-- ---------------------------------------------------------------------------
-- Concurrent same-user acquire (two connections via dblink)
-- c1 holds an open txn after acquire; c2 runs async, then c1 commits so c2
-- observes OCCUPIED (avoids deadlock waiting on c1's FOR UPDATE).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conn TEXT := 'host=127.0.0.1 port=5432 dbname=claw_lucky_07c2a user=postgres password=localtest';
  v_ok1 TEXT;
  v_msg2 TEXT;
  v_cnt INTEGER;
  v_sent INT;
BEGIN
  DELETE FROM public.user_subscription_slots WHERE user_id = 'user-c';
  DELETE FROM public.paypal_subscriptions WHERE user_id = 'user-c';

  PERFORM dblink_connect('c1', v_conn);
  PERFORM dblink_exec('c1', 'BEGIN');
  SELECT x INTO v_ok1 FROM dblink(
    'c1',
    $q$SELECT checkout_session_id::text FROM public.acquire_subscription_slot('user-c','monthly','P-PLAN-MONTHLY-TEST')$q$
  ) AS t(x TEXT);

  PERFORM dblink_connect('c2', v_conn);
  SELECT dblink_send_query(
    'c2',
    $q$SELECT checkout_session_id::text FROM public.acquire_subscription_slot('user-c','monthly','P-PLAN-MONTHLY-TEST')$q$
  ) INTO v_sent;

  -- Release c1 so c2 can proceed (async query already issued on independent connection).
  PERFORM dblink_exec('c1', 'COMMIT');
  PERFORM dblink_disconnect('c1');

  BEGIN
    PERFORM * FROM dblink_get_result('c2') AS t(x TEXT);
    v_msg2 := 'UNEXPECTED_SUCCESS';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg2 = MESSAGE_TEXT;
  END;
  -- drain result set / clear connection
  BEGIN
    PERFORM * FROM dblink_get_result('c2') AS t(x TEXT);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM dblink_disconnect('c2');

  SELECT COUNT(*) INTO v_cnt FROM public.paypal_subscriptions
   WHERE user_id='user-c' AND status='APPROVAL_PENDING';

  PERFORM pg_temp.assert_pass(
    'concurrent_same_user_acquire',
    v_ok1 IS NOT NULL
      AND v_msg2 ILIKE '%SUBSCRIPTION_SLOT_OCCUPIED%'
      AND v_cnt = 1,
    format('ok1=%s err=%s pending=%s', v_ok1, v_msg2, v_cnt)
  );
END $$;

-- ---------------------------------------------------------------------------
-- Bind cases
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sess TEXT;
  v_sub public.paypal_subscriptions;
  v_sub2 public.paypal_subscriptions;
BEGIN
  SELECT checkout_session_id INTO v_sess FROM _t_sessions WHERE user_id='user-a';

  v_sub := public.bind_paypal_subscription('user-a', v_sess, 'I-PAYPAL-SUB-A');
  v_sub2 := public.bind_paypal_subscription('user-a', v_sess, 'I-PAYPAL-SUB-A');
  PERFORM pg_temp.assert_pass(
    'idempotent_bind',
    v_sub.paypal_subscription_id = 'I-PAYPAL-SUB-A'
      AND v_sub2.paypal_subscription_id = 'I-PAYPAL-SUB-A'
      AND v_sub.id = v_sub2.id,
    v_sub.paypal_subscription_id
  );

  PERFORM pg_temp.assert_pass(
    'rebind_different_paypal_rejected',
    pg_temp.expect_exception(
      format($f$SELECT public.bind_paypal_subscription('user-a', %L, 'I-OTHER')$f$, v_sess),
      'PAYPAL_SUBSCRIPTION_ALREADY_BOUND'
    ),
    'ok'
  );

  SELECT checkout_session_id INTO v_sess FROM _t_sessions WHERE user_id='user-b';
  PERFORM pg_temp.assert_pass(
    'cross_user_bind_rejected',
    pg_temp.expect_exception(
      format($f$SELECT public.bind_paypal_subscription('user-a', %L, 'I-HIJACK')$f$, v_sess),
      'CHECKOUT_SESSION_OWNER_MISMATCH'
    ),
    'ok'
  );

  -- Bind user-b first, then try same PayPal id on a fresh user-d session
  PERFORM public.bind_paypal_subscription('user-b', v_sess, 'I-PAYPAL-SUB-B');
  PERFORM public.acquire_subscription_slot('user-d', 'monthly', 'P-PLAN-MONTHLY-TEST');
  SELECT checkout_session_id INTO v_sess FROM public.paypal_subscriptions
   WHERE user_id='user-d' AND status='APPROVAL_PENDING' ORDER BY created_at DESC LIMIT 1;
  PERFORM pg_temp.assert_pass(
    'duplicate_paypal_id_rejected',
    pg_temp.expect_exception(
      format($f$SELECT public.bind_paypal_subscription('user-d', %L, 'I-PAYPAL-SUB-B')$f$, v_sess),
      'PAYPAL_SUBSCRIPTION_ID_IN_USE'
    ),
    'ok'
  );
END $$;

-- ---------------------------------------------------------------------------
-- TTL: unbound expired vs bound protected (freeze time via checkout_expires_at)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_released INTEGER;
  v_still INTEGER;
BEGIN
  -- unbound expired
  DELETE FROM public.user_subscription_slots WHERE user_id='user-ttl-unbound';
  DELETE FROM public.paypal_subscriptions WHERE user_id='user-ttl-unbound';
  SELECT * INTO r FROM public.acquire_subscription_slot('user-ttl-unbound','monthly','P-PLAN-MONTHLY-TEST');
  UPDATE public.paypal_subscriptions
     SET checkout_expires_at = NOW() - INTERVAL '1 minute'
   WHERE id = r.subscription_id;
  SELECT public.expire_unstarted_subscription_session('user-ttl-unbound') INTO v_released;
  PERFORM pg_temp.assert_pass('expired_unbound_released', v_released = 1, format('n=%s', v_released));

  -- bound pending must NOT expire via TTL
  DELETE FROM public.user_subscription_slots WHERE user_id='user-ttl-bound';
  DELETE FROM public.paypal_subscriptions WHERE user_id='user-ttl-bound';
  SELECT * INTO r FROM public.acquire_subscription_slot('user-ttl-bound','monthly','P-PLAN-MONTHLY-TEST');
  PERFORM public.bind_paypal_subscription('user-ttl-bound', r.checkout_session_id, 'I-TTL-BOUND');
  UPDATE public.paypal_subscriptions
     SET checkout_expires_at = NOW() - INTERVAL '1 minute',
         status = 'APPROVAL_PENDING'
   WHERE id = r.subscription_id;
  SELECT public.expire_unstarted_subscription_session('user-ttl-bound') INTO v_still;
  PERFORM pg_temp.assert_pass('bound_pending_protected', v_still = 0, format('n=%s', v_still));
  PERFORM pg_temp.assert_pass(
    'bound_pending_still_occupied',
    EXISTS (
      SELECT 1 FROM public.user_subscription_slots
       WHERE user_id='user-ttl-bound' AND slot_state='OCCUPIED'
    ),
    'occupied'
  );
END $$;

-- ---------------------------------------------------------------------------
-- CANCELLED paid_through protection + ACTIVE/SUSPENDED no release
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_ok BOOLEAN;
  v_slot public.user_subscription_slots;
BEGIN
  DELETE FROM public.user_subscription_slots WHERE user_id='user-cancel';
  DELETE FROM public.paypal_subscriptions WHERE user_id='user-cancel';
  SELECT * INTO r FROM public.acquire_subscription_slot('user-cancel','monthly','P-PLAN-MONTHLY-TEST');
  PERFORM public.bind_paypal_subscription('user-cancel', r.checkout_session_id, 'I-CANCEL');
  UPDATE public.paypal_subscriptions
     SET status='CANCELLED',
         paid_through = NOW() + INTERVAL '10 days',
         cancelled_at = NOW()
   WHERE id = r.subscription_id;
  UPDATE public.user_subscription_slots
     SET release_after = NOW() + INTERVAL '10 days'
   WHERE user_id='user-cancel';
  SELECT public.release_subscription_slot_if_due('user-cancel') INTO v_ok;
  PERFORM pg_temp.assert_pass('cancelled_paid_through_protected', v_ok IS FALSE, format('ok=%s', v_ok));

  UPDATE public.user_subscription_slots
     SET release_after = NOW() - INTERVAL '1 minute'
   WHERE user_id='user-cancel';
  SELECT public.release_subscription_slot_if_due('user-cancel') INTO v_ok;
  SELECT * INTO v_slot FROM public.user_subscription_slots WHERE user_id='user-cancel';
  PERFORM pg_temp.assert_pass(
    'cancelled_due_released',
    v_ok IS TRUE AND v_slot.slot_state = 'RELEASED',
    format('ok=%s state=%s', v_ok, v_slot.slot_state)
  );

  -- ACTIVE
  DELETE FROM public.user_subscription_slots WHERE user_id='user-active';
  DELETE FROM public.paypal_subscriptions WHERE user_id='user-active';
  SELECT * INTO r FROM public.acquire_subscription_slot('user-active','monthly','P-PLAN-MONTHLY-TEST');
  PERFORM public.bind_paypal_subscription('user-active', r.checkout_session_id, 'I-ACTIVE');
  UPDATE public.paypal_subscriptions SET status='ACTIVE', paid_through=NOW()+INTERVAL '5 days' WHERE id=r.subscription_id;
  UPDATE public.user_subscription_slots SET release_after = NOW() - INTERVAL '1 day' WHERE user_id='user-active';
  SELECT public.release_subscription_slot_if_due('user-active') INTO v_ok;
  PERFORM pg_temp.assert_pass('active_not_released', v_ok IS FALSE, format('ok=%s', v_ok));

  -- SUSPENDED
  UPDATE public.paypal_subscriptions SET status='SUSPENDED' WHERE id=r.subscription_id;
  SELECT public.release_subscription_slot_if_due('user-active') INTO v_ok;
  PERFORM pg_temp.assert_pass('suspended_not_released', v_ok IS FALSE, format('ok=%s', v_ok));
END $$;

-- ---------------------------------------------------------------------------
-- Webhook idempotency / sale / failed / regression / refund
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  o RECORD;
  v_paid1 TIMESTAMPTZ;
  v_paid2 TIMESTAMPTZ;
  v_pts BIGINT;
  v_tix BIGINT;
  v_coins BIGINT;
BEGIN
  DELETE FROM public.paypal_subscription_transactions WHERE paypal_subscription_id LIKE 'I-WH-%';
  DELETE FROM public.payment_webhook_events WHERE paypal_event_id LIKE 'WH-07C2A-%';
  DELETE FROM public.user_subscription_slots WHERE user_id='user-wh';
  DELETE FROM public.paypal_subscriptions WHERE user_id='user-wh';

  SELECT * INTO r FROM public.acquire_subscription_slot('user-wh','monthly','P-PLAN-MONTHLY-TEST');
  PERFORM public.bind_paypal_subscription('user-wh', r.checkout_session_id, 'I-WH-1');
  UPDATE public.paypal_subscriptions SET status='ACTIVE', recurring_amount=5.00, currency='USD' WHERE user_id='user-wh';

  SELECT * INTO o FROM public.process_paypal_subscription_webhook_event(
    'WH-07C2A-SALE-1', 'PAYMENT.SALE.COMPLETED', 'I-WH-1', 'SALE-1',
    5.00, 'USD', NOW(), NOW() + INTERVAL '1 month', NULL, NULL,
    '{"source":"test"}'::jsonb, NULL
  );
  SELECT paid_through INTO v_paid1 FROM public.paypal_subscriptions WHERE user_id='user-wh';
  PERFORM pg_temp.assert_pass('sale_extends', o.outcome='processed' AND v_paid1 IS NOT NULL, o.outcome);

  SELECT * INTO o FROM public.process_paypal_subscription_webhook_event(
    'WH-07C2A-SALE-1', 'PAYMENT.SALE.COMPLETED', 'I-WH-1', 'SALE-1',
    5.00, 'USD', NOW(), NOW() + INTERVAL '2 month', NULL, NULL,
    '{"source":"test"}'::jsonb, NULL
  );
  SELECT paid_through INTO v_paid2 FROM public.paypal_subscriptions WHERE user_id='user-wh';
  PERFORM pg_temp.assert_pass(
    'webhook_event_idempotency',
    o.outcome='duplicate' AND v_paid2 = v_paid1,
    format('outcome=%s', o.outcome)
  );

  SELECT * INTO o FROM public.process_paypal_subscription_webhook_event(
    'WH-07C2A-SALE-2', 'PAYMENT.SALE.COMPLETED', 'I-WH-1', 'SALE-1',
    5.00, 'USD', NOW(), NOW() + INTERVAL '3 month', NULL, NULL,
    '{"source":"test"}'::jsonb, NULL
  );
  SELECT paid_through INTO v_paid2 FROM public.paypal_subscriptions WHERE user_id='user-wh';
  PERFORM pg_temp.assert_pass(
    'sale_idempotency',
    o.outcome='duplicate' AND v_paid2 = v_paid1,
    format('outcome=%s paid=%s', o.outcome, v_paid2)
  );

  SELECT * INTO o FROM public.process_paypal_subscription_webhook_event(
    'WH-07C2A-FAIL-1', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'I-WH-1', NULL,
    NULL, NULL, NOW(), NULL, NULL, NULL,
    '{"source":"test"}'::jsonb, NULL
  );
  SELECT paid_through INTO v_paid2 FROM public.paypal_subscriptions WHERE user_id='user-wh';
  PERFORM pg_temp.assert_pass(
    'failed_payment_no_extend',
    o.outcome='processed' AND v_paid2 = v_paid1,
    format('paid=%s', v_paid2)
  );

  UPDATE public.paypal_subscriptions SET status='CANCELLED', cancelled_at=NOW() WHERE user_id='user-wh';
  SELECT * INTO o FROM public.process_paypal_subscription_webhook_event(
    'WH-07C2A-REGRESS-1', 'BILLING.SUBSCRIPTION.ACTIVATED', 'I-WH-1', NULL,
    NULL, NULL, NOW(), NULL, 'ACTIVE', NULL,
    '{"source":"test"}'::jsonb, NULL
  );
  PERFORM pg_temp.assert_pass(
    'state_regression_protection',
    o.outcome='ignored'
      AND o.error_code='STATUS_REGRESSION_FORBIDDEN'
      AND (SELECT status FROM public.paypal_subscriptions WHERE user_id='user-wh') = 'CANCELLED',
    format('outcome=%s err=%s', o.outcome, o.error_code)
  );

  -- Restore ACTIVE for refund path using service update (test setup)
  UPDATE public.paypal_subscriptions SET status='ACTIVE', access_blocked_at=NULL, access_block_reason=NULL
   WHERE user_id='user-wh';

  SELECT * INTO o FROM public.process_paypal_subscription_webhook_event(
    'WH-07C2A-REFUND-1', 'PAYMENT.SALE.REFUNDED', 'I-WH-1', 'SALE-1',
    5.00, 'USD', NOW(), NULL, NULL, TRUE,
    '{"source":"test"}'::jsonb, NULL
  );
  PERFORM pg_temp.assert_pass(
    'refund_reversal_audit',
    o.outcome='processed'
      AND (SELECT access_blocked_at IS NOT NULL FROM public.paypal_subscriptions WHERE user_id='user-wh')
      AND (SELECT access_block_reason FROM public.paypal_subscriptions WHERE user_id='user-wh') = 'FULL_REFUND'
      AND (SELECT needs_review AND reason_code='FULL_REFUND'
             FROM public.paypal_subscription_transactions WHERE paypal_sale_id='SALE-1'),
    format('outcome=%s', o.outcome)
  );

  SELECT points, tickets, coins INTO v_pts, v_tix, v_coins FROM public.users WHERE user_id='user-a';
  PERFORM pg_temp.assert_pass(
    'wallet_still_untouched',
    v_pts = 100 AND v_tix = 7 AND v_coins = 33,
    format('p=%s t=%s c=%s', v_pts, v_tix, v_coins)
  );
END $$;

-- ---------------------------------------------------------------------------
-- RLS / grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt INTEGER;
  v_ok BOOLEAN;
  v_msg TEXT;
BEGIN
  -- Owner SELECT
  PERFORM set_config('request.jwt.claim.sub', 'user-a', true);
  EXECUTE 'SET ROLE authenticated';
  SELECT COUNT(*) INTO v_cnt FROM public.paypal_subscriptions WHERE user_id='user-a';
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert_pass('owner_select', v_cnt >= 1, format('n=%s', v_cnt));

  -- Cross-user SELECT blocked
  PERFORM set_config('request.jwt.claim.sub', 'user-b', true);
  EXECUTE 'SET ROLE authenticated';
  SELECT COUNT(*) INTO v_cnt FROM public.paypal_subscriptions WHERE user_id='user-a';
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert_pass('cross_user_select_blocked', v_cnt = 0, format('n=%s', v_cnt));

  -- Anon mutation blocked
  EXECUTE 'SET ROLE anon';
  BEGIN
    INSERT INTO public.paypal_subscriptions (
      user_id, checkout_session_id, paypal_plan_id, plan_code, status, currency, recurring_amount
    ) VALUES ('x','sess-anon','P','monthly','APPROVAL_PENDING','USD',5.00);
    v_ok := false;
    v_msg := 'inserted';
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert_pass('anon_mutation_blocked', v_ok, v_msg);

  -- Authenticated mutation blocked
  PERFORM set_config('request.jwt.claim.sub', 'user-a', true);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    UPDATE public.paypal_subscriptions SET status='ACTIVE' WHERE user_id='user-a';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_ok := (v_cnt = 0);
    v_msg := format('updated=%s', v_cnt);
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert_pass('authenticated_mutation_blocked', v_ok, v_msg);

  -- RPC execute restricted
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    PERFORM public.acquire_subscription_slot('user-a','monthly','P-X');
    v_ok := false;
    v_msg := 'executed';
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
    v_msg := 'insufficient_privilege';
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_ok := position('permission denied' in lower(v_msg)) > 0;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert_pass('rpc_execute_restricted', v_ok, v_msg);

  -- service_role can execute
  EXECUTE 'SET ROLE service_role';
  BEGIN
    -- may fail for business reason (slot occupied) but must be allowed to EXECUTE
    BEGIN
      PERFORM public.release_subscription_slot_if_due('user-a');
      v_ok := true;
      v_msg := 'ok';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      v_ok := position('permission denied' in lower(v_msg)) = 0;
    END;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert_pass('service_role_rpc_allowed', v_ok, v_msg);

  -- SECURITY DEFINER search_path
  PERFORM pg_temp.assert_pass(
    'security_definer_search_path',
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public'
       AND p.proname='acquire_subscription_slot'
       AND p.prosecdef
       AND pg_get_function_identity_arguments(p.oid)='p_user_id text, p_plan_code text, p_paypal_plan_id text'
       AND (SELECT unnest(proconfig) FROM pg_proc WHERE oid=p.oid LIMIT 1) LIKE 'search_path=%'
    )
    OR EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='acquire_subscription_slot' AND p.prosecdef
       AND EXISTS (
         SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
          WHERE cfg LIKE 'search_path=public, pg_temp' OR cfg LIKE 'search_path=public,pg_temp'
       )
    ),
    'checked'
  );

  -- Explicit search_path check
  SELECT COUNT(*) INTO v_cnt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN (
       'acquire_subscription_slot','bind_paypal_subscription',
       'expire_unstarted_subscription_session','release_subscription_slot_if_due',
       'process_paypal_subscription_webhook_event'
     )
     AND p.prosecdef
     AND EXISTS (
       SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search_path=%public%pg_temp%'
     );
  PERFORM pg_temp.assert_pass('security_definer_search_path', v_cnt = 5, format('n=%s', v_cnt));
END $$;

-- Summary
SELECT test_name, status, detail FROM _t_results ORDER BY test_name;
SELECT
  COUNT(*) FILTER (WHERE status='PASS') AS passed,
  COUNT(*) FILTER (WHERE status='FAIL') AS failed,
  COUNT(*) AS total
FROM _t_results;
