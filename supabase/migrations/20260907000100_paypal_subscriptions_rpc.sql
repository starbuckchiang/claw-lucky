-- Auth-07C.2: PayPal Subscriptions tables + atomic RPCs (additive).
-- Design: review-auth-07C.1 / 07C.1A.
-- NOT Subscriptions catalog create; NOT Edge deploy; NO db push in this Gate.
--
-- Compatible with existing payment_orders / payment_webhook_events
-- (user_id TEXT, paypal_event_id TEXT). Does not mutate legacy rows.
--
-- ROLLBACK (manual, destructive to new objects only):
--   DROP FUNCTION IF EXISTS public.process_paypal_subscription_webhook_event(...);
--   DROP FUNCTION IF EXISTS public.expire_unstarted_subscription_session(TEXT);
--   DROP FUNCTION IF EXISTS public.release_subscription_slot_if_due(TEXT);
--   DROP FUNCTION IF EXISTS public.bind_paypal_subscription(TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.acquire_subscription_slot(TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.paypal_subscription_status_rank(TEXT);
--   DROP TABLE IF EXISTS public.paypal_subscription_transactions;
--   DROP TABLE IF EXISTS public.user_subscription_slots;
--   DROP TABLE IF EXISTS public.paypal_subscriptions;
--   (restore payment_webhook_events processing_status CHECK + drop additive cols)

-- ---------------------------------------------------------------------------
-- 1) paypal_subscriptions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.paypal_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    checkout_session_id TEXT NOT NULL,
    checkout_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
    paypal_subscription_id TEXT,
    paypal_plan_id TEXT NOT NULL,
    plan_code TEXT NOT NULL
        CHECK (plan_code IN ('monthly', 'yearly')),
    status TEXT NOT NULL
        CHECK (status IN (
            'APPROVAL_PENDING',
            'APPROVED',
            'ACTIVE',
            'SUSPENDED',
            'CANCELLED',
            'EXPIRED',
            'EXPIRED_SETUP',
            'FAILED_SETUP'
        )),
    currency TEXT NOT NULL
        CHECK (currency IN ('USD')),
    recurring_amount NUMERIC(12, 2) NOT NULL
        CHECK (recurring_amount > 0),
    start_time TIMESTAMPTZ,
    next_billing_time TIMESTAMPTZ,
    last_payment_time TIMESTAMPTZ,
    paid_through TIMESTAMPTZ,
    access_blocked_at TIMESTAMPTZ,
    access_block_reason TEXT,
    reconciliation_status TEXT NOT NULL DEFAULT 'none'
        CHECK (reconciliation_status IN (
            'none',
            'reconciliation_pending',
            'resolved'
        )),
    cancelled_at TIMESTAMPTZ,
    suspended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_paypal_subscriptions_checkout_session_id UNIQUE (checkout_session_id),
    CONSTRAINT uq_paypal_subscriptions_paypal_subscription_id UNIQUE (paypal_subscription_id),
    CONSTRAINT ck_paypal_subscriptions_amount_plan CHECK (
        (plan_code = 'monthly' AND recurring_amount = 5.00)
        OR (plan_code = 'yearly' AND recurring_amount = 48.00)
    )
);

CREATE INDEX IF NOT EXISTS idx_paypal_subscriptions_user_created_at_desc
    ON public.paypal_subscriptions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_paypal_subscriptions_user_status
    ON public.paypal_subscriptions (user_id, status);

CREATE INDEX IF NOT EXISTS idx_paypal_subscriptions_checkout_expires
    ON public.paypal_subscriptions (checkout_expires_at)
    WHERE status = 'APPROVAL_PENDING' AND paypal_subscription_id IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'paypal_subscriptions'
           AND t.tgname = 'trg_paypal_subscriptions_set_updated_at'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_paypal_subscriptions_set_updated_at
                 BEFORE UPDATE ON public.paypal_subscriptions
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) user_subscription_slots (atomic mutex; no now() in UNIQUE)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_subscription_slots (
    user_id TEXT PRIMARY KEY,
    subscription_id UUID
        REFERENCES public.paypal_subscriptions(id)
        ON DELETE SET NULL,
    checkout_session_id TEXT,
    slot_state TEXT NOT NULL
        CHECK (slot_state IN ('OCCUPIED', 'RELEASED')),
    occupied_at TIMESTAMPTZ,
    release_after TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
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
           AND c.relname = 'user_subscription_slots'
           AND t.tgname = 'trg_user_subscription_slots_set_updated_at'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_user_subscription_slots_set_updated_at
                 BEFORE UPDATE ON public.user_subscription_slots
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) paypal_subscription_transactions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.paypal_subscription_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paypal_event_id TEXT NOT NULL,
    paypal_sale_id TEXT NOT NULL,
    paypal_subscription_id TEXT NOT NULL,
    subscription_id UUID
        REFERENCES public.paypal_subscriptions(id)
        ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL
        CHECK (amount > 0),
    currency TEXT NOT NULL
        CHECK (currency IN ('USD')),
    status TEXT NOT NULL
        CHECK (status IN (
            'completed',
            'refunded',
            'reversed',
            'failed',
            'partial_refund_review'
        )),
    payment_time TIMESTAMPTZ NOT NULL,
    needs_review BOOLEAN NOT NULL DEFAULT FALSE,
    reason_code TEXT,
    -- Sanitized summary only — NEVER full webhook body / payer PII.
    sanitized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_paypal_subscription_transactions_event_id UNIQUE (paypal_event_id),
    CONSTRAINT uq_paypal_subscription_transactions_sale_id UNIQUE (paypal_sale_id)
);

CREATE INDEX IF NOT EXISTS idx_paypal_sub_tx_subscription_id
    ON public.paypal_subscription_transactions (subscription_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'paypal_subscription_transactions'
           AND t.tgname = 'trg_paypal_subscription_transactions_set_updated_at'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_paypal_subscription_transactions_set_updated_at
                 BEFORE UPDATE ON public.paypal_subscription_transactions
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Expand payment_webhook_events (additive + CHECK widen)
-- ---------------------------------------------------------------------------

ALTER TABLE public.payment_webhook_events
    ADD COLUMN IF NOT EXISTS paypal_subscription_id TEXT,
    ADD COLUMN IF NOT EXISTS paypal_sale_id TEXT,
    ADD COLUMN IF NOT EXISTS error_code TEXT,
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE public.payment_webhook_events
    DROP CONSTRAINT IF EXISTS payment_webhook_events_processing_status_check;

ALTER TABLE public.payment_webhook_events
    ADD CONSTRAINT payment_webhook_events_processing_status_check
    CHECK (processing_status IN (
        'received',
        'processed',
        'ignored',
        'failed',
        'pending_resolution',
        'reconciliation_pending',
        'duplicate'
    ));

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_subscription_id
    ON public.payment_webhook_events (paypal_subscription_id)
    WHERE paypal_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_sale_id
    ON public.payment_webhook_events (paypal_sale_id)
    WHERE paypal_sale_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.paypal_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscription_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypal_subscription_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_paypal_subscriptions_select_owner ON public.paypal_subscriptions;
DROP POLICY IF EXISTS p_paypal_subscriptions_deny_write_authenticated ON public.paypal_subscriptions;
DROP POLICY IF EXISTS p_paypal_subscriptions_deny_insert_authenticated ON public.paypal_subscriptions;
DROP POLICY IF EXISTS p_paypal_subscriptions_deny_update_authenticated ON public.paypal_subscriptions;
DROP POLICY IF EXISTS p_paypal_subscriptions_deny_delete_authenticated ON public.paypal_subscriptions;
DROP POLICY IF EXISTS p_paypal_subscriptions_deny_all_anon ON public.paypal_subscriptions;

CREATE POLICY p_paypal_subscriptions_select_owner
    ON public.paypal_subscriptions
    FOR SELECT
    TO authenticated
    USING (user_id = public.request_user_key());

-- RESTRICTIVE write denies must NOT use FOR ALL: that would AND-block owner SELECT.
CREATE POLICY p_paypal_subscriptions_deny_insert_authenticated
    ON public.paypal_subscriptions
    AS RESTRICTIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

CREATE POLICY p_paypal_subscriptions_deny_update_authenticated
    ON public.paypal_subscriptions
    AS RESTRICTIVE
    FOR UPDATE
    TO authenticated
    USING (false)
    WITH CHECK (false);

CREATE POLICY p_paypal_subscriptions_deny_delete_authenticated
    ON public.paypal_subscriptions
    AS RESTRICTIVE
    FOR DELETE
    TO authenticated
    USING (false);

CREATE POLICY p_paypal_subscriptions_deny_all_anon
    ON public.paypal_subscriptions
    AS RESTRICTIVE
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

DROP POLICY IF EXISTS p_user_subscription_slots_select_owner ON public.user_subscription_slots;
DROP POLICY IF EXISTS p_user_subscription_slots_deny_write_authenticated ON public.user_subscription_slots;
DROP POLICY IF EXISTS p_user_subscription_slots_deny_insert_authenticated ON public.user_subscription_slots;
DROP POLICY IF EXISTS p_user_subscription_slots_deny_update_authenticated ON public.user_subscription_slots;
DROP POLICY IF EXISTS p_user_subscription_slots_deny_delete_authenticated ON public.user_subscription_slots;
DROP POLICY IF EXISTS p_user_subscription_slots_deny_all_anon ON public.user_subscription_slots;

CREATE POLICY p_user_subscription_slots_select_owner
    ON public.user_subscription_slots
    FOR SELECT
    TO authenticated
    USING (user_id = public.request_user_key());

CREATE POLICY p_user_subscription_slots_deny_insert_authenticated
    ON public.user_subscription_slots
    AS RESTRICTIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

CREATE POLICY p_user_subscription_slots_deny_update_authenticated
    ON public.user_subscription_slots
    AS RESTRICTIVE
    FOR UPDATE
    TO authenticated
    USING (false)
    WITH CHECK (false);

CREATE POLICY p_user_subscription_slots_deny_delete_authenticated
    ON public.user_subscription_slots
    AS RESTRICTIVE
    FOR DELETE
    TO authenticated
    USING (false);

CREATE POLICY p_user_subscription_slots_deny_all_anon
    ON public.user_subscription_slots
    AS RESTRICTIVE
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

DROP POLICY IF EXISTS p_paypal_subscription_transactions_select_owner ON public.paypal_subscription_transactions;
DROP POLICY IF EXISTS p_paypal_subscription_transactions_deny_write_authenticated ON public.paypal_subscription_transactions;
DROP POLICY IF EXISTS p_paypal_subscription_transactions_deny_insert_authenticated ON public.paypal_subscription_transactions;
DROP POLICY IF EXISTS p_paypal_subscription_transactions_deny_update_authenticated ON public.paypal_subscription_transactions;
DROP POLICY IF EXISTS p_paypal_subscription_transactions_deny_delete_authenticated ON public.paypal_subscription_transactions;
DROP POLICY IF EXISTS p_paypal_subscription_transactions_deny_all_anon ON public.paypal_subscription_transactions;

-- Owner may read own transaction summaries via join to subscription.
CREATE POLICY p_paypal_subscription_transactions_select_owner
    ON public.paypal_subscription_transactions
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.paypal_subscriptions s
             WHERE s.id = paypal_subscription_transactions.subscription_id
               AND s.user_id = public.request_user_key()
        )
    );

CREATE POLICY p_paypal_subscription_transactions_deny_insert_authenticated
    ON public.paypal_subscription_transactions
    AS RESTRICTIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

CREATE POLICY p_paypal_subscription_transactions_deny_update_authenticated
    ON public.paypal_subscription_transactions
    AS RESTRICTIVE
    FOR UPDATE
    TO authenticated
    USING (false)
    WITH CHECK (false);

CREATE POLICY p_paypal_subscription_transactions_deny_delete_authenticated
    ON public.paypal_subscription_transactions
    AS RESTRICTIVE
    FOR DELETE
    TO authenticated
    USING (false);

CREATE POLICY p_paypal_subscription_transactions_deny_all_anon
    ON public.paypal_subscription_transactions
    AS RESTRICTIVE
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

GRANT SELECT ON public.paypal_subscriptions TO authenticated;
GRANT SELECT ON public.user_subscription_slots TO authenticated;
GRANT SELECT ON public.paypal_subscription_transactions TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Status rank
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.paypal_subscription_status_rank(p_status TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_status
        WHEN 'APPROVAL_PENDING' THEN 10
        WHEN 'APPROVED' THEN 20
        WHEN 'ACTIVE' THEN 30
        WHEN 'SUSPENDED' THEN 40
        WHEN 'CANCELLED' THEN 50
        WHEN 'EXPIRED' THEN 60
        WHEN 'EXPIRED_SETUP' THEN 60
        WHEN 'FAILED_SETUP' THEN 60
        ELSE -1
    END;
$$;

-- ---------------------------------------------------------------------------
-- 7) release_subscription_slot_if_due
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_subscription_slot_if_due(
    p_user_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_slot public.user_subscription_slots;
    v_sub public.paypal_subscriptions;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'INVALID_USER';
    END IF;

    SELECT * INTO v_slot
      FROM public.user_subscription_slots
     WHERE user_id = p_user_id
     FOR UPDATE;

    IF NOT FOUND OR v_slot.slot_state <> 'OCCUPIED' THEN
        RETURN FALSE;
    END IF;

    IF v_slot.subscription_id IS NOT NULL THEN
        SELECT * INTO v_sub
          FROM public.paypal_subscriptions
         WHERE id = v_slot.subscription_id;
    END IF;

    -- ACTIVE / SUSPENDED must never auto-release.
    IF v_sub.id IS NOT NULL AND v_sub.status IN ('ACTIVE', 'SUSPENDED', 'APPROVED', 'APPROVAL_PENDING') THEN
        RETURN FALSE;
    END IF;

    -- CANCELLED / EXPIRED only when release_after <= now().
    IF v_slot.release_after IS NULL OR v_slot.release_after > NOW() THEN
        RETURN FALSE;
    END IF;

    IF v_sub.id IS NOT NULL AND v_sub.status NOT IN ('CANCELLED', 'EXPIRED', 'EXPIRED_SETUP') THEN
        RETURN FALSE;
    END IF;

    UPDATE public.user_subscription_slots
       SET slot_state = 'RELEASED',
           released_at = NOW(),
           updated_at = NOW()
     WHERE user_id = p_user_id
       AND slot_state = 'OCCUPIED';

    RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) expire_unstarted_subscription_session
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.expire_unstarted_subscription_session(
    p_user_id TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INTEGER := 0;
    r RECORD;
BEGIN
    FOR r IN
        SELECT s.*
          FROM public.paypal_subscriptions s
         WHERE s.status = 'APPROVAL_PENDING'
           AND s.paypal_subscription_id IS NULL
           AND s.checkout_expires_at <= NOW()
           AND (p_user_id IS NULL OR s.user_id = p_user_id)
         FOR UPDATE OF s
    LOOP
        UPDATE public.paypal_subscriptions
           SET status = 'EXPIRED_SETUP',
               updated_at = NOW()
         WHERE id = r.id;

        UPDATE public.user_subscription_slots
           SET slot_state = 'RELEASED',
               released_at = NOW(),
               release_after = NULL,
               updated_at = NOW()
         WHERE user_id = r.user_id
           AND slot_state = 'OCCUPIED'
           AND (
                subscription_id = r.id
                OR checkout_session_id = r.checkout_session_id
           );

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9) acquire_subscription_slot
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.acquire_subscription_slot(
    p_user_id TEXT,
    p_plan_code TEXT,
    p_paypal_plan_id TEXT
) RETURNS TABLE (
    subscription_id UUID,
    checkout_session_id TEXT,
    plan_code TEXT,
    recurring_amount NUMERIC,
    currency TEXT,
    paypal_plan_id TEXT,
    checkout_expires_at TIMESTAMPTZ,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_plan TEXT;
    v_amount NUMERIC(12, 2);
    v_currency TEXT := 'USD';
    v_paypal_plan TEXT;
    v_session TEXT;
    v_expires TIMESTAMPTZ;
    v_sub public.paypal_subscriptions;
    v_slot public.user_subscription_slots;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'INVALID_USER';
    END IF;

    v_plan := lower(btrim(COALESCE(p_plan_code, '')));
    IF v_plan = 'monthly' THEN
        v_amount := 5.00;
    ELSIF v_plan = 'yearly' THEN
        v_amount := 48.00;
    ELSE
        RAISE EXCEPTION 'INVALID_PLAN';
    END IF;

    -- Plan ID comes from trusted Edge whitelist (service_role only), not client amount.
    v_paypal_plan := btrim(COALESCE(p_paypal_plan_id, ''));
    IF v_paypal_plan = '' OR char_length(v_paypal_plan) > 127 THEN
        RAISE EXCEPTION 'INVALID_PAYPAL_PLAN_ID';
    END IF;

    -- Free abandoned pending sessions first (unbound + expired only).
    PERFORM public.expire_unstarted_subscription_session(p_user_id);
    PERFORM public.release_subscription_slot_if_due(p_user_id);

    SELECT * INTO v_slot
      FROM public.user_subscription_slots
     WHERE user_id = p_user_id
     FOR UPDATE;

    IF FOUND AND v_slot.slot_state = 'OCCUPIED' THEN
        RAISE EXCEPTION 'SUBSCRIPTION_SLOT_OCCUPIED';
    END IF;

    v_session := gen_random_uuid()::text;
    v_expires := NOW() + INTERVAL '30 minutes';

    INSERT INTO public.paypal_subscriptions (
        user_id,
        checkout_session_id,
        checkout_expires_at,
        paypal_plan_id,
        plan_code,
        status,
        currency,
        recurring_amount
    ) VALUES (
        p_user_id,
        v_session,
        v_expires,
        v_paypal_plan,
        v_plan,
        'APPROVAL_PENDING',
        v_currency,
        v_amount
    )
    RETURNING * INTO v_sub;

    INSERT INTO public.user_subscription_slots AS s (
        user_id,
        subscription_id,
        checkout_session_id,
        slot_state,
        occupied_at,
        release_after,
        released_at
    ) VALUES (
        p_user_id,
        v_sub.id,
        v_session,
        'OCCUPIED',
        NOW(),
        NULL,
        NULL
    )
    ON CONFLICT (user_id) DO UPDATE
        SET subscription_id = EXCLUDED.subscription_id,
            checkout_session_id = EXCLUDED.checkout_session_id,
            slot_state = 'OCCUPIED',
            occupied_at = NOW(),
            release_after = NULL,
            released_at = NULL,
            updated_at = NOW()
      WHERE s.slot_state = 'RELEASED';

    -- Re-check: concurrent occupy must fail.
    SELECT * INTO v_slot
      FROM public.user_subscription_slots
     WHERE user_id = p_user_id;

    IF v_slot.slot_state <> 'OCCUPIED'
       OR v_slot.checkout_session_id IS DISTINCT FROM v_session THEN
        -- Roll back the pending row we just inserted.
        UPDATE public.paypal_subscriptions
           SET status = 'FAILED_SETUP',
               updated_at = NOW()
         WHERE id = v_sub.id;
        RAISE EXCEPTION 'SUBSCRIPTION_SLOT_OCCUPIED';
    END IF;

    subscription_id := v_sub.id;
    checkout_session_id := v_sub.checkout_session_id;
    plan_code := v_sub.plan_code;
    recurring_amount := v_sub.recurring_amount;
    currency := v_sub.currency;
    paypal_plan_id := v_sub.paypal_plan_id;
    checkout_expires_at := v_sub.checkout_expires_at;
    status := v_sub.status;
    RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10) bind_paypal_subscription
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bind_paypal_subscription(
    p_user_id TEXT,
    p_checkout_session_id TEXT,
    p_paypal_subscription_id TEXT
) RETURNS public.paypal_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub public.paypal_subscriptions;
    v_existing public.paypal_subscriptions;
    v_paypal_id TEXT;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'INVALID_USER';
    END IF;
    IF p_checkout_session_id IS NULL OR btrim(p_checkout_session_id) = '' THEN
        RAISE EXCEPTION 'INVALID_CHECKOUT_SESSION';
    END IF;

    v_paypal_id := btrim(COALESCE(p_paypal_subscription_id, ''));
    IF v_paypal_id = '' THEN
        RAISE EXCEPTION 'INVALID_PAYPAL_SUBSCRIPTION_ID';
    END IF;

    SELECT * INTO v_sub
      FROM public.paypal_subscriptions
     WHERE checkout_session_id = btrim(p_checkout_session_id)
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CHECKOUT_SESSION_NOT_FOUND';
    END IF;

    IF v_sub.user_id IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'CHECKOUT_SESSION_OWNER_MISMATCH';
    END IF;

    IF v_sub.checkout_expires_at < NOW()
       AND v_sub.paypal_subscription_id IS NULL THEN
        RAISE EXCEPTION 'CHECKOUT_SESSION_EXPIRED';
    END IF;

    -- Idempotent same binding.
    IF v_sub.paypal_subscription_id IS NOT NULL
       AND v_sub.paypal_subscription_id = v_paypal_id THEN
        RETURN v_sub;
    END IF;

    IF v_sub.paypal_subscription_id IS NOT NULL
       AND v_sub.paypal_subscription_id IS DISTINCT FROM v_paypal_id THEN
        RAISE EXCEPTION 'PAYPAL_SUBSCRIPTION_ALREADY_BOUND';
    END IF;

    -- Unique across users.
    SELECT * INTO v_existing
      FROM public.paypal_subscriptions
     WHERE paypal_subscription_id = v_paypal_id
       AND id IS DISTINCT FROM v_sub.id;

    IF FOUND THEN
        RAISE EXCEPTION 'PAYPAL_SUBSCRIPTION_ID_IN_USE';
    END IF;

    UPDATE public.paypal_subscriptions
       SET paypal_subscription_id = v_paypal_id,
           updated_at = NOW()
     WHERE id = v_sub.id
    RETURNING * INTO v_sub;

    UPDATE public.user_subscription_slots
       SET subscription_id = v_sub.id,
           checkout_session_id = v_sub.checkout_session_id,
           updated_at = NOW()
     WHERE user_id = p_user_id;

    RETURN v_sub;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11) process_paypal_subscription_webhook_event (skeleton; Edge verifies first)
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

-- ---------------------------------------------------------------------------
-- 12) Grants — service_role only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.paypal_subscription_status_rank(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paypal_subscription_status_rank(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.paypal_subscription_status_rank(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_subscription_status_rank(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.release_subscription_slot_if_due(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_subscription_slot_if_due(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.release_subscription_slot_if_due(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_subscription_slot_if_due(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.expire_unstarted_subscription_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_unstarted_subscription_session(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.expire_unstarted_subscription_session(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unstarted_subscription_session(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.acquire_subscription_slot(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_subscription_slot(TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.acquire_subscription_slot(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_subscription_slot(TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.bind_paypal_subscription(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bind_paypal_subscription(TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.bind_paypal_subscription(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bind_paypal_subscription(TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.process_paypal_subscription_webhook_event(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_paypal_subscription_webhook_event(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, JSONB, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.process_paypal_subscription_webhook_event(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_paypal_subscription_webhook_event(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, JSONB, TEXT) TO service_role;
