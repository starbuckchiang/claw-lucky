-- Legacy Orders seed inserted BEFORE subscriptions migration (Auth-07C.2A).

INSERT INTO public.users (user_id, nickname, points, tickets, coins)
VALUES
  ('user-a', 'Alpha', 100, 7, 33),
  ('user-b', 'Beta', 0, 0, 20),
  ('user-c', 'Gamma', 0, 0, 20),
  ('user-d', 'Delta', 0, 0, 20),
  ('user-ttl-unbound', 'TTL1', 0, 0, 20),
  ('user-ttl-bound', 'TTL2', 0, 0, 20),
  ('user-cancel', 'Cancel', 0, 0, 20),
  ('user-active', 'Active', 0, 0, 20),
  ('user-wh', 'Webhook', 0, 0, 20)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.payment_orders (
  id, user_id, plan_code, amount, currency, status,
  paypal_order_id, paypal_capture_id, create_request_id, paid_at
) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'user-a',
  'monthly',
  5.00,
  'USD',
  'paid',
  'LEGACY-ORDER-SEED-1',
  'LEGACY-CAPTURE-SEED-1',
  'create-req-legacy-seed-1',
  NOW() - INTERVAL '1 day'
);

INSERT INTO public.payment_webhook_events (
  paypal_event_id, event_type, verification_status, processing_status,
  paypal_order_id, paypal_capture_id, payload, processed_at
) VALUES (
  'WH-LEGACY-SEED-1',
  'PAYMENT.CAPTURE.COMPLETED',
  'SUCCESS',
  'processed',
  'LEGACY-ORDER-SEED-1',
  'LEGACY-CAPTURE-SEED-1',
  '{"seed":true}'::jsonb,
  NOW() - INTERVAL '1 day'
);
