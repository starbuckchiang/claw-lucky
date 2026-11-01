-- Approval-pending checkout exit.
-- Keep historical rows. Do not delete subscriptions.
-- Monthly new amount stays 1.00. Yearly stays 48.00.
-- Binding a PayPal id must not change status or paid_through.
-- A closed checkout must not be reactivated by a late sale or webhook.

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
        v_amount := 1.00;
    ELSIF v_plan = 'yearly' THEN
        v_amount := 48.00;
    ELSE
        RAISE EXCEPTION 'INVALID_PLAN';
    END IF;

    v_paypal_plan := btrim(COALESCE(p_paypal_plan_id, ''));
    IF v_paypal_plan = '' OR char_length(v_paypal_plan) > 127 THEN
        RAISE EXCEPTION 'INVALID_PAYPAL_PLAN_ID';
    END IF;

    PERFORM public.expire_unstarted_subscription_session(p_user_id);
    PERFORM public.release_subscription_slot_if_due(p_user_id);

    SELECT * INTO v_slot
      FROM public.user_subscription_slots
     WHERE user_id = p_user_id
     FOR UPDATE;

    IF FOUND AND v_slot.slot_state = 'OCCUPIED' THEN
        SELECT * INTO v_sub
          FROM public.paypal_subscriptions
         WHERE id = v_slot.subscription_id;

        -- Same unfinished checkout, with or without a saved PayPal id.
        -- A different plan keeps the slot occupied until abandon or expiry.
        IF v_sub.id IS NOT NULL
           AND v_sub.status = 'APPROVAL_PENDING'
           AND v_sub.checkout_expires_at > NOW()
           AND v_sub.plan_code = v_plan
           AND v_sub.paypal_plan_id = v_paypal_plan
        THEN
            subscription_id := v_sub.id;
            checkout_session_id := v_sub.checkout_session_id;
            plan_code := v_sub.plan_code;
            recurring_amount := v_sub.recurring_amount;
            currency := v_sub.currency;
            paypal_plan_id := v_sub.paypal_plan_id;
            checkout_expires_at := v_sub.checkout_expires_at;
            status := v_sub.status;
            RETURN NEXT;
            RETURN;
        END IF;

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

    SELECT * INTO v_slot
      FROM public.user_subscription_slots
     WHERE user_id = p_user_id;

    IF v_slot.slot_state <> 'OCCUPIED'
       OR v_slot.checkout_session_id IS DISTINCT FROM v_session THEN
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

    -- Same id is idempotent and must not change status or paid_through.
    IF v_sub.paypal_subscription_id IS NOT NULL
       AND v_sub.paypal_subscription_id = v_paypal_id THEN
        RETURN v_sub;
    END IF;

    IF v_sub.paypal_subscription_id IS NOT NULL
       AND v_sub.paypal_subscription_id IS DISTINCT FROM v_paypal_id THEN
        RAISE EXCEPTION 'PAYPAL_SUBSCRIPTION_ALREADY_BOUND';
    END IF;

    IF v_sub.status IS DISTINCT FROM 'APPROVAL_PENDING' THEN
        RAISE EXCEPTION 'CHECKOUT_NOT_PENDING';
    END IF;

    IF v_sub.checkout_expires_at < NOW()
       AND v_sub.paypal_subscription_id IS NULL THEN
        RAISE EXCEPTION 'CHECKOUT_SESSION_EXPIRED';
    END IF;

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

CREATE OR REPLACE FUNCTION public.close_checkout_session(
    p_user_id TEXT,
    p_checkout_session_id TEXT
) RETURNS public.paypal_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub public.paypal_subscriptions;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'INVALID_USER';
    END IF;
    IF p_checkout_session_id IS NULL OR btrim(p_checkout_session_id) = '' THEN
        RAISE EXCEPTION 'INVALID_CHECKOUT_SESSION';
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

    IF v_sub.status IS DISTINCT FROM 'APPROVAL_PENDING' THEN
        RAISE EXCEPTION 'CHECKOUT_NOT_PENDING';
    END IF;

    UPDATE public.paypal_subscriptions
       SET status = 'EXPIRED_SETUP',
           updated_at = NOW()
     WHERE id = v_sub.id
    RETURNING * INTO v_sub;

    UPDATE public.user_subscription_slots
       SET slot_state = 'RELEASED',
           released_at = NOW(),
           release_after = NULL,
           updated_at = NOW()
     WHERE user_id = p_user_id
       AND slot_state = 'OCCUPIED'
       AND (
            subscription_id = v_sub.id
            OR checkout_session_id = v_sub.checkout_session_id
       );

    RETURN v_sub;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_closed_checkout_reactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.status = 'EXPIRED_SETUP' THEN
        NEW.status := OLD.status;
        NEW.paid_through := OLD.paid_through;
    ELSIF OLD.status IN ('ACTIVE', 'SUSPENDED', 'APPROVED')
       AND NEW.status = 'EXPIRED_SETUP' THEN
        NEW.status := OLD.status;
        NEW.paid_through := OLD.paid_through;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_closed_checkout_reactivation ON public.paypal_subscriptions;
CREATE TRIGGER trg_prevent_closed_checkout_reactivation
BEFORE UPDATE ON public.paypal_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_closed_checkout_reactivation();

REVOKE ALL ON FUNCTION public.close_checkout_session(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_checkout_session(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.close_checkout_session(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.close_checkout_session(TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.prevent_closed_checkout_reactivation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_closed_checkout_reactivation() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_closed_checkout_reactivation() FROM authenticated;
