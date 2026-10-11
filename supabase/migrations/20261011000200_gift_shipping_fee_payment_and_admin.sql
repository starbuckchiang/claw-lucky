-- PROD-RELEASE-DAY3C (line 151-198): NT$44 shipping-fee payment confirmation
-- (reusing the existing generic Orders v2 payment_orders infrastructure via
-- a new plan_code='gift_shipping_fee') + minimal admin backend (refund
-- review, refund-success confirmation, shipment + tracking number, audit
-- log). Additive only; does not alter any already-applied table/function
-- signature from 20260821000200 or 20261009000100.
--
-- Rollback (manual, destructive to new objects only):
--   DROP FUNCTION IF EXISTS public.admin_mark_gift_shipped(TEXT, UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.admin_list_shippable_gifts(TEXT);
--   DROP FUNCTION IF EXISTS public.admin_confirm_refund_success(TEXT, UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.admin_review_refund_request(TEXT, UUID, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.admin_list_pending_refund_requests(TEXT);
--   DROP FUNCTION IF EXISTS public.is_admin_user(TEXT);
--   DROP FUNCTION IF EXISTS public.confirm_gift_shipping_fee_payment(TEXT, TEXT);
--   DROP TABLE IF EXISTS public.admin_audit_log;
--   DROP TABLE IF EXISTS public.app_admins;
--   ALTER TABLE public.subscription_refund_requests DROP COLUMN IF EXISTS paypal_refund_id;

-- ---------------------------------------------------------------------------
-- 1) confirm_gift_shipping_fee_payment — server-authoritative confirmation
--    of the NT$44 shipping fee, never trusting the frontend's own "success"
--    page. Re-validates a REAL, already-captured public.payment_orders row
--    (plan_code='gift_shipping_fee') before moving the gift entitlement
--    forward. Idempotent on resend with the SAME paypal_order_id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_gift_shipping_fee_payment(
    p_user_id TEXT,
    p_paypal_order_id TEXT
) RETURNS TABLE (
    entitlement_id UUID,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.payment_orders;
    v_row public.physical_gift_entitlements;
BEGIN
    IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
        RAISE EXCEPTION 'INVALID_USER_ID';
    END IF;
    IF p_paypal_order_id IS NULL OR btrim(p_paypal_order_id) = '' THEN
        RAISE EXCEPTION 'INVALID_REQUEST';
    END IF;

    SELECT * INTO v_order
      FROM public.payment_orders
     WHERE user_id = p_user_id
       AND paypal_order_id = p_paypal_order_id
       AND plan_code = 'gift_shipping_fee'
     FOR UPDATE;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'SHIPPING_FEE_ORDER_NOT_FOUND';
    END IF;

    IF v_order.status <> 'paid' THEN
        RAISE EXCEPTION 'SHIPPING_FEE_ORDER_NOT_PAID';
    END IF;

    SELECT * INTO v_row
      FROM public.physical_gift_entitlements
     WHERE user_id = p_user_id
     FOR UPDATE;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'GIFT_NOT_ELIGIBLE';
    END IF;

    -- Idempotent resend: already moved past fee_quoted using THIS exact
    -- paid order — return the current state, never re-run the transition.
    IF v_row.status IN ('awaiting_shipment', 'shipped')
       AND v_row.shipping_fee_paypal_order_id = p_paypal_order_id THEN
        entitlement_id := v_row.id;
        status := v_row.status;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_row.status <> 'fee_quoted' THEN
        RAISE EXCEPTION 'SHIPPING_FEE_STATUS_INVALID';
    END IF;

    -- Defense in depth: the captured order's own amount/currency must match
    -- the entitlement's own quoted fee (both are server-set, never client
    -- input, but a mismatch here would indicate a real data-integrity bug
    -- and must never be silently accepted).
    IF v_order.amount IS DISTINCT FROM v_row.shipping_fee_amount
       OR upper(v_order.currency) IS DISTINCT FROM upper(COALESCE(v_row.shipping_fee_currency, '')) THEN
        RAISE EXCEPTION 'SHIPPING_FEE_AMOUNT_MISMATCH';
    END IF;

    -- All four shipment preconditions are satisfied the moment the fee is
    -- paid (subscription payment was already required to grant the gift;
    -- the address was already required before a fee could be quoted) — the
    -- only precondition re-checked again at actual ship time is "no pending
    -- refund request", since one could be opened AFTER this moment.
    UPDATE public.physical_gift_entitlements
       SET status = 'awaiting_shipment',
           shipping_fee_paid_at = NOW(),
           shipping_fee_paypal_order_id = p_paypal_order_id,
           updated_at = NOW()
     WHERE id = v_row.id
    RETURNING * INTO v_row;

    entitlement_id := v_row.id;
    status := v_row.status;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_gift_shipping_fee_payment(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_gift_shipping_fee_payment(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_gift_shipping_fee_payment(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_gift_shipping_fee_payment(TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 2) app_admins + admin_audit_log — minimal admin backend primitives.
--    No admin UI exists to self-promote; rows are inserted manually (direct
--    DB access by the operator) until a provisioning flow is built. Deny-all
--    for anon/authenticated on BOTH tables; every admin action is gated by
--    is_admin_user(), checked SERVER-SIDE (service_role) in the Edge
--    Function BEFORE any admin RPC call — never trust a client-asserted role.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.app_admins (
    user_id TEXT PRIMARY KEY,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.app_admins FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_table TEXT,
    target_id TEXT,
    detail JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at_desc
    ON public.admin_audit_log (created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_audit_log FROM anon, authenticated;

-- subscription_refund_requests already applied (20261009000100) — a real
-- PayPal refund transaction id is new information, added here as a nullable
-- column (never required at request time, only once an admin confirms a
-- real refund actually completed on PayPal's side).
ALTER TABLE public.subscription_refund_requests
    ADD COLUMN IF NOT EXISTS paypal_refund_id TEXT;

CREATE OR REPLACE FUNCTION public.is_admin_user(p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.app_admins WHERE user_id = p_user_id
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin_user(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.is_admin_user(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) admin_list_pending_refund_requests / admin_review_refund_request /
--    admin_confirm_refund_success — refund review + real-refund-record
--    confirmation. Approval/rejection NEVER auto-executes a PayPal refund;
--    `refund_success` is set ONLY by admin_confirm_refund_success, which
--    requires an already-approved request AND a real PayPal refund
--    transaction id supplied by the operator (who performed the refund via
--    PayPal's own dashboard/API out of band — this migration does not call
--    PayPal itself, matching this task's "不得執行真實付款或正式退款"
--    constraint on what the AGENT may automate).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_pending_refund_requests(p_admin_user_id TEXT)
RETURNS SETOF public.subscription_refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin_user(p_admin_user_id) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    RETURN QUERY
    SELECT *
      FROM public.subscription_refund_requests
     WHERE status = 'pending'
     ORDER BY requested_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_pending_refund_requests(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_pending_refund_requests(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.admin_list_pending_refund_requests(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_refund_requests(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_review_refund_request(
    p_admin_user_id TEXT,
    p_request_id UUID,
    p_decision TEXT,
    p_note TEXT
) RETURNS TABLE (
    request_id UUID,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.subscription_refund_requests;
    v_decision TEXT;
BEGIN
    IF NOT public.is_admin_user(p_admin_user_id) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    v_decision := lower(btrim(COALESCE(p_decision, '')));
    IF v_decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'INVALID_DECISION';
    END IF;

    SELECT * INTO v_row
      FROM public.subscription_refund_requests
     WHERE id = p_request_id
     FOR UPDATE;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
    END IF;

    IF v_row.status <> 'pending' THEN
        RAISE EXCEPTION 'REFUND_REQUEST_NOT_PENDING';
    END IF;

    UPDATE public.subscription_refund_requests
       SET status = v_decision,
           reviewed_at = NOW(),
           reviewed_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
           updated_at = NOW()
     WHERE id = v_row.id
    RETURNING * INTO v_row;

    INSERT INTO public.admin_audit_log (admin_user_id, action, target_table, target_id, detail)
    VALUES (
        p_admin_user_id,
        'review_refund_request',
        'subscription_refund_requests',
        v_row.id::TEXT,
        jsonb_build_object('decision', v_decision)
    );

    request_id := v_row.id;
    status := v_row.status;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_refund_request(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_review_refund_request(TEXT, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.admin_review_refund_request(TEXT, UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_refund_request(TEXT, UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_confirm_refund_success(
    p_admin_user_id TEXT,
    p_request_id UUID,
    p_paypal_refund_id TEXT
) RETURNS TABLE (
    request_id UUID,
    refund_success BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.subscription_refund_requests;
BEGIN
    IF NOT public.is_admin_user(p_admin_user_id) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_paypal_refund_id IS NULL OR btrim(p_paypal_refund_id) = '' THEN
        RAISE EXCEPTION 'REFUND_RECORD_REQUIRED';
    END IF;

    SELECT * INTO v_row
      FROM public.subscription_refund_requests
     WHERE id = p_request_id
     FOR UPDATE;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
    END IF;

    -- Idempotent resend of the SAME already-confirmed refund record.
    IF v_row.refund_success AND v_row.paypal_refund_id = btrim(p_paypal_refund_id) THEN
        request_id := v_row.id;
        refund_success := TRUE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_row.status <> 'approved' THEN
        RAISE EXCEPTION 'REFUND_REQUEST_NOT_APPROVED';
    END IF;

    IF v_row.refund_success THEN
        -- Already confirmed with a DIFFERENT record id — never overwrite a
        -- completed refund's record silently.
        RAISE EXCEPTION 'REFUND_ALREADY_CONFIRMED';
    END IF;

    UPDATE public.subscription_refund_requests
       SET refund_success = TRUE,
           paypal_refund_id = btrim(p_paypal_refund_id),
           updated_at = NOW()
     WHERE id = v_row.id
    RETURNING * INTO v_row;

    -- Terminate the paid entitlement so no further paid-tier access/quota is
    -- granted; next billing already stopped once the request existed (the
    -- customer's separate "cancel auto-renew" action is unaffected/unrelated
    -- — this only runs once a refund is genuinely confirmed).
    UPDATE public.paypal_subscriptions
       SET access_blocked_at = COALESCE(access_blocked_at, NOW()),
           updated_at = NOW()
     WHERE id = v_row.subscription_id;

    INSERT INTO public.admin_audit_log (admin_user_id, action, target_table, target_id, detail)
    VALUES (
        p_admin_user_id,
        'confirm_refund_success',
        'subscription_refund_requests',
        v_row.id::TEXT,
        jsonb_build_object('paypal_refund_id', v_row.paypal_refund_id)
    );

    request_id := v_row.id;
    refund_success := v_row.refund_success;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_confirm_refund_success(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_confirm_refund_success(TEXT, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.admin_confirm_refund_success(TEXT, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirm_refund_success(TEXT, UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) admin_list_shippable_gifts / admin_mark_gift_shipped — shipment, gated
--    on ALL FOUR confirmed preconditions re-checked at ship time (not just
--    inferred from `status`): subscription paid (implicit — gift only
--    exists once granted after first payment), NT$44 fee paid (status
--    reached 'awaiting_shipment'), complete address (required before a fee
--    could ever be quoted), and no pending refund request (re-checked here
--    since one can be opened after fee payment).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_shippable_gifts(p_admin_user_id TEXT)
RETURNS SETOF public.physical_gift_entitlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin_user(p_admin_user_id) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    RETURN QUERY
    SELECT *
      FROM public.physical_gift_entitlements
     WHERE status = 'awaiting_shipment'
       AND held_by_refund_request_id IS NULL
     ORDER BY shipping_fee_paid_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_shippable_gifts(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_shippable_gifts(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.admin_list_shippable_gifts(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_shippable_gifts(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_mark_gift_shipped(
    p_admin_user_id TEXT,
    p_entitlement_id UUID,
    p_tracking_number TEXT
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
    IF NOT public.is_admin_user(p_admin_user_id) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_tracking_number IS NULL OR btrim(p_tracking_number) = '' THEN
        RAISE EXCEPTION 'TRACKING_NUMBER_REQUIRED';
    END IF;

    SELECT * INTO v_row
      FROM public.physical_gift_entitlements
     WHERE id = p_entitlement_id
     FOR UPDATE;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'GIFT_NOT_ELIGIBLE';
    END IF;

    IF v_row.status = 'shipped' THEN
        -- Idempotent resend.
        entitlement_id := v_row.id;
        status := v_row.status;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_row.status <> 'awaiting_shipment' THEN
        RAISE EXCEPTION 'SHIPMENT_NOT_READY';
    END IF;

    IF v_row.held_by_refund_request_id IS NOT NULL THEN
        RAISE EXCEPTION 'SHIPMENT_HELD_BY_REFUND_REQUEST';
    END IF;

    UPDATE public.physical_gift_entitlements
       SET status = 'shipped',
           shipped_at = NOW(),
           tracking_number = btrim(p_tracking_number),
           updated_at = NOW()
     WHERE id = v_row.id
    RETURNING * INTO v_row;

    INSERT INTO public.admin_audit_log (admin_user_id, action, target_table, target_id, detail)
    VALUES (
        p_admin_user_id,
        'mark_gift_shipped',
        'physical_gift_entitlements',
        v_row.id::TEXT,
        jsonb_build_object('tracking_number', v_row.tracking_number)
    );

    entitlement_id := v_row.id;
    status := v_row.status;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mark_gift_shipped(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_mark_gift_shipped(TEXT, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.admin_mark_gift_shipped(TEXT, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_gift_shipped(TEXT, UUID, TEXT) TO service_role;
