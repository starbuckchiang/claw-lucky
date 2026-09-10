-- Auth-07C.9 rollback-only expiry/slot-release fixture.
-- All rows use user_id '07c9-fx-%' (no real user). Entire batch runs inside
-- BEGIN..ROLLBACK; the final SELECT (before ROLLBACK) is the only output.
BEGIN;

-- Real-data snapshot (pre) for the drift assertion.
CREATE TEMP TABLE real_before ON COMMIT DROP AS
SELECT s.id, s.status, s.paid_through, s.last_payment_time, s.access_blocked_at,
       s.updated_at AS sub_updated_at,
       sl.slot_state, sl.release_after, sl.released_at,
       (SELECT count(*) FROM public.paypal_subscription_transactions) AS tx_count
  FROM public.paypal_subscriptions s
  JOIN public.user_subscription_slots sl ON sl.user_id = s.user_id
 WHERE s.user_id NOT LIKE '07c9-fx-%';

-- ---- fixtures ----
-- S1 CANCELLED, paid_through future
INSERT INTO public.paypal_subscriptions
  (user_id, checkout_session_id, paypal_subscription_id, paypal_plan_id, plan_code, status, currency, recurring_amount, paid_through, cancelled_at)
VALUES
  ('07c9-fx-s1','07c9-sess-s1','07c9-pp-s1','P-07C9TEST','monthly','CANCELLED','USD',5.00, NOW()+interval '10 days', NOW()),
  ('07c9-fx-s2','07c9-sess-s2','07c9-pp-s2','P-07C9TEST','monthly','CANCELLED','USD',5.00, NOW(),                    NOW()),
  ('07c9-fx-s3','07c9-sess-s3','07c9-pp-s3','P-07C9TEST','monthly','CANCELLED','USD',5.00, NOW()-interval '1 day',   NOW()-interval '10 days'),
  ('07c9-fx-s4','07c9-sess-s4','07c9-pp-s4','P-07C9TEST','monthly','CANCELLED','USD',5.00, NULL,                     NOW()),
  ('07c9-fx-s5','07c9-sess-s5','07c9-pp-s5','P-07C9TEST','monthly','ACTIVE',   'USD',5.00, NOW()-interval '1 day',   NULL),
  ('07c9-fx-s6','07c9-sess-s6','07c9-pp-s6','P-07C9TEST','monthly','SUSPENDED','USD',5.00, NOW()-interval '1 day',   NULL),
  ('07c9-fx-s7','07c9-sess-s7','07c9-pp-s7','P-07C9TEST','monthly','EXPIRED',  'USD',5.00, NOW()-interval '1 day',   NULL);

INSERT INTO public.user_subscription_slots
  (user_id, subscription_id, checkout_session_id, slot_state, occupied_at, release_after)
SELECT s.user_id, s.id, s.checkout_session_id, 'OCCUPIED', NOW(),
       CASE s.user_id
         WHEN '07c9-fx-s1' THEN NOW()+interval '10 days'
         WHEN '07c9-fx-s2' THEN NOW()                     -- exact boundary
         WHEN '07c9-fx-s3' THEN NOW()-interval '1 day'
         WHEN '07c9-fx-s4' THEN NULL
         WHEN '07c9-fx-s5' THEN NOW()-interval '1 day'    -- ACTIVE must still be protected
         WHEN '07c9-fx-s6' THEN NOW()-interval '1 day'    -- SUSPENDED must still be protected
         WHEN '07c9-fx-s7' THEN NOW()-interval '1 day'
       END
  FROM public.paypal_subscriptions s
 WHERE s.user_id LIKE '07c9-fx-%';

-- Pre-release copy of S3's subscription row (release must not touch it).
CREATE TEMP TABLE s3_sub_before ON COMMIT DROP AS
SELECT paid_through, last_payment_time, access_blocked_at, updated_at
  FROM public.paypal_subscriptions WHERE user_id='07c9-fx-s3';

-- ---- run scenarios ----
CREATE TEMP TABLE r (scenario TEXT, released BOOLEAN, slot_state TEXT, note TEXT) ON COMMIT DROP;

INSERT INTO r SELECT 'S1_cancelled_future', public.release_subscription_slot_if_due('07c9-fx-s1'),
  (SELECT slot_state FROM public.user_subscription_slots WHERE user_id='07c9-fx-s1'),
  'access_allowed=' || (SELECT (paid_through > NOW())::text FROM public.paypal_subscriptions WHERE user_id='07c9-fx-s1');

INSERT INTO r SELECT 'S2_boundary_now', public.release_subscription_slot_if_due('07c9-fx-s2'),
  (SELECT slot_state FROM public.user_subscription_slots WHERE user_id='07c9-fx-s2'),
  'release_after<=now is due (inclusive boundary)';

INSERT INTO r SELECT 'S3_cancelled_past', public.release_subscription_slot_if_due('07c9-fx-s3'),
  (SELECT slot_state FROM public.user_subscription_slots WHERE user_id='07c9-fx-s3'),
  'access_denied=' || (SELECT (paid_through <= NOW())::text FROM public.paypal_subscriptions WHERE user_id='07c9-fx-s3');

INSERT INTO r SELECT 'S4_release_after_null', public.release_subscription_slot_if_due('07c9-fx-s4'),
  (SELECT slot_state FROM public.user_subscription_slots WHERE user_id='07c9-fx-s4'),
  'null release_after never auto-releases';

INSERT INTO r SELECT 'S5_active_protected', public.release_subscription_slot_if_due('07c9-fx-s5'),
  (SELECT slot_state FROM public.user_subscription_slots WHERE user_id='07c9-fx-s5'),
  'ACTIVE never auto-released even with past release_after';

INSERT INTO r SELECT 'S6_suspended_protected', public.release_subscription_slot_if_due('07c9-fx-s6'),
  (SELECT slot_state FROM public.user_subscription_slots WHERE user_id='07c9-fx-s6'),
  'SUSPENDED stays blocking (07C.1A)';

INSERT INTO r SELECT 'S7_expired_released', public.release_subscription_slot_if_due('07c9-fx-s7'),
  (SELECT slot_state FROM public.user_subscription_slots WHERE user_id='07c9-fx-s7'),
  NULL;

-- Same-statement snapshot artifact: the slot_state subqueries above read the
-- pre-update snapshot. Re-read in a SEPARATE statement for the true post state.
INSERT INTO r
SELECT 'POSTREAD_' || u.uid, NULL,
       (SELECT slot_state FROM public.user_subscription_slots WHERE user_id = u.uid),
       'released_at_set=' || (SELECT (released_at IS NOT NULL)::text
          FROM public.user_subscription_slots WHERE user_id = u.uid)
  FROM (VALUES ('07c9-fx-s1'),('07c9-fx-s2'),('07c9-fx-s3'),('07c9-fx-s4'),
               ('07c9-fx-s5'),('07c9-fx-s6'),('07c9-fx-s7')) AS u(uid);

-- S8 repeated release on S3 (already RELEASED): must be FALSE, released_at unchanged.
CREATE TEMP TABLE s3_released_at ON COMMIT DROP AS
SELECT released_at FROM public.user_subscription_slots WHERE user_id='07c9-fx-s3';

INSERT INTO r SELECT 'S8_repeat_release', public.release_subscription_slot_if_due('07c9-fx-s3'),
  (SELECT slot_state FROM public.user_subscription_slots WHERE user_id='07c9-fx-s3'),
  'released_at_unchanged=' || (SELECT (sl.released_at = b.released_at)::text
     FROM public.user_subscription_slots sl, s3_released_at b WHERE sl.user_id='07c9-fx-s3');

-- S3 release must not have touched the subscription row itself.
INSERT INTO r SELECT 'S3_sub_row_untouched', NULL, NULL,
  (SELECT ('paid_through_same=' || (s.paid_through = b.paid_through)::text
        || ';updated_at_same=' || (s.updated_at = b.updated_at)::text
        || ';access_blocked_still_null=' || (s.access_blocked_at IS NULL)::text)
     FROM public.paypal_subscriptions s, s3_sub_before b WHERE s.user_id='07c9-fx-s3');

-- S9 resubscribe after release: acquire a fresh session for S3's user.
CREATE TEMP TABLE s9 ON COMMIT DROP AS
SELECT * FROM public.acquire_subscription_slot('07c9-fx-s3','monthly','P-07C9TEST2');

INSERT INTO r SELECT 'S9_resubscribe_after_release',
  (SELECT count(*) = 1 FROM s9),
  (SELECT slot_state FROM public.user_subscription_slots WHERE user_id='07c9-fx-s3'),
  'new_session=' || (SELECT (checkout_session_id IS NOT NULL)::text FROM s9)
  || ';old_cancelled_row_retained=' || (SELECT (count(*) = 2)::text FROM public.paypal_subscriptions WHERE user_id='07c9-fx-s3')
  || ';new_row_approval_pending=' || (SELECT (count(*) = 1)::text FROM public.paypal_subscriptions WHERE user_id='07c9-fx-s3' AND status='APPROVAL_PENDING');

-- S9b occupied slot blocks a second acquire — the RPC RAISEs
-- SUBSCRIPTION_SLOT_OCCUPIED, so it must run in a DO block with a handler.
DO $do$
BEGIN
  PERFORM public.acquire_subscription_slot('07c9-fx-s1','monthly','P-07C9TEST3');
  INSERT INTO r VALUES ('S9b_second_acquire_blocked', FALSE,
    (SELECT slot_state FROM public.user_subscription_slots WHERE user_id='07c9-fx-s1'),
    'UNEXPECTED: acquire succeeded on occupied slot');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO r VALUES ('S9b_second_acquire_blocked', TRUE,
    (SELECT slot_state FROM public.user_subscription_slots WHERE user_id='07c9-fx-s1'),
    'raised=' || SQLERRM);
END
$do$;

-- Real-data drift check INSIDE the transaction (fixtures must not touch real rows).
INSERT INTO r SELECT 'REAL_unchanged_in_txn', NULL, NULL,
  'identical=' || (SELECT (count(*) = 0)::text FROM (
     SELECT s.id, s.status, s.paid_through, s.last_payment_time, s.access_blocked_at, s.updated_at,
            sl.slot_state, sl.release_after, sl.released_at,
            (SELECT count(*) FROM public.paypal_subscription_transactions) AS tx_count
       FROM public.paypal_subscriptions s
       JOIN public.user_subscription_slots sl ON sl.user_id = s.user_id
      WHERE s.user_id NOT LIKE '07c9-fx-%'
     EXCEPT
     SELECT id, status, paid_through, last_payment_time, access_blocked_at, sub_updated_at,
            slot_state, release_after, released_at, tx_count
       FROM real_before) d);

SELECT scenario, released, slot_state, note FROM r ORDER BY scenario;

ROLLBACK;
