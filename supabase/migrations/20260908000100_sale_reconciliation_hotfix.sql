-- Auth-07C.7E: SALE early-200 persist fix + transactions reconciliation RPC.
-- Additive only. Does NOT edit 20260907000100_paypal_subscriptions_rpc.sql.
-- NOT deployed by this Gate (no db push).

-- ---------------------------------------------------------------------------
-- 1) Additive columns for reconciliation audit (no PII)
-- ---------------------------------------------------------------------------

ALTER TABLE public.paypal_subscription_transactions
    ADD COLUMN IF NOT EXISTS audit_source TEXT
        CHECK (
            audit_source IS NULL
            OR audit_source IN (
                'paypal_webhook',
                'paypal_api_reconciliation'
            )
        ),
    ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

ALTER TABLE public.payment_webhook_events
    ADD COLUMN IF NOT EXISTS merchant_validation_source TEXT
        CHECK (
            merchant_validation_source IS NULL
            OR merchant_validation_source IN (
                'sale_payee_merchant_id',
                'verified_webhook_plus_authenticated_paypal_get'
            )
        );

-- ---------------------------------------------------------------------------
-- 2) ensure_paypal_webhook_event_received
--    Idempotent insert of verified event BEFORE routing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_paypal_webhook_event_received(
    p_paypal_event_id TEXT,
    p_event_type TEXT,
    p_paypal_subscription_id TEXT DEFAULT NULL,
    p_paypal_sale_id TEXT DEFAULT NULL,
    p_sanitized_payload JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (
    outcome TEXT,
    event_processing_status TEXT,
    error_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing public.payment_webhook_events;
    v_payload JSONB;
BEGIN
    IF p_paypal_event_id IS NULL OR btrim(p_paypal_event_id) = '' THEN
        RAISE EXCEPTION 'INVALID_EVENT_ID';
    END IF;
    IF p_event_type IS NULL OR btrim(p_event_type) = '' THEN
        RAISE EXCEPTION 'INVALID_EVENT_TYPE';
    END IF;

    v_payload := COALESCE(p_sanitized_payload, '{}'::jsonb);
    IF v_payload ? 'payer'
       OR v_payload ? 'subscriber'
       OR v_payload ? 'email'
       OR v_payload ? 'shipping_address' THEN
        RAISE EXCEPTION 'SANITIZED_PAYLOAD_CONTAINS_PII';
    END IF;

    SELECT * INTO v_existing
      FROM public.payment_webhook_events
     WHERE paypal_event_id = btrim(p_paypal_event_id);

    IF FOUND THEN
        outcome := 'already_present';
        event_processing_status := v_existing.processing_status;
        error_code := v_existing.error_code;
        RETURN NEXT;
        RETURN;
    END IF;

    INSERT INTO public.payment_webhook_events (
        paypal_event_id,
        event_type,
        verification_status,
        processing_status,
        paypal_subscription_id,
        paypal_sale_id,
        payload
    ) VALUES (
        btrim(p_paypal_event_id),
        btrim(p_event_type),
        'SUCCESS',
        'received',
        NULLIF(btrim(COALESCE(p_paypal_subscription_id, '')), ''),
        NULLIF(btrim(COALESCE(p_paypal_sale_id, '')), ''),
        v_payload
    );

    outcome := 'received';
    event_processing_status := 'received';
    error_code := NULL;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_paypal_webhook_event_received(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_paypal_webhook_event_received(TEXT, TEXT, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_paypal_webhook_event_received(TEXT, TEXT, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_paypal_webhook_event_received(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) finalize_paypal_webhook_event_failure
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_paypal_webhook_event_failure(
    p_paypal_event_id TEXT,
    p_error_code TEXT,
    p_processing_status TEXT DEFAULT 'failed',
    p_paypal_subscription_id TEXT DEFAULT NULL,
    p_paypal_sale_id TEXT DEFAULT NULL,
    p_sanitized_payload JSONB DEFAULT NULL,
    p_merchant_validation_source TEXT DEFAULT NULL
) RETURNS TABLE (
    outcome TEXT,
    event_processing_status TEXT,
    error_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_payload JSONB;
BEGIN
    IF p_paypal_event_id IS NULL OR btrim(p_paypal_event_id) = '' THEN
        RAISE EXCEPTION 'INVALID_EVENT_ID';
    END IF;

    v_status := COALESCE(NULLIF(btrim(p_processing_status), ''), 'failed');
    IF v_status NOT IN ('failed', 'ignored', 'pending_resolution', 'reconciliation_pending') THEN
        v_status := 'failed';
    END IF;

    v_payload := p_sanitized_payload;
    IF v_payload IS NOT NULL AND (
        v_payload ? 'payer'
        OR v_payload ? 'subscriber'
        OR v_payload ? 'email'
        OR v_payload ? 'shipping_address'
    ) THEN
        RAISE EXCEPTION 'SANITIZED_PAYLOAD_CONTAINS_PII';
    END IF;

    UPDATE public.payment_webhook_events
       SET processing_status = v_status,
           error_code = NULLIF(btrim(COALESCE(p_error_code, '')), ''),
           error_message = NULLIF(btrim(COALESCE(p_error_code, '')), ''),
           paypal_subscription_id = COALESCE(
               NULLIF(btrim(COALESCE(p_paypal_subscription_id, '')), ''),
               paypal_subscription_id
           ),
           paypal_sale_id = COALESCE(
               NULLIF(btrim(COALESCE(p_paypal_sale_id, '')), ''),
               paypal_sale_id
           ),
           payload = COALESCE(v_payload, payload),
           merchant_validation_source = COALESCE(
               p_merchant_validation_source,
               merchant_validation_source
           ),
           processed_at = NOW()
     WHERE paypal_event_id = btrim(p_paypal_event_id)
       -- Auth-07C.7E.1: never regress terminal processed/duplicate/ignored rows.
       AND processing_status IN (
           'received',
           'pending_resolution',
           'reconciliation_pending',
           'failed'
       );

    IF NOT FOUND THEN
        -- If a terminal row already exists, leave it untouched.
        IF EXISTS (
            SELECT 1
              FROM public.payment_webhook_events e
             WHERE e.paypal_event_id = btrim(p_paypal_event_id)
        ) THEN
            SELECT e.processing_status, e.error_code
              INTO event_processing_status, error_code
              FROM public.payment_webhook_events e
             WHERE e.paypal_event_id = btrim(p_paypal_event_id);
            outcome := 'already_terminal';
            RETURN NEXT;
            RETURN;
        END IF;

        INSERT INTO public.payment_webhook_events (
            paypal_event_id,
            event_type,
            verification_status,
            processing_status,
            paypal_subscription_id,
            paypal_sale_id,
            payload,
            error_code,
            error_message,
            merchant_validation_source,
            processed_at
        ) VALUES (
            btrim(p_paypal_event_id),
            'UNKNOWN',
            'SUCCESS',
            v_status,
            NULLIF(btrim(COALESCE(p_paypal_subscription_id, '')), ''),
            NULLIF(btrim(COALESCE(p_paypal_sale_id, '')), ''),
            COALESCE(v_payload, '{}'::jsonb),
            NULLIF(btrim(COALESCE(p_error_code, '')), ''),
            NULLIF(btrim(COALESCE(p_error_code, '')), ''),
            p_merchant_validation_source,
            NOW()
        );
    END IF;

    outcome := 'rejected';
    event_processing_status := v_status;
    error_code := NULLIF(btrim(COALESCE(p_error_code, '')), '');
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_paypal_webhook_event_failure(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_paypal_webhook_event_failure(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_paypal_webhook_event_failure(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_paypal_webhook_event_failure(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) REPLACE process_paypal_subscription_webhook_event
--    Continue processing when existing row is still 'received'.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_paypal_subscription_webhook_event(
    p_paypal_event_id TEXT,
    p_event_type TEXT,
    p_paypal_subscription_id TEXT,
    p_paypal_sale_id TEXT,
    p_amount NUMERIC,
    p_currency TEXT,
    p_payment_time TIMESTAMPTZ,
    p_next_billing_time TIMESTAMPTZ,
    p_target_status TEXT,
    p_is_full_refund BOOLEAN,
    p_sanitized_payload JSONB,
    p_processing_hint TEXT DEFAULT NULL
) RETURNS TABLE (
    outcome TEXT,
    subscription_id UUID,
    subscription_status TEXT,
    event_processing_status TEXT,
    error_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub public.paypal_subscriptions;
    v_event public.payment_webhook_events;
    v_tx public.paypal_subscription_transactions;
    v_new_status TEXT;
    v_rank_old INTEGER;
    v_rank_new INTEGER;
    v_paid_through TIMESTAMPTZ;
    v_hint TEXT;
    v_payload JSONB;
    v_merchant_source TEXT;
BEGIN
    IF p_paypal_event_id IS NULL OR btrim(p_paypal_event_id) = '' THEN
        RAISE EXCEPTION 'INVALID_EVENT_ID';
    END IF;

    v_hint := COALESCE(p_processing_hint, 'processed');
    v_payload := COALESCE(p_sanitized_payload, '{}'::jsonb);
    IF v_payload ? 'payer'
       OR v_payload ? 'subscriber'
       OR v_payload ? 'email'
       OR v_payload ? 'shipping_address' THEN
        RAISE EXCEPTION 'SANITIZED_PAYLOAD_CONTAINS_PII';
    END IF;

    v_merchant_source := NULLIF(btrim(COALESCE(v_payload->>'merchant_validation_source', '')), '');

    SELECT * INTO v_event
      FROM public.payment_webhook_events
     WHERE paypal_event_id = p_paypal_event_id
     FOR UPDATE;

    IF FOUND AND v_event.processing_status IS DISTINCT FROM 'received' THEN
        outcome := 'duplicate';
        subscription_id := NULL;
        subscription_status := NULL;
        event_processing_status := 'duplicate';
        error_code := NULL;
        RETURN NEXT;
        RETURN;
    END IF;

    IF p_paypal_subscription_id IS NOT NULL AND btrim(p_paypal_subscription_id) <> '' THEN
        SELECT * INTO v_sub
          FROM public.paypal_subscriptions
         WHERE paypal_subscription_id = btrim(p_paypal_subscription_id)
         FOR UPDATE;
    END IF;

    IF v_sub.id IS NULL THEN
        IF FOUND AND v_event.processing_status = 'received' THEN
            UPDATE public.payment_webhook_events
               SET processing_status = 'pending_resolution',
                   paypal_subscription_id = NULLIF(btrim(COALESCE(p_paypal_subscription_id, '')), ''),
                   paypal_sale_id = NULLIF(btrim(COALESCE(p_paypal_sale_id, '')), ''),
                   payload = v_payload,
                   error_code = 'SUBSCRIPTION_NOT_FOUND',
                   merchant_validation_source = COALESCE(v_merchant_source, merchant_validation_source),
                   processed_at = NOW()
             WHERE paypal_event_id = p_paypal_event_id;
        ELSE
            INSERT INTO public.payment_webhook_events (
                paypal_event_id, event_type, verification_status, processing_status,
                paypal_subscription_id, paypal_sale_id, payload, error_code,
                merchant_validation_source
            ) VALUES (
                p_paypal_event_id, p_event_type, 'SUCCESS', 'pending_resolution',
                NULLIF(btrim(COALESCE(p_paypal_subscription_id, '')), ''),
                NULLIF(btrim(COALESCE(p_paypal_sale_id, '')), ''),
                v_payload,
                'SUBSCRIPTION_NOT_FOUND',
                v_merchant_source
            );
        END IF;
        outcome := 'pending_resolution';
        subscription_id := NULL;
        subscription_status := NULL;
        event_processing_status := 'pending_resolution';
        error_code := 'SUBSCRIPTION_NOT_FOUND';
        RETURN NEXT;
        RETURN;
    END IF;

    IF p_event_type = 'PAYMENT.SALE.COMPLETED' THEN
        IF p_paypal_sale_id IS NULL OR btrim(p_paypal_sale_id) = '' THEN
            IF FOUND AND v_event.processing_status = 'received' THEN
                UPDATE public.payment_webhook_events
                   SET processing_status = 'failed',
                       paypal_subscription_id = v_sub.paypal_subscription_id,
                       payload = v_payload,
                       error_code = 'MISSING_SALE_ID',
                       error_message = 'sale id required',
                       merchant_validation_source = COALESCE(v_merchant_source, merchant_validation_source),
                       processed_at = NOW()
                 WHERE paypal_event_id = p_paypal_event_id;
            ELSE
                INSERT INTO public.payment_webhook_events (
                    paypal_event_id, event_type, verification_status, processing_status,
                    paypal_subscription_id, payload, error_code, error_message,
                    merchant_validation_source
                ) VALUES (
                    p_paypal_event_id, p_event_type, 'SUCCESS', 'failed',
                    v_sub.paypal_subscription_id, v_payload,
                    'MISSING_SALE_ID', 'sale id required',
                    v_merchant_source
                );
            END IF;
            outcome := 'rejected';
            subscription_id := v_sub.id;
            subscription_status := v_sub.status;
            event_processing_status := 'failed';
            error_code := 'MISSING_SALE_ID';
            RETURN NEXT;
            RETURN;
        END IF;

        IF p_amount IS NULL OR p_amount <= 0
           OR p_currency IS NULL OR upper(p_currency) <> v_sub.currency
           OR p_amount <> v_sub.recurring_amount THEN
            IF FOUND AND v_event.processing_status = 'received' THEN
                UPDATE public.payment_webhook_events
                   SET processing_status = 'failed',
                       paypal_subscription_id = v_sub.paypal_subscription_id,
                       paypal_sale_id = btrim(p_paypal_sale_id),
                       payload = v_payload,
                       error_code = 'AMOUNT_CURRENCY_MISMATCH',
                       error_message = 'amount/currency mismatch',
                       merchant_validation_source = COALESCE(v_merchant_source, merchant_validation_source),
                       processed_at = NOW()
                 WHERE paypal_event_id = p_paypal_event_id;
            ELSE
                INSERT INTO public.payment_webhook_events (
                    paypal_event_id, event_type, verification_status, processing_status,
                    paypal_subscription_id, paypal_sale_id, payload, error_code, error_message,
                    merchant_validation_source
                ) VALUES (
                    p_paypal_event_id, p_event_type, 'SUCCESS', 'failed',
                    v_sub.paypal_subscription_id, btrim(p_paypal_sale_id), v_payload,
                    'AMOUNT_CURRENCY_MISMATCH', 'amount/currency mismatch',
                    v_merchant_source
                );
            END IF;
            outcome := 'rejected';
            subscription_id := v_sub.id;
            subscription_status := v_sub.status;
            event_processing_status := 'failed';
            error_code := 'AMOUNT_CURRENCY_MISMATCH';
            RETURN NEXT;
            RETURN;
        END IF;

        SELECT * INTO v_tx
          FROM public.paypal_subscription_transactions
         WHERE paypal_sale_id = btrim(p_paypal_sale_id);

        IF FOUND THEN
            IF v_event.id IS NOT NULL AND v_event.processing_status = 'received' THEN
                UPDATE public.payment_webhook_events
                   SET processing_status = 'duplicate',
                       paypal_subscription_id = v_sub.paypal_subscription_id,
                       paypal_sale_id = btrim(p_paypal_sale_id),
                       payload = v_payload,
                       merchant_validation_source = COALESCE(v_merchant_source, merchant_validation_source),
                       processed_at = NOW()
                 WHERE paypal_event_id = p_paypal_event_id;
            ELSE
                INSERT INTO public.payment_webhook_events (
                    paypal_event_id, event_type, verification_status, processing_status,
                    paypal_subscription_id, paypal_sale_id, payload, processed_at,
                    merchant_validation_source
                ) VALUES (
                    p_paypal_event_id, p_event_type, 'SUCCESS', 'duplicate',
                    v_sub.paypal_subscription_id, btrim(p_paypal_sale_id), v_payload, NOW(),
                    v_merchant_source
                );
            END IF;
            outcome := 'duplicate';
            subscription_id := v_sub.id;
            subscription_status := v_sub.status;
            event_processing_status := 'duplicate';
            error_code := NULL;
            RETURN NEXT;
            RETURN;
        END IF;

        INSERT INTO public.paypal_subscription_transactions (
            paypal_event_id, paypal_sale_id, paypal_subscription_id, subscription_id,
            amount, currency, status, payment_time, sanitized_payload,
            audit_source
        ) VALUES (
            p_paypal_event_id, btrim(p_paypal_sale_id), v_sub.paypal_subscription_id, v_sub.id,
            p_amount, upper(p_currency), 'completed',
            COALESCE(p_payment_time, NOW()), v_payload,
            'paypal_webhook'
        );

        IF p_next_billing_time IS NOT NULL THEN
            v_paid_through := p_next_billing_time;
            UPDATE public.paypal_subscriptions
               SET last_payment_time = COALESCE(p_payment_time, NOW()),
                   next_billing_time = p_next_billing_time,
                   paid_through = CASE
                       WHEN paid_through IS NULL OR p_next_billing_time >= paid_through
                           THEN p_next_billing_time
                       ELSE paid_through
                   END,
                   reconciliation_status = 'none',
                   status = CASE
                       WHEN status IN ('APPROVAL_PENDING', 'APPROVED') THEN 'ACTIVE'
                       ELSE status
                   END,
                   start_time = COALESCE(start_time, COALESCE(p_payment_time, NOW())),
                   updated_at = NOW()
             WHERE id = v_sub.id
            RETURNING * INTO v_sub;
            v_hint := 'processed';
        ELSE
            UPDATE public.paypal_subscriptions
               SET last_payment_time = COALESCE(p_payment_time, NOW()),
                   reconciliation_status = 'reconciliation_pending',
                   status = CASE
                       WHEN status IN ('APPROVAL_PENDING', 'APPROVED') THEN 'ACTIVE'
                       ELSE status
                   END,
                   start_time = COALESCE(start_time, COALESCE(p_payment_time, NOW())),
                   updated_at = NOW()
             WHERE id = v_sub.id
            RETURNING * INTO v_sub;
            v_hint := 'reconciliation_pending';
        END IF;

        IF v_event.id IS NOT NULL AND v_event.processing_status = 'received' THEN
            UPDATE public.payment_webhook_events
               SET processing_status = v_hint,
                   paypal_subscription_id = v_sub.paypal_subscription_id,
                   paypal_sale_id = btrim(p_paypal_sale_id),
                   payload = v_payload,
                   merchant_validation_source = COALESCE(v_merchant_source, merchant_validation_source),
                   processed_at = NOW(),
                   error_code = NULL
             WHERE paypal_event_id = p_paypal_event_id;
        ELSE
            INSERT INTO public.payment_webhook_events (
                paypal_event_id, event_type, verification_status, processing_status,
                paypal_subscription_id, paypal_sale_id, payload, processed_at,
                merchant_validation_source
            ) VALUES (
                p_paypal_event_id, p_event_type, 'SUCCESS', v_hint,
                v_sub.paypal_subscription_id, btrim(p_paypal_sale_id), v_payload, NOW(),
                v_merchant_source
            );
        END IF;

        outcome := 'processed';
        subscription_id := v_sub.id;
        subscription_status := v_sub.status;
        event_processing_status := v_hint;
        error_code := NULL;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Lifecycle / other: reuse prior behavior via update-or-insert for received rows.
    v_new_status := NULLIF(btrim(COALESCE(p_target_status, '')), '');
    IF v_new_status IS NOT NULL THEN
        v_rank_old := public.paypal_subscription_status_rank(v_sub.status);
        v_rank_new := public.paypal_subscription_status_rank(v_new_status);
        IF v_rank_new < 0 THEN
            IF v_event.id IS NOT NULL AND v_event.processing_status = 'received' THEN
                UPDATE public.payment_webhook_events
                   SET processing_status = 'failed',
                       error_code = 'INVALID_STATUS',
                       payload = v_payload,
                       processed_at = NOW()
                 WHERE paypal_event_id = p_paypal_event_id;
            ELSE
                INSERT INTO public.payment_webhook_events (
                    paypal_event_id, event_type, verification_status, processing_status,
                    paypal_subscription_id, payload, error_code, error_message
                ) VALUES (
                    p_paypal_event_id, p_event_type, 'SUCCESS', 'failed',
                    v_sub.paypal_subscription_id, v_payload,
                    'INVALID_STATUS', 'unknown target status'
                );
            END IF;
            outcome := 'rejected';
            subscription_id := v_sub.id;
            subscription_status := v_sub.status;
            event_processing_status := 'failed';
            error_code := 'INVALID_STATUS';
            RETURN NEXT;
            RETURN;
        END IF;

        IF v_rank_new >= v_rank_old THEN
            UPDATE public.paypal_subscriptions
               SET status = v_new_status,
                   cancelled_at = CASE
                       WHEN v_new_status = 'CANCELLED' THEN COALESCE(cancelled_at, NOW())
                       ELSE cancelled_at
                   END,
                   suspended_at = CASE
                       WHEN v_new_status = 'SUSPENDED' THEN COALESCE(suspended_at, NOW())
                       ELSE suspended_at
                   END,
                   next_billing_time = COALESCE(p_next_billing_time, next_billing_time),
                   updated_at = NOW()
             WHERE id = v_sub.id
            RETURNING * INTO v_sub;

            IF v_new_status = 'CANCELLED' THEN
                UPDATE public.user_subscription_slots
                   SET release_after = v_sub.paid_through,
                       updated_at = NOW()
                 WHERE user_id = v_sub.user_id
                   AND slot_state = 'OCCUPIED';
            END IF;
        END IF;
    ELSIF p_next_billing_time IS NOT NULL THEN
        UPDATE public.paypal_subscriptions
           SET next_billing_time = COALESCE(p_next_billing_time, next_billing_time),
               updated_at = NOW()
         WHERE id = v_sub.id
        RETURNING * INTO v_sub;
    END IF;

    IF v_event.id IS NOT NULL AND v_event.processing_status = 'received' THEN
        UPDATE public.payment_webhook_events
           SET processing_status = 'processed',
               paypal_subscription_id = v_sub.paypal_subscription_id,
               payload = v_payload,
               processed_at = NOW(),
               error_code = NULL
         WHERE paypal_event_id = p_paypal_event_id;
    ELSE
        INSERT INTO public.payment_webhook_events (
            paypal_event_id, event_type, verification_status, processing_status,
            paypal_subscription_id, payload, processed_at
        ) VALUES (
            p_paypal_event_id, p_event_type, 'SUCCESS', 'processed',
            v_sub.paypal_subscription_id, v_payload, NOW()
        );
    END IF;

    outcome := 'processed';
    subscription_id := v_sub.id;
    subscription_status := v_sub.status;
    event_processing_status := 'processed';
    error_code := NULL;
    RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) reconcile_paypal_subscription_sale (service_role only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconcile_paypal_subscription_sale(
    p_user_id TEXT,
    p_paypal_subscription_id TEXT,
    p_paypal_sale_id TEXT,
    p_amount NUMERIC,
    p_currency TEXT,
    p_payment_time TIMESTAMPTZ,
    p_next_billing_time TIMESTAMPTZ,
    p_sanitized_audit JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (
    outcome TEXT,
    subscription_id UUID,
    subscription_status TEXT,
    paid_through TIMESTAMPTZ,
    error_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub public.paypal_subscriptions;
    v_tx public.paypal_subscription_transactions;
    v_event_id TEXT;
    v_audit JSONB;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'INVALID_USER_ID';
    END IF;
    IF p_paypal_subscription_id IS NULL OR btrim(p_paypal_subscription_id) = '' THEN
        RAISE EXCEPTION 'INVALID_PAYPAL_SUBSCRIPTION_ID';
    END IF;
    IF p_paypal_sale_id IS NULL OR btrim(p_paypal_sale_id) = '' THEN
        RAISE EXCEPTION 'INVALID_SALE_ID';
    END IF;

    v_audit := COALESCE(p_sanitized_audit, '{}'::jsonb);
    IF v_audit ? 'payer'
       OR v_audit ? 'subscriber'
       OR v_audit ? 'email'
       OR v_audit ? 'shipping_address' THEN
        RAISE EXCEPTION 'SANITIZED_PAYLOAD_CONTAINS_PII';
    END IF;
    v_audit := v_audit || jsonb_build_object('source', 'paypal_api_reconciliation');

    SELECT * INTO v_sub
      FROM public.paypal_subscriptions
     WHERE paypal_subscription_id = btrim(p_paypal_subscription_id)
     FOR UPDATE;

    IF v_sub.id IS NULL THEN
        outcome := 'rejected';
        subscription_id := NULL;
        subscription_status := NULL;
        paid_through := NULL;
        error_code := 'SUBSCRIPTION_NOT_FOUND';
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_sub.user_id IS DISTINCT FROM btrim(p_user_id) THEN
        outcome := 'rejected';
        subscription_id := v_sub.id;
        subscription_status := v_sub.status;
        paid_through := v_sub.paid_through;
        error_code := 'OWNER_MISMATCH';
        RETURN NEXT;
        RETURN;
    END IF;

    IF p_amount IS NULL OR p_amount <= 0
       OR p_currency IS NULL OR upper(p_currency) <> v_sub.currency
       OR p_amount <> v_sub.recurring_amount THEN
        outcome := 'rejected';
        subscription_id := v_sub.id;
        subscription_status := v_sub.status;
        paid_through := v_sub.paid_through;
        error_code := 'AMOUNT_CURRENCY_MISMATCH';
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT * INTO v_tx
      FROM public.paypal_subscription_transactions
     WHERE paypal_sale_id = btrim(p_paypal_sale_id);

    IF FOUND THEN
        outcome := 'duplicate';
        subscription_id := v_sub.id;
        subscription_status := v_sub.status;
        paid_through := v_sub.paid_through;
        error_code := NULL;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Synthetic event id — NOT a PayPal webhook id; never impersonates signature.
    v_event_id := 'paypal_api_reconciliation:' || btrim(p_paypal_sale_id);

    INSERT INTO public.paypal_subscription_transactions (
        paypal_event_id, paypal_sale_id, paypal_subscription_id, subscription_id,
        amount, currency, status, payment_time, sanitized_payload,
        audit_source, reconciled_at
    ) VALUES (
        v_event_id, btrim(p_paypal_sale_id), v_sub.paypal_subscription_id, v_sub.id,
        p_amount, upper(p_currency), 'completed',
        COALESCE(p_payment_time, NOW()), v_audit,
        'paypal_api_reconciliation', NOW()
    );

    IF p_next_billing_time IS NOT NULL THEN
        UPDATE public.paypal_subscriptions AS s
           SET last_payment_time = COALESCE(p_payment_time, NOW()),
               next_billing_time = COALESCE(p_next_billing_time, s.next_billing_time),
               paid_through = CASE
                   WHEN s.paid_through IS NULL OR p_next_billing_time >= s.paid_through
                       THEN p_next_billing_time
                   ELSE s.paid_through
               END,
               reconciliation_status = 'resolved',
               status = CASE
                   WHEN s.status IN ('APPROVAL_PENDING', 'APPROVED') THEN 'ACTIVE'
                   ELSE s.status
               END,
               start_time = COALESCE(s.start_time, COALESCE(p_payment_time, NOW())),
               updated_at = NOW()
         WHERE s.id = v_sub.id
        RETURNING s.* INTO v_sub;
    ELSE
        UPDATE public.paypal_subscriptions AS s
           SET last_payment_time = COALESCE(p_payment_time, NOW()),
               reconciliation_status = 'reconciliation_pending',
               status = CASE
                   WHEN s.status IN ('APPROVAL_PENDING', 'APPROVED') THEN 'ACTIVE'
                   ELSE s.status
               END,
               start_time = COALESCE(s.start_time, COALESCE(p_payment_time, NOW())),
               updated_at = NOW()
         WHERE s.id = v_sub.id
        RETURNING s.* INTO v_sub;
    END IF;

    outcome := 'processed';
    subscription_id := v_sub.id;
    subscription_status := v_sub.status;
    paid_through := v_sub.paid_through;
    error_code := NULL;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_paypal_subscription_sale(TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_paypal_subscription_sale(TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.reconcile_paypal_subscription_sale(TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_paypal_subscription_sale(TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) TO service_role;
