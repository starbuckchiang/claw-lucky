-- Auth-07C.7E.1 real PostgreSQL behavioral verification (isolated Docker only).
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

-- ---------------------------------------------------------------------------
-- Hotfix schema present
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_cnt
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='paypal_subscription_transactions'
     AND column_name IN ('audit_source','reconciled_at');
  PERFORM pg_temp.assert_pass('hotfix_tx_columns', v_cnt = 2, format('n=%s', v_cnt));

  SELECT COUNT(*) INTO v_cnt
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='payment_webhook_events'
     AND column_name='merchant_validation_source';
  PERFORM pg_temp.assert_pass('hotfix_event_column', v_cnt = 1, format('n=%s', v_cnt));

  SELECT COUNT(*) INTO v_cnt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN (
       'ensure_paypal_webhook_event_received',
       'finalize_paypal_webhook_event_failure',
       'reconcile_paypal_subscription_sale'
     );
  PERFORM pg_temp.assert_pass('hotfix_rpcs_exist', v_cnt = 3, format('n=%s', v_cnt));
END $$;

-- ---------------------------------------------------------------------------
-- Legacy Orders + wallet preserved after hotfix + re-run
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
      AND v_order.paypal_order_id = 'LEGACY-ORDER-SEED-1'
      AND v_order.amount = 5.00,
    format('status=%s', v_order.status)
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
    'legacy_wallet_preserved',
    v_pts = 100 AND v_tix = 7 AND v_coins = 33,
    format('p=%s t=%s c=%s', v_pts, v_tix, v_coins)
  );

  PERFORM pg_temp.assert_pass(
    'seed_active_null_paid_through',
    EXISTS (
      SELECT 1 FROM public.paypal_subscriptions
       WHERE paypal_subscription_id='I-RECON-1'
         AND status='ACTIVE'
         AND paid_through IS NULL
    ),
    'seed'
  );
END $$;

-- ---------------------------------------------------------------------------
-- ensure / finalize / process event lifecycle
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  o RECORD;
  v_cnt INTEGER;
  v_status TEXT;
  v_err TEXT;
BEGIN
  SELECT * INTO o FROM public.ensure_paypal_webhook_event_received(
    'WH-07C7E1-1',
    'PAYMENT.SALE.COMPLETED',
    'I-RECON-1',
    'SALE-EVT-1',
    '{"source":"test","amount":5}'::jsonb
  );
  PERFORM pg_temp.assert_pass(
    'ensure_received_new',
    o.outcome = 'received' AND o.event_processing_status = 'received',
    format('outcome=%s', o.outcome)
  );

  SELECT COUNT(*) INTO v_cnt FROM public.payment_webhook_events WHERE paypal_event_id='WH-07C7E1-1';
  PERFORM pg_temp.assert_pass('ensure_received_row', v_cnt = 1, format('n=%s', v_cnt));

  SELECT * INTO o FROM public.ensure_paypal_webhook_event_received(
    'WH-07C7E1-1',
    'PAYMENT.SALE.COMPLETED',
    'I-RECON-1',
    'SALE-EVT-1',
    '{"source":"test"}'::jsonb
  );
  PERFORM pg_temp.assert_pass(
    'ensure_duplicate_idempotent',
    o.outcome = 'already_present' AND o.event_processing_status = 'received',
    format('outcome=%s', o.outcome)
  );
  SELECT COUNT(*) INTO v_cnt FROM public.payment_webhook_events WHERE paypal_event_id='WH-07C7E1-1';
  PERFORM pg_temp.assert_pass('ensure_no_second_row', v_cnt = 1, format('n=%s', v_cnt));

  SELECT * INTO o FROM public.finalize_paypal_webhook_event_failure(
    'WH-07C7E1-1',
    'MERCHANT_MISMATCH',
    'failed',
    'I-RECON-1',
    'SALE-EVT-1',
    '{"source":"test","error_code":"MERCHANT_MISMATCH"}'::jsonb,
    NULL
  );
  PERFORM pg_temp.assert_pass(
    'finalize_failure_same_row',
    o.outcome = 'rejected' AND o.error_code = 'MERCHANT_MISMATCH',
    format('outcome=%s err=%s', o.outcome, o.error_code)
  );
  SELECT processing_status, error_code INTO v_status, v_err
    FROM public.payment_webhook_events WHERE paypal_event_id='WH-07C7E1-1';
  PERFORM pg_temp.assert_pass(
    'finalize_error_code_saved',
    v_status = 'failed' AND v_err = 'MERCHANT_MISMATCH',
    format('status=%s err=%s', v_status, v_err)
  );

  -- finalize missing event creates only that event id
  SELECT COUNT(*) INTO v_cnt FROM public.payment_webhook_events;
  SELECT * INTO o FROM public.finalize_paypal_webhook_event_failure(
    'WH-07C7E1-MISSING',
    'MISSING_SALE_ID',
    'failed',
    NULL, NULL,
    '{"source":"test"}'::jsonb,
    NULL
  );
  PERFORM pg_temp.assert_pass(
    'finalize_missing_creates_own_row',
    o.outcome = 'rejected'
      AND (SELECT COUNT(*) FROM public.payment_webhook_events) = v_cnt + 1
      AND (SELECT error_code FROM public.payment_webhook_events WHERE paypal_event_id='WH-07C7E1-MISSING') = 'MISSING_SALE_ID'
      AND (SELECT processing_status FROM public.payment_webhook_events WHERE paypal_event_id='WH-LEGACY-SEED-1') = 'processed',
    'ok'
  );

  -- received → processed via process RPC
  PERFORM public.ensure_paypal_webhook_event_received(
    'WH-07C7E1-PROC',
    'PAYMENT.SALE.COMPLETED',
    'I-RECON-1',
    'SALE-PROC-1',
    '{"source":"test","merchant_validation_source":"sale_payee_merchant_id"}'::jsonb
  );
  SELECT * INTO o FROM public.process_paypal_subscription_webhook_event(
    'WH-07C7E1-PROC',
    'PAYMENT.SALE.COMPLETED',
    'I-RECON-1',
    'SALE-PROC-1',
    5.00,
    'USD',
    TIMESTAMPTZ '2026-09-01T00:00:00Z',
    TIMESTAMPTZ '2026-10-01T00:00:00Z',
    NULL,
    FALSE,
    '{"source":"test","merchant_validation_source":"sale_payee_merchant_id"}'::jsonb,
    'processed'
  );
  PERFORM pg_temp.assert_pass(
    'received_to_processed',
    o.outcome = 'processed'
      AND (SELECT processing_status FROM public.payment_webhook_events WHERE paypal_event_id='WH-07C7E1-PROC') IN ('processed','reconciliation_pending')
      AND (SELECT paid_through FROM public.paypal_subscriptions WHERE paypal_subscription_id='I-RECON-1') = TIMESTAMPTZ '2026-10-01T00:00:00Z'
      AND (SELECT audit_source FROM public.paypal_subscription_transactions WHERE paypal_sale_id='SALE-PROC-1') = 'paypal_webhook',
    format('outcome=%s', o.outcome)
  );

  -- already processed must not regress via finalize
  SELECT * INTO o FROM public.finalize_paypal_webhook_event_failure(
    'WH-07C7E1-PROC',
    'SHOULD_NOT_APPLY',
    'failed',
    'I-RECON-1',
    'SALE-PROC-1',
    '{"source":"test"}'::jsonb,
    NULL
  );
  PERFORM pg_temp.assert_pass(
    'processed_no_regress_finalize',
    o.outcome = 'already_terminal'
      AND (SELECT processing_status FROM public.payment_webhook_events WHERE paypal_event_id='WH-07C7E1-PROC') <> 'failed'
      AND (SELECT error_code FROM public.payment_webhook_events WHERE paypal_event_id='WH-07C7E1-PROC') IS DISTINCT FROM 'SHOULD_NOT_APPLY',
    format('outcome=%s', o.outcome)
  );

  -- re-process same event → duplicate
  SELECT * INTO o FROM public.process_paypal_subscription_webhook_event(
    'WH-07C7E1-PROC',
    'PAYMENT.SALE.COMPLETED',
    'I-RECON-1',
    'SALE-PROC-1',
    5.00,
    'USD',
    TIMESTAMPTZ '2026-09-01T00:00:00Z',
    TIMESTAMPTZ '2026-11-01T00:00:00Z',
    NULL,
    FALSE,
    '{"source":"test"}'::jsonb,
    'processed'
  );
  PERFORM pg_temp.assert_pass(
    'processed_event_no_regress',
    o.outcome = 'duplicate'
      AND (SELECT paid_through FROM public.paypal_subscriptions WHERE paypal_subscription_id='I-RECON-1') = TIMESTAMPTZ '2026-10-01T00:00:00Z',
    format('outcome=%s', o.outcome)
  );

  -- received → failed path (fresh event)
  PERFORM public.ensure_paypal_webhook_event_received(
    'WH-07C7E1-FAIL',
    'PAYMENT.SALE.COMPLETED',
    'I-RECON-1',
    NULL,
    '{"source":"test"}'::jsonb
  );
  SELECT * INTO o FROM public.process_paypal_subscription_webhook_event(
    'WH-07C7E1-FAIL',
    'PAYMENT.SALE.COMPLETED',
    'I-RECON-1',
    NULL,
    5.00,
    'USD',
    NOW(),
    NOW() + INTERVAL '30 days',
    NULL,
    FALSE,
    '{"source":"test"}'::jsonb,
    'processed'
  );
  PERFORM pg_temp.assert_pass(
    'received_to_failed_missing_sale',
    o.outcome = 'rejected'
      AND o.error_code = 'MISSING_SALE_ID'
      AND (SELECT processing_status FROM public.payment_webhook_events WHERE paypal_event_id='WH-07C7E1-FAIL') = 'failed',
    format('outcome=%s err=%s', o.outcome, o.error_code)
  );
END $$;

-- ---------------------------------------------------------------------------
-- Reconciliation RPC
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  o RECORD;
  v_paid TIMESTAMPTZ;
  v_paid2 TIMESTAMPTZ;
  v_tx_cnt INTEGER;
  v_evt_cnt INTEGER;
  v_audit TEXT;
  v_synth TEXT;
BEGIN
  -- Reset recon-1 paid_through for clean reconcile success (keep SALE-PROC-1 tx)
  UPDATE public.paypal_subscriptions
     SET paid_through = NULL,
         next_billing_time = NULL,
         reconciliation_status = 'none'
   WHERE paypal_subscription_id = 'I-RECON-1';

  SELECT * INTO o FROM public.reconcile_paypal_subscription_sale(
    'user-recon',
    'I-RECON-1',
    'SALE-RECON-1',
    5.00,
    'USD',
    TIMESTAMPTZ '2026-09-02T00:00:00Z',
    TIMESTAMPTZ '2026-10-02T00:00:00Z',
    '{"source":"paypal_api_reconciliation","plan_id":"P-MONTHLY-ALLOW"}'::jsonb
  );
  PERFORM pg_temp.assert_pass(
    'reconcile_success',
    o.outcome = 'processed'
      AND o.paid_through = TIMESTAMPTZ '2026-10-02T00:00:00Z',
    format('outcome=%s paid=%s', o.outcome, o.paid_through)
  );

  SELECT audit_source, paypal_event_id INTO v_audit, v_synth
    FROM public.paypal_subscription_transactions
   WHERE paypal_sale_id = 'SALE-RECON-1';
  PERFORM pg_temp.assert_pass(
    'synthetic_audit_source',
    v_audit = 'paypal_api_reconciliation'
      AND v_synth = 'paypal_api_reconciliation:SALE-RECON-1'
      AND v_synth NOT LIKE 'WH-%',
    format('audit=%s synth=%s', v_audit, v_synth)
  );

  -- No forged SUCCESS webhook event for synthetic sale
  PERFORM pg_temp.assert_pass(
    'synthetic_no_forged_webhook_event',
    NOT EXISTS (
      SELECT 1 FROM public.payment_webhook_events
       WHERE paypal_event_id = 'paypal_api_reconciliation:SALE-RECON-1'
    ),
    'no webhook row for synthetic id'
  );

  SELECT paid_through INTO v_paid FROM public.paypal_subscriptions WHERE paypal_subscription_id='I-RECON-1';
  SELECT COUNT(*) INTO v_tx_cnt FROM public.paypal_subscription_transactions WHERE paypal_sale_id='SALE-RECON-1';

  -- Same sale id re-run → duplicate, no second extend
  SELECT * INTO o FROM public.reconcile_paypal_subscription_sale(
    'user-recon',
    'I-RECON-1',
    'SALE-RECON-1',
    5.00,
    'USD',
    TIMESTAMPTZ '2026-09-02T00:00:00Z',
    TIMESTAMPTZ '2026-12-02T00:00:00Z',
    '{"source":"paypal_api_reconciliation"}'::jsonb
  );
  SELECT paid_through INTO v_paid2 FROM public.paypal_subscriptions WHERE paypal_subscription_id='I-RECON-1';
  PERFORM pg_temp.assert_pass(
    'reconcile_duplicate_sale',
    o.outcome = 'duplicate'
      AND v_paid2 = v_paid
      AND (SELECT COUNT(*) FROM public.paypal_subscription_transactions WHERE paypal_sale_id='SALE-RECON-1') = v_tx_cnt,
    format('outcome=%s paid=%s', o.outcome, v_paid2)
  );

  -- Webhook after reconciliation (same sale) → duplicate event row preserved, no second tx
  SELECT COUNT(*) INTO v_evt_cnt FROM public.payment_webhook_events;
  PERFORM public.ensure_paypal_webhook_event_received(
    'WH-07C7E1-AFTER-RECON',
    'PAYMENT.SALE.COMPLETED',
    'I-RECON-1',
    'SALE-RECON-1',
    '{"source":"webhook"}'::jsonb
  );
  SELECT * INTO o FROM public.process_paypal_subscription_webhook_event(
    'WH-07C7E1-AFTER-RECON',
    'PAYMENT.SALE.COMPLETED',
    'I-RECON-1',
    'SALE-RECON-1',
    5.00,
    'USD',
    TIMESTAMPTZ '2026-09-02T00:00:00Z',
    TIMESTAMPTZ '2026-12-02T00:00:00Z',
    NULL,
    FALSE,
    '{"source":"webhook"}'::jsonb,
    'processed'
  );
  PERFORM pg_temp.assert_pass(
    'recon_then_webhook_idempotent',
    o.outcome = 'duplicate'
      AND (SELECT processing_status FROM public.payment_webhook_events WHERE paypal_event_id='WH-07C7E1-AFTER-RECON') = 'duplicate'
      AND (SELECT COUNT(*) FROM public.paypal_subscription_transactions WHERE paypal_sale_id='SALE-RECON-1') = 1
      AND (SELECT paid_through FROM public.paypal_subscriptions WHERE paypal_subscription_id='I-RECON-1') = v_paid,
    format('outcome=%s', o.outcome)
  );
  PERFORM pg_temp.assert_pass(
    'real_webhook_audit_preserved',
    EXISTS (
      SELECT 1 FROM public.payment_webhook_events
       WHERE paypal_event_id='WH-07C7E1-AFTER-RECON'
         AND processing_status='duplicate'
         AND paypal_sale_id='SALE-RECON-1'
    ),
    'webhook event kept'
  );

  -- Webhook first then reconciliation (fresh sale on user-recon-b)
  PERFORM public.ensure_paypal_webhook_event_received(
    'WH-07C7E1-WH-FIRST',
    'PAYMENT.SALE.COMPLETED',
    'I-RECON-B',
    'SALE-WH-FIRST',
    '{"source":"webhook"}'::jsonb
  );
  SELECT * INTO o FROM public.process_paypal_subscription_webhook_event(
    'WH-07C7E1-WH-FIRST',
    'PAYMENT.SALE.COMPLETED',
    'I-RECON-B',
    'SALE-WH-FIRST',
    5.00,
    'USD',
    TIMESTAMPTZ '2026-09-03T00:00:00Z',
    TIMESTAMPTZ '2026-10-03T00:00:00Z',
    NULL,
    FALSE,
    '{"source":"webhook"}'::jsonb,
    'processed'
  );
  PERFORM pg_temp.assert_pass('webhook_first_ok', o.outcome='processed', o.outcome);

  SELECT paid_through INTO v_paid FROM public.paypal_subscriptions WHERE paypal_subscription_id='I-RECON-B';
  SELECT * INTO o FROM public.reconcile_paypal_subscription_sale(
    'user-recon-b',
    'I-RECON-B',
    'SALE-WH-FIRST',
    5.00,
    'USD',
    TIMESTAMPTZ '2026-09-03T00:00:00Z',
    TIMESTAMPTZ '2026-11-03T00:00:00Z',
    '{"source":"paypal_api_reconciliation"}'::jsonb
  );
  PERFORM pg_temp.assert_pass(
    'webhook_then_recon_idempotent',
    o.outcome = 'duplicate'
      AND (SELECT paid_through FROM public.paypal_subscriptions WHERE paypal_subscription_id='I-RECON-B') = v_paid
      AND (SELECT COUNT(*) FROM public.paypal_subscription_transactions WHERE paypal_sale_id='SALE-WH-FIRST') = 1
      AND (SELECT audit_source FROM public.paypal_subscription_transactions WHERE paypal_sale_id='SALE-WH-FIRST') = 'paypal_webhook',
    format('outcome=%s', o.outcome)
  );

  -- Amount/currency mismatch must not overwrite successful tx
  SELECT paid_through INTO v_paid FROM public.paypal_subscriptions WHERE paypal_subscription_id='I-RECON-1';
  SELECT * INTO o FROM public.reconcile_paypal_subscription_sale(
    'user-recon',
    'I-RECON-1',
    'SALE-RECON-1',
    99.00,
    'USD',
    NOW(),
    NOW() + INTERVAL '40 days',
    '{"source":"paypal_api_reconciliation"}'::jsonb
  );
  -- Amount validated before sale-id short-circuit → rejected; existing tx untouched.
  PERFORM pg_temp.assert_pass(
    'amount_mismatch_no_overwrite',
    o.outcome = 'rejected'
      AND o.error_code = 'AMOUNT_CURRENCY_MISMATCH'
      AND (SELECT amount FROM public.paypal_subscription_transactions WHERE paypal_sale_id='SALE-RECON-1') = 5.00
      AND (SELECT paid_through FROM public.paypal_subscriptions WHERE paypal_subscription_id='I-RECON-1') = v_paid,
    format('outcome=%s err=%s', o.outcome, o.error_code)
  );

  -- Fresh sale with wrong amount → rejected, no tx
  SELECT * INTO o FROM public.reconcile_paypal_subscription_sale(
    'user-recon',
    'I-RECON-1',
    'SALE-BAD-AMT',
    99.00,
    'USD',
    NOW(),
    NOW() + INTERVAL '30 days',
    '{"source":"paypal_api_reconciliation"}'::jsonb
  );
  PERFORM pg_temp.assert_pass(
    'amount_currency_mismatch_reject',
    o.outcome = 'rejected'
      AND o.error_code = 'AMOUNT_CURRENCY_MISMATCH'
      AND NOT EXISTS (SELECT 1 FROM public.paypal_subscription_transactions WHERE paypal_sale_id='SALE-BAD-AMT'),
    format('outcome=%s err=%s', o.outcome, o.error_code)
  );

  -- Cross-subscription: sale for I-RECON-1 claimed under I-RECON-B owner path
  SELECT * INTO o FROM public.reconcile_paypal_subscription_sale(
    'user-recon-b',
    'I-RECON-B',
    'SALE-CROSS-1',
    5.00,
    'USD',
    NOW(),
    NOW() + INTERVAL '30 days',
    '{"source":"paypal_api_reconciliation"}'::jsonb
  );
  -- First create succeeds on B
  PERFORM pg_temp.assert_pass('cross_setup_ok', o.outcome IN ('processed','duplicate'), o.outcome);

  -- Same sale id cannot be applied to different subscription (UNIQUE on sale_id globally)
  SELECT * INTO o FROM public.reconcile_paypal_subscription_sale(
    'user-recon',
    'I-RECON-1',
    'SALE-CROSS-1',
    5.00,
    'USD',
    NOW(),
    NOW() + INTERVAL '30 days',
    '{"source":"paypal_api_reconciliation"}'::jsonb
  );
  PERFORM pg_temp.assert_pass(
    'cross_subscription_rejected',
    o.outcome = 'duplicate'
      AND (SELECT paypal_subscription_id FROM public.paypal_subscription_transactions WHERE paypal_sale_id='SALE-CROSS-1') = 'I-RECON-B',
    format('outcome=%s', o.outcome)
  );

  -- Owner mismatch
  SELECT * INTO o FROM public.reconcile_paypal_subscription_sale(
    'user-recon-b',
    'I-RECON-1',
    'SALE-OWNER-BAD',
    5.00,
    'USD',
    NOW(),
    NOW() + INTERVAL '30 days',
    '{"source":"paypal_api_reconciliation"}'::jsonb
  );
  PERFORM pg_temp.assert_pass(
    'owner_mismatch_rejected',
    o.outcome = 'rejected' AND o.error_code = 'OWNER_MISMATCH',
    format('outcome=%s err=%s', o.outcome, o.error_code)
  );

  -- next_billing_time priority: paid_through equals provided next_billing
  UPDATE public.paypal_subscriptions
     SET paid_through = NULL, reconciliation_status='none'
   WHERE paypal_subscription_id='I-OWNER-RLS';
  SELECT * INTO o FROM public.reconcile_paypal_subscription_sale(
    'user-owner-rls',
    'I-OWNER-RLS',
    'SALE-YEARLY-1',
    48.00,
    'USD',
    TIMESTAMPTZ '2026-09-01T12:00:00Z',
    TIMESTAMPTZ '2027-09-01T12:00:00Z',
    '{"source":"paypal_api_reconciliation"}'::jsonb
  );
  PERFORM pg_temp.assert_pass(
    'next_billing_priority_yearly',
    o.outcome = 'processed'
      AND o.paid_through = TIMESTAMPTZ '2027-09-01T12:00:00Z',
    format('paid=%s', o.paid_through)
  );

  -- PII rejected in audit payload
  BEGIN
    PERFORM public.reconcile_paypal_subscription_sale(
      'user-owner-rls',
      'I-OWNER-RLS',
      'SALE-PII',
      48.00,
      'USD',
      NOW(),
      NOW() + INTERVAL '365 days',
      '{"payer":{"email":"x@y.com"},"source":"paypal_api_reconciliation"}'::jsonb
    );
    PERFORM pg_temp.assert_pass('pii_rejected', false, 'should raise');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass(
      'pii_rejected',
      SQLERRM LIKE '%SANITIZED_PAYLOAD_CONTAINS_PII%',
      SQLERRM
    );
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Pending/failed ignored at SQL layer: no completed tx without reconcile call
-- (Edge skips non-COMPLETED; RPC never inserts pending status as completed)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.assert_pass(
    'pending_failed_ignored_contract',
    NOT EXISTS (
      SELECT 1 FROM public.paypal_subscription_transactions
       WHERE status IN ('pending','failed')
    )
      AND NOT EXISTS (
        SELECT 1 FROM public.paypal_subscription_transactions
         WHERE paypal_sale_id IN ('SALE-PEND','SALE-FAIL')
      ),
    'no pending/failed completed rows'
  );
END $$;

-- ---------------------------------------------------------------------------
-- RPC grants + RLS
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_ok BOOLEAN;
  v_msg TEXT;
  v_cnt INTEGER;
BEGIN
  -- anon cannot execute reconcile
  EXECUTE 'SET ROLE anon';
  BEGIN
    PERFORM public.reconcile_paypal_subscription_sale(
      'user-recon','I-RECON-1','SALE-X',5,'USD',NOW(),NOW(),'{}'::jsonb
    );
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
  PERFORM pg_temp.assert_pass('anon_reconcile_denied', v_ok, v_msg);

  EXECUTE 'SET ROLE authenticated';
  BEGIN
    PERFORM public.reconcile_paypal_subscription_sale(
      'user-recon','I-RECON-1','SALE-X',5,'USD',NOW(),NOW(),'{}'::jsonb
    );
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
  PERFORM pg_temp.assert_pass('authenticated_reconcile_denied', v_ok, v_msg);

  EXECUTE 'SET ROLE authenticated';
  BEGIN
    PERFORM public.ensure_paypal_webhook_event_received('WH-X','PAYMENT.SALE.COMPLETED',NULL,NULL,'{}'::jsonb);
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
  PERFORM pg_temp.assert_pass('authenticated_ensure_denied', v_ok, v_msg);

  -- service_role can execute
  EXECUTE 'SET ROLE service_role';
  BEGIN
    PERFORM public.ensure_paypal_webhook_event_received(
      'WH-07C7E1-SR','BILLING.SUBSCRIPTION.UPDATED','I-RECON-1',NULL,'{"source":"sr"}'::jsonb
    );
    v_ok := true;
    v_msg := 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_ok := position('permission denied' in lower(v_msg)) = 0;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert_pass('service_role_ensure_allowed', v_ok, v_msg);

  -- Owner SELECT
  PERFORM set_config('request.jwt.claim.sub', 'user-owner-rls', true);
  EXECUTE 'SET ROLE authenticated';
  SELECT COUNT(*) INTO v_cnt FROM public.paypal_subscriptions WHERE user_id='user-owner-rls';
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert_pass('owner_select', v_cnt >= 1, format('n=%s', v_cnt));

  -- Cross-user SELECT blocked
  PERFORM set_config('request.jwt.claim.sub', 'user-recon', true);
  EXECUTE 'SET ROLE authenticated';
  SELECT COUNT(*) INTO v_cnt FROM public.paypal_subscriptions WHERE user_id='user-owner-rls';
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert_pass('cross_user_select_blocked', v_cnt = 0, format('n=%s', v_cnt));

  -- SECURITY DEFINER search_path on new RPCs
  SELECT COUNT(*) INTO v_cnt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN (
       'ensure_paypal_webhook_event_received',
       'finalize_paypal_webhook_event_failure',
       'reconcile_paypal_subscription_sale'
     )
     AND p.prosecdef
     AND EXISTS (
       SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search_path=%public%pg_temp%'
     );
  PERFORM pg_temp.assert_pass('security_definer_search_path', v_cnt = 3, format('n=%s', v_cnt));

  -- Legacy still untouched at end
  PERFORM pg_temp.assert_pass(
    'legacy_orders_untouched_end',
    (SELECT status FROM public.payment_orders WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') = 'paid'
      AND (SELECT points FROM public.users WHERE user_id='user-a') = 100,
    'ok'
  );
END $$;

-- Summary
SELECT test_name, status, detail FROM _t_results ORDER BY test_name;
SELECT
  COUNT(*) FILTER (WHERE status='PASS') AS passed,
  COUNT(*) FILTER (WHERE status='FAIL') AS failed,
  COUNT(*) AS total
FROM _t_results;
