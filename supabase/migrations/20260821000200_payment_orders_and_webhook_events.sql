-- Auth-07 / Auth-07A.1: PayPal Orders v2 one-time checkout (NOT PayPal
-- Subscriptions / recurring). payment_orders + payment_webhook_events only.
-- NO user_plan_entitlements / subscription activation.
--
-- Auth-07A.1 hotfix (pending local migration — NOT applied remotely yet):
-- strict COMPLETED validation, merchant compare, 15m create TTL support,
-- one-open-order unique index.
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: additive-only. NOT APPLIED (no db push).
-- ROLLBACK (manual):
--   DROP FUNCTION IF EXISTS public.fail_stale_open_payment_orders(TEXT, TEXT, INTEGER);
--   DROP FUNCTION IF EXISTS public.process_paypal_webhook_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB);
--   DROP FUNCTION IF EXISTS public.transition_payment_order_status(UUID, TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.attach_paypal_order_id(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.create_payment_order(TEXT, TEXT, NUMERIC, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.payment_order_status_rank(TEXT);
--   DROP TABLE IF EXISTS public.payment_webhook_events;
--   DROP TABLE IF EXISTS public.payment_orders;

CREATE TABLE IF NOT EXISTS public.payment_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    plan_code TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created'
        CHECK (status IN (
            'created',
            'approved',
            'capture_pending',
            'paid',
            'denied',
            'failed',
            'refunded',
            'reversed'
        )),
    paypal_order_id TEXT,
    paypal_capture_id TEXT,
    create_request_id TEXT NOT NULL,
    capture_request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ,
    CONSTRAINT uq_payment_orders_paypal_order_id UNIQUE (paypal_order_id),
    CONSTRAINT uq_payment_orders_create_request_id UNIQUE (create_request_id),
    CONSTRAINT ck_payment_orders_amount_non_negative CHECK (amount >= 0),
    CONSTRAINT ck_payment_orders_paid_at_when_paid
        CHECK (
            (status IN ('paid', 'refunded', 'reversed') AND paid_at IS NOT NULL)
            OR (status NOT IN ('paid', 'refunded', 'reversed') AND paid_at IS NULL)
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_paypal_capture_id
    ON public.payment_orders (paypal_capture_id)
    WHERE paypal_capture_id IS NOT NULL;

-- At most one open order per user+plan (blocks parallel double-create).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_one_open_per_user_plan
    ON public.payment_orders (user_id, plan_code)
    WHERE status IN ('created', 'approved', 'capture_pending');

CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created_at_desc
    ON public.payment_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user_plan_status
    ON public.payment_orders (user_id, plan_code, status);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'payment_orders'
           AND t.tgname = 'trg_payment_orders_set_updated_at'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_payment_orders_set_updated_at
                 BEFORE UPDATE ON public.payment_orders
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paypal_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    verification_status TEXT NOT NULL
        CHECK (verification_status IN ('SUCCESS', 'FAILURE', 'skipped')),
    processing_status TEXT NOT NULL DEFAULT 'received'
        CHECK (processing_status IN (
            'received',
            'processed',
            'ignored',
            'failed'
        )),
    paypal_order_id TEXT,
    paypal_capture_id TEXT,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    CONSTRAINT uq_payment_webhook_events_paypal_event_id UNIQUE (paypal_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_order_id
    ON public.payment_webhook_events (paypal_order_id);

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_payment_orders_select_owner ON public.payment_orders;
DROP POLICY IF EXISTS p_payment_orders_deny_write_authenticated ON public.payment_orders;
DROP POLICY IF EXISTS p_payment_orders_deny_all_anon ON public.payment_orders;
DROP POLICY IF EXISTS p_payment_webhook_events_deny_all_authenticated ON public.payment_webhook_events;
DROP POLICY IF EXISTS p_payment_webhook_events_deny_all_anon ON public.payment_webhook_events;

CREATE POLICY p_payment_orders_select_owner
    ON public.payment_orders
    FOR SELECT
    TO authenticated
    USING (user_id = public.request_user_key());

CREATE POLICY p_payment_orders_deny_write_authenticated
    ON public.payment_orders
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

CREATE POLICY p_payment_orders_deny_all_anon
    ON public.payment_orders
    AS RESTRICTIVE
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

CREATE POLICY p_payment_webhook_events_deny_all_authenticated
    ON public.payment_webhook_events
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

CREATE POLICY p_payment_webhook_events_deny_all_anon
    ON public.payment_webhook_events
    AS RESTRICTIVE
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.payment_order_status_rank(p_status TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_status
        WHEN 'created' THEN 10
        WHEN 'approved' THEN 20
        WHEN 'capture_pending' THEN 30
        WHEN 'paid' THEN 40
        WHEN 'denied' THEN 50
        WHEN 'failed' THEN 50
        WHEN 'refunded' THEN 60
        WHEN 'reversed' THEN 60
        ELSE -1
    END;
$$;

CREATE OR REPLACE FUNCTION public.create_payment_order(
    p_user_id TEXT,
    p_plan_code TEXT,
    p_amount NUMERIC,
    p_currency TEXT,
    p_create_request_id TEXT
) RETURNS public.payment_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.payment_orders;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'INVALID_USER';
    END IF;
    IF p_plan_code IS NULL OR btrim(p_plan_code) = '' THEN
        RAISE EXCEPTION 'INVALID_PLAN';
    END IF;
    IF p_amount IS NULL OR p_amount < 0 THEN
        RAISE EXCEPTION 'INVALID_AMOUNT';
    END IF;
    IF p_currency IS NULL OR btrim(p_currency) = '' THEN
        RAISE EXCEPTION 'INVALID_CURRENCY';
    END IF;
    IF p_create_request_id IS NULL OR btrim(p_create_request_id) = '' THEN
        RAISE EXCEPTION 'INVALID_REQUEST_ID';
    END IF;

    SELECT * INTO v_row
      FROM public.payment_orders
     WHERE create_request_id = p_create_request_id;

    IF FOUND THEN
        IF v_row.user_id <> p_user_id THEN
            RAISE EXCEPTION 'REQUEST_ID_OWNER_MISMATCH';
        END IF;
        RETURN v_row;
    END IF;

    INSERT INTO public.payment_orders (
        user_id, plan_code, amount, currency, status, create_request_id
    ) VALUES (
        p_user_id, p_plan_code, p_amount, upper(p_currency), 'created', p_create_request_id
    )
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_paypal_order_id(
    p_order_id UUID,
    p_paypal_order_id TEXT
) RETURNS public.payment_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.payment_orders;
BEGIN
    IF p_paypal_order_id IS NULL OR btrim(p_paypal_order_id) = '' THEN
        RAISE EXCEPTION 'INVALID_PAYPAL_ORDER_ID';
    END IF;

    UPDATE public.payment_orders
       SET paypal_order_id = p_paypal_order_id
     WHERE id = p_order_id
       AND (paypal_order_id IS NULL OR paypal_order_id = p_paypal_order_id)
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND_OR_CONFLICT';
    END IF;

    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_payment_order_status(
    p_order_id UUID,
    p_new_status TEXT,
    p_paypal_capture_id TEXT DEFAULT NULL,
    p_capture_request_id TEXT DEFAULT NULL
) RETURNS public.payment_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.payment_orders;
    v_old_rank INTEGER;
    v_new_rank INTEGER;
BEGIN
    SELECT * INTO v_row
      FROM public.payment_orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND';
    END IF;

    IF v_row.status = p_new_status THEN
        IF p_paypal_capture_id IS NOT NULL
           AND v_row.paypal_capture_id IS NULL THEN
            UPDATE public.payment_orders
               SET paypal_capture_id = p_paypal_capture_id,
                   capture_request_id = COALESCE(p_capture_request_id, capture_request_id)
             WHERE id = p_order_id
            RETURNING * INTO v_row;
        ELSIF p_paypal_capture_id IS NOT NULL
           AND v_row.paypal_capture_id IS NOT NULL
           AND v_row.paypal_capture_id <> p_paypal_capture_id THEN
            RAISE EXCEPTION 'CAPTURE_ID_CONFLICT';
        END IF;
        RETURN v_row;
    END IF;

    v_old_rank := public.payment_order_status_rank(v_row.status);
    v_new_rank := public.payment_order_status_rank(p_new_status);

    IF v_new_rank < 0 THEN
        RAISE EXCEPTION 'INVALID_STATUS';
    END IF;

    IF v_new_rank < v_old_rank THEN
        RAISE EXCEPTION 'STATUS_REGRESSION_FORBIDDEN';
    END IF;

    IF v_row.status IN ('denied', 'failed') AND p_new_status NOT IN ('denied', 'failed') THEN
        RAISE EXCEPTION 'STATUS_REGRESSION_FORBIDDEN';
    END IF;

    IF v_row.status = 'paid' AND p_new_status NOT IN ('refunded', 'reversed') THEN
        RAISE EXCEPTION 'STATUS_REGRESSION_FORBIDDEN';
    END IF;

    IF v_row.status IN ('refunded', 'reversed') THEN
        RAISE EXCEPTION 'STATUS_REGRESSION_FORBIDDEN';
    END IF;

    IF p_paypal_capture_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.payment_orders
             WHERE paypal_capture_id = p_paypal_capture_id
               AND id <> p_order_id
        ) THEN
            RAISE EXCEPTION 'CAPTURE_ID_REUSED';
        END IF;
    END IF;

    UPDATE public.payment_orders
       SET status = p_new_status,
           paypal_capture_id = COALESCE(p_paypal_capture_id, paypal_capture_id),
           capture_request_id = COALESCE(p_capture_request_id, capture_request_id),
           paid_at = CASE
               WHEN p_new_status = 'paid' THEN COALESCE(paid_at, NOW())
               ELSE paid_at
           END
     WHERE id = p_order_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

-- Mark open orders older than p_max_age_minutes as failed (Auth-07A.1 TTL).
CREATE OR REPLACE FUNCTION public.fail_stale_open_payment_orders(
    p_user_id TEXT,
    p_plan_code TEXT,
    p_max_age_minutes INTEGER DEFAULT 15
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INTEGER := 0;
    v_row public.payment_orders;
BEGIN
    IF p_max_age_minutes IS NULL OR p_max_age_minutes < 1 THEN
        RAISE EXCEPTION 'INVALID_MAX_AGE';
    END IF;

    FOR v_row IN
        SELECT *
          FROM public.payment_orders
         WHERE user_id = p_user_id
           AND plan_code = p_plan_code
           AND status IN ('created', 'approved', 'capture_pending')
           AND created_at < (NOW() - make_interval(mins => p_max_age_minutes))
         FOR UPDATE
    LOOP
        PERFORM public.transition_payment_order_status(v_row.id, 'failed', NULL, NULL);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- Atomic webhook apply. Call ONLY after signature verification SUCCESS.
-- Auth-07A.1: COMPLETED requires order/capture/amount/currency/actual+expected merchant.
CREATE OR REPLACE FUNCTION public.process_paypal_webhook_event(
    p_paypal_event_id TEXT,
    p_event_type TEXT,
    p_verification_status TEXT,
    p_processing_status TEXT,
    p_paypal_order_id TEXT,
    p_paypal_capture_id TEXT,
    p_expected_amount NUMERIC,
    p_expected_currency TEXT,
    p_actual_merchant_id TEXT,
    p_expected_merchant_id TEXT,
    p_payload JSONB
) RETURNS TABLE (
    outcome TEXT,
    order_id UUID,
    order_status TEXT,
    event_processing_status TEXT,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing public.payment_webhook_events;
    v_order public.payment_orders;
    v_target_status TEXT := NULL;
    v_reject_reason TEXT := NULL;
BEGIN
    IF p_paypal_event_id IS NULL OR btrim(p_paypal_event_id) = '' THEN
        RAISE EXCEPTION 'INVALID_EVENT_ID';
    END IF;

    IF p_verification_status IS DISTINCT FROM 'SUCCESS' THEN
        RAISE EXCEPTION 'VERIFICATION_NOT_SUCCESS';
    END IF;

    SELECT * INTO v_existing
      FROM public.payment_webhook_events
     WHERE paypal_event_id = p_paypal_event_id;

    IF FOUND THEN
        outcome := 'duplicate';
        order_id := NULL;
        order_status := NULL;
        event_processing_status := v_existing.processing_status;
        error_message := v_existing.error_message;
        RETURN NEXT;
        RETURN;
    END IF;

    IF p_event_type = 'PAYMENT.CAPTURE.COMPLETED' THEN
        v_target_status := 'paid';
    ELSIF p_event_type = 'PAYMENT.CAPTURE.PENDING' THEN
        v_target_status := 'capture_pending';
    ELSIF p_event_type = 'PAYMENT.CAPTURE.DENIED' THEN
        v_target_status := 'denied';
    ELSIF p_event_type = 'PAYMENT.CAPTURE.REFUNDED' THEN
        v_target_status := 'refunded';
    ELSIF p_event_type = 'PAYMENT.CAPTURE.REVERSED' THEN
        v_target_status := 'reversed';
    ELSIF p_event_type = 'CHECKOUT.ORDER.APPROVED' THEN
        v_target_status := 'approved';
    ELSE
        v_target_status := NULL;
    END IF;

    IF v_target_status IS NULL THEN
        INSERT INTO public.payment_webhook_events (
            paypal_event_id, event_type, verification_status, processing_status,
            paypal_order_id, paypal_capture_id, payload, processed_at
        ) VALUES (
            p_paypal_event_id, p_event_type, 'SUCCESS', 'ignored',
            p_paypal_order_id, p_paypal_capture_id, p_payload, NOW()
        );

        outcome := 'ignored';
        order_id := NULL;
        order_status := NULL;
        event_processing_status := 'ignored';
        error_message := NULL;
        RETURN NEXT;
        RETURN;
    END IF;

    -- COMPLETED: all fields mandatory; no IS NOT NULL skip.
    IF v_target_status = 'paid' THEN
        IF p_paypal_order_id IS NULL OR btrim(p_paypal_order_id) = '' THEN
            v_reject_reason := 'MISSING_PAYPAL_ORDER_ID';
        ELSIF p_paypal_capture_id IS NULL OR btrim(p_paypal_capture_id) = '' THEN
            v_reject_reason := 'MISSING_PAYPAL_CAPTURE_ID';
        ELSIF p_expected_amount IS NULL THEN
            v_reject_reason := 'MISSING_AMOUNT';
        ELSIF p_expected_currency IS NULL OR btrim(p_expected_currency) = '' THEN
            v_reject_reason := 'MISSING_CURRENCY';
        ELSIF p_actual_merchant_id IS NULL OR btrim(p_actual_merchant_id) = '' THEN
            v_reject_reason := 'MISSING_ACTUAL_MERCHANT';
        ELSIF p_expected_merchant_id IS NULL OR btrim(p_expected_merchant_id) = '' THEN
            v_reject_reason := 'MISSING_EXPECTED_MERCHANT';
        ELSIF btrim(p_actual_merchant_id) <> btrim(p_expected_merchant_id) THEN
            v_reject_reason := 'MERCHANT_MISMATCH';
        END IF;

        IF v_reject_reason IS NOT NULL THEN
            INSERT INTO public.payment_webhook_events (
                paypal_event_id, event_type, verification_status, processing_status,
                paypal_order_id, paypal_capture_id, payload, processed_at, error_message
            ) VALUES (
                p_paypal_event_id, p_event_type, 'SUCCESS', 'failed',
                p_paypal_order_id, p_paypal_capture_id, p_payload, NOW(), v_reject_reason
            );

            outcome := 'rejected';
            order_id := NULL;
            order_status := NULL;
            event_processing_status := 'failed';
            error_message := v_reject_reason;
            RETURN NEXT;
            RETURN;
        END IF;
    END IF;

    IF p_paypal_order_id IS NULL OR btrim(p_paypal_order_id) = '' THEN
        INSERT INTO public.payment_webhook_events (
            paypal_event_id, event_type, verification_status, processing_status,
            paypal_order_id, paypal_capture_id, payload, processed_at, error_message
        ) VALUES (
            p_paypal_event_id, p_event_type, 'SUCCESS', 'failed',
            p_paypal_order_id, p_paypal_capture_id, p_payload, NOW(), 'MISSING_PAYPAL_ORDER_ID'
        );

        outcome := 'rejected';
        order_id := NULL;
        order_status := NULL;
        event_processing_status := 'failed';
        error_message := 'MISSING_PAYPAL_ORDER_ID';
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT * INTO v_order
      FROM public.payment_orders
     WHERE paypal_order_id = p_paypal_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.payment_webhook_events (
            paypal_event_id, event_type, verification_status, processing_status,
            paypal_order_id, paypal_capture_id, payload, processed_at, error_message
        ) VALUES (
            p_paypal_event_id, p_event_type, 'SUCCESS', 'failed',
            p_paypal_order_id, p_paypal_capture_id, p_payload, NOW(), 'ORDER_NOT_FOUND'
        );

        outcome := 'rejected';
        order_id := NULL;
        order_status := NULL;
        event_processing_status := 'failed';
        error_message := 'ORDER_NOT_FOUND';
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_target_status = 'paid' THEN
        IF v_order.amount <> p_expected_amount THEN
            v_reject_reason := 'AMOUNT_MISMATCH';
        ELSIF upper(v_order.currency) <> upper(btrim(p_expected_currency)) THEN
            v_reject_reason := 'CURRENCY_MISMATCH';
        ELSIF EXISTS (
            SELECT 1 FROM public.payment_orders
             WHERE paypal_capture_id = p_paypal_capture_id
               AND id <> v_order.id
        ) THEN
            v_reject_reason := 'CAPTURE_ID_REUSED';
        END IF;

        IF v_reject_reason IS NOT NULL THEN
            INSERT INTO public.payment_webhook_events (
                paypal_event_id, event_type, verification_status, processing_status,
                paypal_order_id, paypal_capture_id, payload, processed_at, error_message
            ) VALUES (
                p_paypal_event_id, p_event_type, 'SUCCESS', 'failed',
                p_paypal_order_id, p_paypal_capture_id, p_payload, NOW(), v_reject_reason
            );

            outcome := 'rejected';
            order_id := v_order.id;
            order_status := v_order.status;
            event_processing_status := 'failed';
            error_message := v_reject_reason;
            RETURN NEXT;
            RETURN;
        END IF;
    END IF;

    -- Non-COMPLETED capture-ish events: still require amount/currency when provided path marks status
    IF v_target_status IN ('capture_pending', 'denied') THEN
        IF p_expected_amount IS NULL
           OR p_expected_currency IS NULL OR btrim(p_expected_currency) = ''
           OR p_actual_merchant_id IS NULL OR btrim(p_actual_merchant_id) = ''
           OR p_expected_merchant_id IS NULL OR btrim(p_expected_merchant_id) = ''
           OR btrim(p_actual_merchant_id) <> btrim(p_expected_merchant_id)
           OR v_order.amount <> p_expected_amount
           OR upper(v_order.currency) <> upper(btrim(p_expected_currency)) THEN
            INSERT INTO public.payment_webhook_events (
                paypal_event_id, event_type, verification_status, processing_status,
                paypal_order_id, paypal_capture_id, payload, processed_at, error_message
            ) VALUES (
                p_paypal_event_id, p_event_type, 'SUCCESS', 'failed',
                p_paypal_order_id, p_paypal_capture_id, p_payload, NOW(), 'CAPTURE_EVENT_VALIDATION_FAILED'
            );

            outcome := 'rejected';
            order_id := v_order.id;
            order_status := v_order.status;
            event_processing_status := 'failed';
            error_message := 'CAPTURE_EVENT_VALIDATION_FAILED';
            RETURN NEXT;
            RETURN;
        END IF;
    END IF;

    BEGIN
        v_order := public.transition_payment_order_status(
            v_order.id,
            v_target_status,
            CASE WHEN p_paypal_capture_id IS NULL OR btrim(p_paypal_capture_id) = '' THEN NULL ELSE p_paypal_capture_id END,
            NULL
        );
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'CAPTURE_ID_UNIQUE_VIOLATION';
        WHEN OTHERS THEN
            IF SQLERRM LIKE '%STATUS_REGRESSION_FORBIDDEN%' THEN
                NULL; -- record event below without regressing
            ELSIF SQLERRM LIKE '%CAPTURE_ID_REUSED%' OR SQLERRM LIKE '%CAPTURE_ID_CONFLICT%' THEN
                INSERT INTO public.payment_webhook_events (
                    paypal_event_id, event_type, verification_status, processing_status,
                    paypal_order_id, paypal_capture_id, payload, processed_at, error_message
                ) VALUES (
                    p_paypal_event_id, p_event_type, 'SUCCESS', 'failed',
                    p_paypal_order_id, p_paypal_capture_id, p_payload, NOW(), 'CAPTURE_ID_CONFLICT'
                );

                outcome := 'rejected';
                order_id := v_order.id;
                order_status := v_order.status;
                event_processing_status := 'failed';
                error_message := 'CAPTURE_ID_CONFLICT';
                RETURN NEXT;
                RETURN;
            ELSE
                RAISE;
            END IF;
    END;

    INSERT INTO public.payment_webhook_events (
        paypal_event_id, event_type, verification_status, processing_status,
        paypal_order_id, paypal_capture_id, payload, processed_at
    ) VALUES (
        p_paypal_event_id, p_event_type, 'SUCCESS', COALESCE(p_processing_status, 'processed'),
        p_paypal_order_id, p_paypal_capture_id, p_payload, NOW()
    );

    outcome := 'processed';
    order_id := v_order.id;
    order_status := v_order.status;
    event_processing_status := COALESCE(p_processing_status, 'processed');
    error_message := NULL;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_order_status_rank(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payment_order_status_rank(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.payment_order_status_rank(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.payment_order_status_rank(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.create_payment_order(TEXT, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_payment_order(TEXT, TEXT, NUMERIC, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.create_payment_order(TEXT, TEXT, NUMERIC, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_order(TEXT, TEXT, NUMERIC, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.attach_paypal_order_id(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_paypal_order_id(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.attach_paypal_order_id(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.attach_paypal_order_id(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.transition_payment_order_status(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_payment_order_status(UUID, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.transition_payment_order_status(UUID, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_payment_order_status(UUID, TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.fail_stale_open_payment_orders(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_stale_open_payment_orders(TEXT, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.fail_stale_open_payment_orders(TEXT, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fail_stale_open_payment_orders(TEXT, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.process_paypal_webhook_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_paypal_webhook_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.process_paypal_webhook_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_paypal_webhook_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB) TO service_role;
