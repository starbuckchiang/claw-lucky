-- Auth-07C.7E.1: ACTIVE + paid_through=null seed AFTER hotfix migration.
-- Inserted after 20260907000100, before 20260908000100.

INSERT INTO public.users (user_id, nickname, points, tickets, coins)
VALUES
  ('user-recon', 'Recon', 0, 0, 20),
  ('user-recon-b', 'ReconB', 0, 0, 20),
  ('user-owner-rls', 'OwnerRls', 0, 0, 20)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.paypal_subscriptions (
  id,
  user_id,
  checkout_session_id,
  paypal_subscription_id,
  paypal_plan_id,
  plan_code,
  status,
  currency,
  recurring_amount,
  paid_through,
  next_billing_time,
  reconciliation_status,
  start_time,
  created_at,
  updated_at
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
  'user-recon',
  'sess-recon-1',
  'I-RECON-1',
  'P-MONTHLY-ALLOW',
  'monthly',
  'ACTIVE',
  'USD',
  5.00,
  NULL,
  NULL,
  'none',
  NOW() - INTERVAL '1 hour',
  NOW() - INTERVAL '1 hour',
  NOW() - INTERVAL '1 hour'
);

INSERT INTO public.user_subscription_slots (
  user_id,
  slot_state,
  checkout_session_id,
  subscription_id,
  occupied_at,
  release_after
) VALUES (
  'user-recon',
  'OCCUPIED',
  'sess-recon-1',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
  NOW() - INTERVAL '1 hour',
  NULL
);

-- Second subscription for cross-sub / owner isolation tests.
INSERT INTO public.paypal_subscriptions (
  id,
  user_id,
  checkout_session_id,
  paypal_subscription_id,
  paypal_plan_id,
  plan_code,
  status,
  currency,
  recurring_amount,
  paid_through,
  reconciliation_status,
  created_at,
  updated_at
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
  'user-recon-b',
  'sess-recon-b',
  'I-RECON-B',
  'P-MONTHLY-ALLOW',
  'monthly',
  'ACTIVE',
  'USD',
  5.00,
  NULL,
  'none',
  NOW() - INTERVAL '1 hour',
  NOW() - INTERVAL '1 hour'
);

INSERT INTO public.user_subscription_slots (
  user_id, slot_state, checkout_session_id, subscription_id, occupied_at
) VALUES (
  'user-recon-b',
  'OCCUPIED',
  'sess-recon-b',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
  NOW() - INTERVAL '1 hour'
);

INSERT INTO public.paypal_subscriptions (
  id,
  user_id,
  checkout_session_id,
  paypal_subscription_id,
  paypal_plan_id,
  plan_code,
  status,
  currency,
  recurring_amount,
  paid_through,
  reconciliation_status,
  created_at,
  updated_at
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3',
  'user-owner-rls',
  'sess-owner-rls',
  'I-OWNER-RLS',
  'P-YEARLY-ALLOW',
  'yearly',
  'ACTIVE',
  'USD',
  48.00,
  NULL,
  'none',
  NOW() - INTERVAL '1 hour',
  NOW() - INTERVAL '1 hour'
);

INSERT INTO public.user_subscription_slots (
  user_id, slot_state, checkout_session_id, subscription_id, occupied_at
) VALUES (
  'user-owner-rls',
  'OCCUPIED',
  'sess-owner-rls',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3',
  NOW() - INTERVAL '1 hour'
);
