# Auth-07C.7 Precheck (paused for human Buyer approve)

Recorded before any subscription payment. **No payment attempted yet.**

```text
verify-local: 827/827 PASS
PAYPAL_ENV: sandbox (secret digest MATCH sha256(sandbox); config.js=sandbox)
paypal-subscription: ACTIVE v1, verify_jwt=true
paypal-webhook: ACTIVE v7, verify_jwt=false (gateway)
PayPal signature verification: ON (handler requires verify before mutate)
monthly plan: ACTIVE, USD 5.0 / MONTH / total_cycles=0 (auto-renew), id prefix P-5KH0
Frontend: vault=true intent=subscription; no paypal-checkout-service; no createOrder

Pre-payment table counts:
  paypal_subscriptions: 0
  user_subscription_slots: 0
  paypal_subscription_transactions: 0
  payment_webhook_events: 4 (legacy Orders only; all processed)

Blocking subscriptions: 0 (global)
Official test user get_status: equivalent NULL (no subscription rows exist for any user)

Gate status: READY_FOR_BUYER_APPROVE (not BLOCKED_EXISTING_SUBSCRIPTION)
```

Waiting for human: refresh `http://localhost:5500/subscription.html`, click monthly PayPal subscribe **once**, approve with Personal Sandbox Buyer.
