-- PROD-RELEASE-DAY3C: physical gift entitlement + fulfillment + refund requests.
-- Additive only; does not drop/rename anything. One CREATE OR REPLACE on the
-- already-applied process_paypal_subscription_webhook_event (same signature,
-- same body, ONE added line: grant the physical gift inside the SAME
-- transaction as the first successful PAYMENT.SALE.COMPLETED, so the grant
-- and the paid_through extension can never diverge).
--
-- Business rules this migration encodes (per explicit user confirmation,
-- PROD-RELEASE-DAY3C follow-up — do NOT invent values beyond these):
--   1. Exactly ONE physical gift per user, EVER, granted on the user's FIRST
--      successful subscription payment (monthly or yearly — shared
--      eligibility). Renewals, plan switches, cancel+resubscribe never
--      grant again. Enforced structurally via UNIQUE(user_id) + ON CONFLICT
--      DO NOTHING — not via an application-level "have they been granted"
--      check, so it is safe against webhook resend races.
--   2. Shipping fee is paid by the consumer. Fee AMOUNT and eligible
--      shipping REGIONS are NOT YET specified by the business — this
--      migration intentionally has NO default/placeholder fee or region
--      logic. shipping_fee_amount/currency stay NULL until an operator
--      explicitly quotes them (out of band, direct DB update by staff;
--      no admin UI exists yet — flagged as a launch blocker in the review
--      doc, not silently worked around here).
--   3. Refund is REQUEST + manual review only. No automatic fee deduction,
--      no automatic approval/rejection. subscription_refund_requests is
--      intentionally separate from the existing cancel-auto-renew action.
--
-- Rollback (manual, destructive to new objects only):
--   DROP FUNCTION IF EXISTS public.request_subscription_refund(TEXT, UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.submit_gift_shipping_address(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.grant_physical_gift_if_first_payment(TEXT, UUID, TEXT);
--   DROP TABLE IF EXISTS public.subscription_refund_requests;
--   DROP TABLE IF EXISTS public.physical_gift_entitlements;
--   (then re-apply 20260907000100's process_paypal_subscription_webhook_event body unchanged)

-- ---------------------------------------------------------------------------
-- 1) physical_gift_entitlements
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.physical_gift_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL UNIQUE,
    source_subscription_id UUID REFERENCES public.paypal_subscriptions(id) ON DELETE SET NULL,
    source_paypal_sale_id TEXT,
    status TEXT NOT NULL DEFAULT 'granted'
        CHECK (status IN (
            'granted',
            'address_submitted',
            'fee_quoted',
            'fee_paid',
            'awaiting_shipment',
            'shipped'
        )),
    recipient_name TEXT,
    recipient_phone TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    region TEXT,
    postal_code TEXT,
    country TEXT,
    -- Intentionally nullable with no default: fee is unconfirmed business
    -- data, only ever set by an operator once a real fee table exists.
    shipping_fee_currency TEXT,
    shipping_fee_amount NUMERIC(12, 2),
    shipping_fee_quoted_at TIMESTAMPTZ,
    shipping_fee_paypal_order_id TEXT,
    shipping_fee_paid_at TIMESTAMPTZ,
    shipped_at TIMESTAMPTZ,
    tracking_note TEXT,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'physical_gift_entitlements'
           AND t.tgname = 'trg_physical_gift_entitlements_set_updated_at'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_physical_gift_entitlements_set_updated_at
                 BEFORE UPDATE ON public.physical_gift_entitlements
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;
END $$;

ALTER TABLE public.physical_gift_entitlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.physical_gift_entitlements FROM anon, authenticated;

DROP POLICY IF EXISTS physical_gift_entitlements_owner_select ON public.physical_gift_entitlements;
CREATE POLICY physical_gift_entitlements_owner_select
    ON public.physical_gift_entitlements
    FOR SELECT
    TO authenticated
    USING (user_id = public.request_user_key());

GRANT SELECT ON TABLE public.physical_gift_entitlements TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) subscription_refund_requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.subscription_refund_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    subscription_id UUID REFERENCES public.paypal_subscriptions(id) ON DELETE SET NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_refund_requests_one_pending_per_subscription
    ON public.subscription_refund_requests (subscription_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_subscription_refund_requests_user_requested_at_desc
    ON public.subscription_refund_requests (user_id, requested_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'subscription_refund_requests'
           AND t.tgname = 'trg_subscription_refund_requests_set_updated_at'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_subscription_refund_requests_set_updated_at
                 BEFORE UPDATE ON public.subscription_refund_requests
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;
END $$;

ALTER TABLE public.subscription_refund_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.subscription_refund_requests FROM anon, authenticated;

DROP POLICY IF EXISTS subscription_refund_requests_owner_select ON public.subscription_refund_requests;
CREATE POLICY subscription_refund_requests_owner_select
    ON public.subscription_refund_requests
    FOR SELECT
    TO authenticated
    USING (user_id = public.request_user_key());

GRANT SELECT ON TABLE public.subscription_refund_requests TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) grant_physical_gift_if_first_payment — idempotent via UNIQUE(user_id)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grant_physical_gift_if_first_payment(
    p_user_id TEXT,
    p_subscription_id UUID,
    p_paypal_sale_id TEXT
) RETURNS TABLE (
    granted BOOLEAN,
    entitlement_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'INVALID_USER_ID';
    END IF;

    INSERT INTO public.physical_gift_entitlements (
        user_id, source_subscription_id, source_paypal_sale_id, status, granted_at
    ) VALUES (
        p_user_id, p_subscription_id, NULLIF(btrim(COALESCE(p_paypal_sale_id, '')), ''), 'granted', NOW()
    )
    ON CONFLICT (user_id) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NOT NULL THEN
        granted := TRUE;
        entitlement_id := v_id;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT id INTO v_id
      FROM public.physical_gift_entitlements
     WHERE user_id = p_user_id;

    granted := FALSE;
    entitlement_id := v_id;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_physical_gift_if_first_payment(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_physical_gift_if_first_payment(TEXT, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.grant_physical_gift_if_first_payment(TEXT, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_physical_gift_if_first_payment(TEXT, UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) submit_gift_shipping_address — owner-only, only before a fee is quoted
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_gift_shipping_address(
    p_user_id TEXT,
    p_recipient_name TEXT,
    p_recipient_phone TEXT,
    p_address_line1 TEXT,
    p_address_line2 TEXT,
    p_city TEXT,
    p_region TEXT,
    p_postal_code TEXT,
    p_country TEXT
) RETURNS TABLE (
    entitlement_id UUID,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.physical_gift_entitlements;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'INVALID_USER_ID';
    END IF;
    IF p_recipient_name IS NULL OR btrim(p_recipient_name) = ''
       OR p_recipient_phone IS NULL OR btrim(p_recipient_phone) = ''
       OR p_address_line1 IS NULL OR btrim(p_address_line1) = ''
       OR p_city IS NULL OR btrim(p_city) = ''
       OR p_region IS NULL OR btrim(p_region) = ''
       OR p_postal_code IS NULL OR btrim(p_postal_code) = ''
       OR p_country IS NULL OR btrim(p_country) = '' THEN
        RAISE EXCEPTION 'ADDRESS_FIELDS_REQUIRED';
    END IF;

    SELECT * INTO v_row
      FROM public.physical_gift_entitlements
     WHERE user_id = p_user_id
     FOR UPDATE;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'GIFT_NOT_ELIGIBLE';
    END IF;

    IF v_row.status NOT IN ('granted', 'address_submitted') THEN
        RAISE EXCEPTION 'ADDRESS_LOCKED_AFTER_FEE_QUOTE';
    END IF;

    UPDATE public.physical_gift_entitlements
       SET recipient_name = btrim(p_recipient_name),
           recipient_phone = btrim(p_recipient_phone),
           address_line1 = btrim(p_address_line1),
           address_line2 = NULLIF(btrim(COALESCE(p_address_line2, '')), ''),
           city = btrim(p_city),
           region = btrim(p_region),
           postal_code = btrim(p_postal_code),
           country = btrim(p_country),
           status = 'address_submitted',
           updated_at = NOW()
     WHERE id = v_row.id
    RETURNING * INTO v_row;

    entitlement_id := v_row.id;
    status := v_row.status;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_gift_shipping_address(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_gift_shipping_address(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.submit_gift_shipping_address(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_gift_shipping_address(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 5) request_subscription_refund — request + manual review only, never
--    auto-approves, never deducts a fee. Separate from cancel-auto-renew.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_subscription_refund(
    p_user_id TEXT,
    p_subscription_id UUID,
    p_reason TEXT
) RETURNS TABLE (
    request_id UUID,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub public.paypal_subscriptions;
    v_id UUID;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'INVALID_USER_ID';
    END IF;
    IF p_subscription_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_SUBSCRIPTION_ID';
    END IF;

    SELECT * INTO v_sub
      FROM public.paypal_subscriptions
     WHERE id = p_subscription_id
     FOR UPDATE;

    IF v_sub.id IS NULL OR v_sub.user_id IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.subscription_refund_requests
         WHERE subscription_id = p_subscription_id AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'REFUND_REQUEST_ALREADY_PENDING';
    END IF;

    INSERT INTO public.subscription_refund_requests (
        user_id, subscription_id, reason, status, requested_at
    ) VALUES (
        p_user_id, p_subscription_id, NULLIF(btrim(COALESCE(p_reason, '')), ''), 'pending', NOW()
    )
    RETURNING id INTO v_id;

    request_id := v_id;
    status := 'pending';
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.request_subscription_refund(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_subscription_refund(TEXT, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.request_subscription_refund(TEXT, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.request_subscription_refund(TEXT, UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 6) process_paypal_subscription_webhook_event — CREATE OR REPLACE, same
--    signature/body as 20260907000100, with ONE added line: grant the
--    physical gift in the SAME transaction as the first successful
--    PAYMENT.SALE.COMPLETED (right after that branch's own event-log
--    insert, before returning 'processed').
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
BEGIN
    IF p_paypal_event_id IS NULL OR btrim(p_paypal_event_id) = '' THEN
        RAISE EXCEPTION 'INVALID_EVENT_ID';
    END IF;

    v_hint := COALESCE(p_processing_hint, 'processed');
    v_payload := COALESCE(p_sanitized_payload, '{}'::jsonb);
    -- Refuse oversized / obvious PII keys being stuffed by mistake.
    IF v_payload ? 'payer'
       OR v_payload ? 'subscriber'
       OR v_payload ? 'email'
       OR v_payload ? 'shipping_address' THEN
        RAISE EXCEPTION 'SANITIZED_PAYLOAD_CONTAINS_PII';
    END IF;

    SELECT * INTO v_event
      FROM public.payment_webhook_events
     WHERE paypal_event_id = p_paypal_event_id;

    IF FOUND THEN
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
        INSERT INTO public.payment_webhook_events (
            paypal_event_id, event_type, verification_status, processing_status,
            paypal_subscription_id, paypal_sale_id, payload, error_code
        ) VALUES (
            p_paypal_event_id, p_event_type, 'SUCCESS', 'pending_resolution',
            NULLIF(btrim(COALESCE(p_paypal_subscription_id, '')), ''),
            NULLIF(btrim(COALESCE(p_paypal_sale_id, '')), ''),
            v_payload,
            'SUBSCRIPTION_NOT_FOUND'
        );
        outcome := 'pending_resolution';
        subscription_id := NULL;
        subscription_status := NULL;
        event_processing_status := 'pending_resolution';
        error_code := 'SUBSCRIPTION_NOT_FOUND';
        RETURN NEXT;
        RETURN;
    END IF;

    -- PAYMENT.SALE.COMPLETED — only path that extends paid_through.
    IF p_event_type = 'PAYMENT.SALE.COMPLETED' THEN
        IF p_paypal_sale_id IS NULL OR btrim(p_paypal_sale_id) = '' THEN
            INSERT INTO public.payment_webhook_events (
                paypal_event_id, event_type, verification_status, processing_status,
                paypal_subscription_id, payload, error_code, error_message
            ) VALUES (
                p_paypal_event_id, p_event_type, 'SUCCESS', 'failed',
                v_sub.paypal_subscription_id, v_payload,
                'MISSING_SALE_ID', 'sale id required'
            );
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
            INSERT INTO public.payment_webhook_events (
                paypal_event_id, event_type, verification_status, processing_status,
                paypal_subscription_id, paypal_sale_id, payload, error_code, error_message
            ) VALUES (
                p_paypal_event_id, p_event_type, 'SUCCESS', 'failed',
                v_sub.paypal_subscription_id, btrim(p_paypal_sale_id), v_payload,
                'AMOUNT_CURRENCY_MISMATCH', 'amount/currency mismatch'
            );
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
            INSERT INTO public.payment_webhook_events (
                paypal_event_id, event_type, verification_status, processing_status,
                paypal_subscription_id, paypal_sale_id, payload, processed_at
            ) VALUES (
                p_paypal_event_id, p_event_type, 'SUCCESS', 'duplicate',
                v_sub.paypal_subscription_id, btrim(p_paypal_sale_id), v_payload, NOW()
            );
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
            amount, currency, status, payment_time, sanitized_payload
        ) VALUES (
            p_paypal_event_id, btrim(p_paypal_sale_id), v_sub.paypal_subscription_id, v_sub.id,
            p_amount, upper(p_currency), 'completed',
            COALESCE(p_payment_time, NOW()), v_payload
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

        INSERT INTO public.payment_webhook_events (
            paypal_event_id, event_type, verification_status, processing_status,
            paypal_subscription_id, paypal_sale_id, payload, processed_at
        ) VALUES (
            p_paypal_event_id, p_event_type, 'SUCCESS', v_hint,
            v_sub.paypal_subscription_id, btrim(p_paypal_sale_id), v_payload, NOW()
        );

        -- PROD-RELEASE-DAY3C: first-ever successful payment grants the
        -- one-time physical gift, atomically in this same transaction.
        -- UNIQUE(user_id) + ON CONFLICT DO NOTHING inside the RPC makes
        -- this safe against webhook resend/resubscribe without a
        -- separate idempotency check here.
        PERFORM public.grant_physical_gift_if_first_payment(
            v_sub.user_id, v_sub.id, btrim(p_paypal_sale_id)
        );

        outcome := 'processed';
        subscription_id := v_sub.id;
        subscription_status := v_sub.status;
        event_processing_status := v_hint;
        error_code := NULL;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Payment failed — no paid_through extension.
    IF p_event_type = 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' THEN
        INSERT INTO public.payment_webhook_events (
            paypal_event_id, event_type, verification_status, processing_status,
            paypal_subscription_id, payload, processed_at
        ) VALUES (
            p_paypal_event_id, p_event_type, 'SUCCESS', 'processed',
            v_sub.paypal_subscription_id, v_payload, NOW()
        );
        outcome := 'processed';
        subscription_id := v_sub.id;
        subscription_status := v_sub.status;
        event_processing_status := 'processed';
        error_code := NULL;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Refund / reversal.
    IF p_event_type IN ('PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED') THEN
        IF p_paypal_sale_id IS NOT NULL THEN
            UPDATE public.paypal_subscription_transactions
               SET status = CASE
                       WHEN p_event_type = 'PAYMENT.SALE.REVERSED' THEN 'reversed'
                       WHEN COALESCE(p_is_full_refund, TRUE) THEN 'refunded'
                       ELSE 'partial_refund_review'
                   END,
                   needs_review = TRUE,
                   reason_code = CASE
                       WHEN p_event_type = 'PAYMENT.SALE.REVERSED' THEN 'REVERSED'
                       WHEN COALESCE(p_is_full_refund, TRUE) THEN 'FULL_REFUND'
                       ELSE 'PARTIAL_REFUND'
                   END,
                   updated_at = NOW()
             WHERE paypal_sale_id = btrim(p_paypal_sale_id);
        END IF;

        IF p_event_type = 'PAYMENT.SALE.REVERSED'
           OR COALESCE(p_is_full_refund, TRUE) THEN
            UPDATE public.paypal_subscriptions
               SET access_blocked_at = NOW(),
                   access_block_reason = CASE
                       WHEN p_event_type = 'PAYMENT.SALE.REVERSED' THEN 'REVERSED'
                       ELSE 'FULL_REFUND'
                   END,
                   updated_at = NOW()
             WHERE id = v_sub.id
            RETURNING * INTO v_sub;
        ELSE
            -- Partial refund: needs_review only; do not shorten paid_through.
            UPDATE public.paypal_subscriptions
               SET updated_at = NOW()
             WHERE id = v_sub.id
            RETURNING * INTO v_sub;
        END IF;

        INSERT INTO public.payment_webhook_events (
            paypal_event_id, event_type, verification_status, processing_status,
            paypal_subscription_id, paypal_sale_id, payload, processed_at, error_code
        ) VALUES (
            p_paypal_event_id, p_event_type, 'SUCCESS', 'processed',
            v_sub.paypal_subscription_id,
            NULLIF(btrim(COALESCE(p_paypal_sale_id, '')), ''),
            v_payload, NOW(),
            CASE
                WHEN p_event_type = 'PAYMENT.SALE.REVERSED' THEN 'REVERSED'
                WHEN COALESCE(p_is_full_refund, TRUE) THEN 'FULL_REFUND'
                ELSE 'PARTIAL_REFUND_REVIEW'
            END
        );

        outcome := 'processed';
        subscription_id := v_sub.id;
        subscription_status := v_sub.status;
        event_processing_status := 'processed';
        error_code := CASE
            WHEN p_event_type = 'PAYMENT.SALE.REVERSED' THEN 'REVERSED'
            WHEN COALESCE(p_is_full_refund, TRUE) THEN 'FULL_REFUND'
            ELSE 'PARTIAL_REFUND_REVIEW'
        END;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Subscription lifecycle status updates (no paid_through extend).
    v_new_status := NULLIF(btrim(COALESCE(p_target_status, '')), '');
    IF v_new_status IS NOT NULL THEN
        v_rank_old := public.paypal_subscription_status_rank(v_sub.status);
        v_rank_new := public.paypal_subscription_status_rank(v_new_status);
        IF v_rank_new < 0 THEN
            INSERT INTO public.payment_webhook_events (
                paypal_event_id, event_type, verification_status, processing_status,
                paypal_subscription_id, payload, error_code, error_message
            ) VALUES (
                p_paypal_event_id, p_event_type, 'SUCCESS', 'failed',
                v_sub.paypal_subscription_id, v_payload,
                'INVALID_STATUS', 'unknown target status'
            );
            outcome := 'rejected';
            subscription_id := v_sub.id;
            subscription_status := v_sub.status;
            event_processing_status := 'failed';
            error_code := 'INVALID_STATUS';
            RETURN NEXT;
            RETURN;
        END IF;

        IF v_rank_new < v_rank_old THEN
            INSERT INTO public.payment_webhook_events (
                paypal_event_id, event_type, verification_status, processing_status,
                paypal_subscription_id, payload, processed_at, error_code
            ) VALUES (
                p_paypal_event_id, p_event_type, 'SUCCESS', 'ignored',
                v_sub.paypal_subscription_id, v_payload, NOW(),
                'STATUS_REGRESSION_FORBIDDEN'
            );
            outcome := 'ignored';
            subscription_id := v_sub.id;
            subscription_status := v_sub.status;
            event_processing_status := 'ignored';
            error_code := 'STATUS_REGRESSION_FORBIDDEN';
            RETURN NEXT;
            RETURN;
        END IF;

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

        IF v_new_status IN ('EXPIRED') THEN
            UPDATE public.user_subscription_slots
               SET release_after = COALESCE(v_sub.paid_through, NOW()),
                   updated_at = NOW()
             WHERE user_id = v_sub.user_id
               AND slot_state = 'OCCUPIED';
        END IF;
    END IF;

    INSERT INTO public.payment_webhook_events (
        paypal_event_id, event_type, verification_status, processing_status,
        paypal_subscription_id, payload, processed_at
    ) VALUES (
        p_paypal_event_id, p_event_type, 'SUCCESS', 'processed',
        v_sub.paypal_subscription_id, v_payload, NOW()
    );

    outcome := 'processed';
    subscription_id := v_sub.id;
    subscription_status := v_sub.status;
    event_processing_status := 'processed';
    error_code := NULL;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.process_paypal_subscription_webhook_event(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_paypal_subscription_webhook_event(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, JSONB, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.process_paypal_subscription_webhook_event(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_paypal_subscription_webhook_event(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, JSONB, TEXT) TO service_role;
