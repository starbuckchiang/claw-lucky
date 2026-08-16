# ADR-009: Existing Account Data Merge (Anonymous -> Existing Official Account)

Status

Proposed

Date

2026-08-15

Authors

claw-lucky Team

---

## Context

`specs/003-spec-auth-subscription.md` Section 7 (Existing Account Login) requires: when an
Anonymous User logs into a Email that already belongs to a **different, already-existing**
official account, the anonymous user's own data must be merged into that existing account:

- **Cart**: merge items, duplicates handled by product rule.
- **Mascot** / **Gift**: de-duplicate.
- **Points**: must NOT be summed directly — a transaction record must be created.
- **Subscription**: a user may have at most one active subscription.

P-AUTH-04.2 implemented the Existing Account Login OTP flow itself (`sendLoginOtp`/
`verifyLoginOtp`, `signInWithOtp({ shouldCreateUser: false })`), but explicitly stopped short of
performing this merge: a successful login always resolves to `EXISTING_ACCOUNT_MERGE_REQUIRED`
(blocker), never auto-resuming Checkout. This ADR documents **why** a real, automatic merge cannot
yet be safely implemented, and the concrete plan for building it.

### Table inventory (user-identity-linked data)

| Table | Owner column | RLS on `authenticated`? | Client-supplied ID trusted for writes today? | Written from |
|---|---|---|---|---|
| `public.users` | `user_id` (legacy string OR Auth UUID) | **Not found** in `supabase/migrations/**` | **Yes** — `js/api.js` (`getUser`, `createUserIfNotExists`, `adjustBalance`) uses a `userId` argument that ultimately comes from `localStorage.supabaseAuthUserId` via `window.ClawUser.getUserId()`, using the **anon key** | `js/api.js`, `js/services/wallpaper/points-repository.js` (server-side, Edge Function context) |
| `public.user_mascots` | `user_id` | **Not found** | Yes — same `js/api.js` pattern (`upsertUserMascot`, `getUserMascots`) | `js/api.js` |
| `public.redeem_history` | `user_id` (referenced via `DB.redeemHistory`) | **Not found** | Yes — same pattern | `js/api.js` (gacha/redeem flows) |
| `public.shop_cart` | `user_id` | **Not found** | Yes — `js/shop/shop_cart.js` reads/deletes cart rows `.eq("user_id", userId)` via the anon key | `js/shop/shop_cart.js` |
| `public.orders` / `public.order_items` | `user_id` | **Not found** | Yes — same checkout flow in `js/shop/shop_cart.js` | `js/shop/shop_cart.js` |
| `public.wallpaper_generations` / `wallpaper_generation_jobs` / `daily_generation_usage` | `user_id` | **Yes** — `p_*_select_owner` policies (`user_id::text = request_user_key()`); INSERT/UPDATE/DELETE are `RESTRICTIVE ... WITH CHECK (false)` for `authenticated` (service-role/Edge-Function only) | No — writes are backend-only | `supabase/functions/**` (service-role), read-only from browser |
| `public.mascots` / `public.gifts` | none (catalog tables, not user-owned) | n/a | n/a | shared catalog, not part of merge |
| `public.subscriptions` | **does not exist yet** | n/a | n/a | Checkout/Payment/Webhook (P-AUTH-04's `subscription-checkout` Edge Function) is still a placeholder — no real subscription row is ever created today |
| Points transaction/ledger | **does not exist yet** | n/a | n/a | `points-repository.js`'s `deductPoints()` does a raw read-then-arithmetic-UPDATE on `users.points`, no audit trail |

### Why an automatic merge cannot be safely built today

1. **No server-side identity proof for either UUID.** The only writes to `users`/`user_mascots`/
   `shop_cart`/`orders`/`redeem_history` today go through the **browser's anon key**, trusting a
   **client-supplied `userId`** (from `localStorage`) — the exact pattern `supabase.instructions.md`
   prohibits ("Do not trust a user ID supplied only through query parameters, request bodies, or
   localStorage"). A merge RPC that also trusted client-supplied IDs for either side of the merge
   would let ANY authenticated user merge ANY other account's data into their own by simply
   supplying its `user_id` — a critical horizontal-privilege-escalation risk. A safe merge MUST
   resolve both identities from verified JWTs/tokens server-side, never from request parameters.
2. **No RLS on the tables that would be merged.** `users`, `user_mascots`, `redeem_history`,
   `shop_cart`, `orders`/`order_items` have no committed RLS policies in this repo (unlike the
   `wallpaper_*` tables, which do). Any new merge logic must not "solve" this by disabling RLS
   elsewhere or by further loosening access — Rows must remain owner-scoped.
3. **No Points transaction/ledger table.** The spec requires Points to be merged via a **transaction
   record**, never a raw sum. No such ledger table exists; adding one is a schema change, not
   something a same-day hotfix should apply directly.
4. **No `subscriptions` table.** "At most one active subscription" cannot be enforced because no
   subscription row is ever persisted yet (Checkout is still a placeholder per P-AUTH-04's
   `checkout-authorization-service.js` doc comment: "Payment, Webhook, actual Subscription
   activation ... OUT of scope").
5. **Idempotency/retry precedent already exists and should be reused.** `wallpaper_generation_jobs`
   has a working precedent: `idempotency_key TEXT NOT NULL` + `UNIQUE (idempotency_key)`, with
   `job-repository.js`'s `insertJob()` generating a deterministic key when the caller doesn't supply
   one. The merge RPC's idempotency design (below) follows the same pattern.

Given all of the above, per this hotfix's explicit instruction ("若現有架構無法安全證明舊匿名身分，
先產出 ADR 與 migration/RPC 計畫，不得假裝合併成功"), **no schema change or real merge RPC is
implemented in this hotfix**. Instead:

- `js/services/auth/account-merge-service.js` (P-AUTH-04.3) implements the **final intended
  contract** (`mergeAnonymousIntoExistingAccount({ idempotencyKey })`), wired into
  `subscription-entry-guard.js`'s `completeLoginAndResume()`.
- With no `mergeRpcClient` configured (current, real production state), it **always** returns a
  deterministic `MERGE_NOT_SUPPORTED` failure (`retryable: false`) — never a fabricated success.
  Practical user-facing behavior is unchanged from P-AUTH-04.2: still blocked, still
  `EXISTING_ACCOUNT_MERGE_REQUIRED`, `pending` (the original `checkoutContext`) always preserved.
- Once the RPC below is built and an Edge-Function-backed `mergeRpcClient` is wired in, the exact
  same guard code path will automatically resume Checkout on success — no further guard/UI changes
  needed.

---

## Decision (proposed future design — NOT implemented by this hotfix)

### New tables (migration plan, NOT applied)

```sql
-- supabase/migrations/<timestamp>_account_merge_and_points_ledger.sql (PLAN ONLY — review before applying)

-- 1. Points must become a ledger, never a raw sum (spec Section 7 "Points").
CREATE TABLE IF NOT EXISTS public.point_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,               -- e.g. 'account_merge', 'generation_cost', 'admin_adjust'
    reference_id UUID,                  -- e.g. the account_merge_requests.id below
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. One row per merge ATTEMPT, keyed by idempotency_key, so retries are
--    provably safe (same precedent as wallpaper_generation_jobs.idempotency_key).
CREATE TABLE IF NOT EXISTS public.account_merge_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL,
    anonymous_user_id TEXT NOT NULL,
    existing_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'failed')),
    failure_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT uq_account_merge_requests_idempotency_key UNIQUE (idempotency_key),
    -- An anonymous user can only ever be the SOURCE of one successful merge —
    -- prevents merging the same anonymous identity into two different
    -- accounts by racing two requests.
    CONSTRAINT uq_account_merge_requests_anonymous_user_succeeded
        UNIQUE (anonymous_user_id) -- combined with a partial index WHERE status = 'succeeded' in practice
);

-- 3. `public.subscriptions` (referenced by future P-AUTH-04 Checkout work,
--    needed here only so "at most one active subscription" can be enforced
--    during merge) — sketch only, real column set owned by that task:
-- CREATE TABLE IF NOT EXISTS public.subscriptions (
--     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     user_id TEXT NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
--     status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due')),
--     ...
--     CONSTRAINT uq_subscriptions_one_active UNIQUE (user_id) -- combined with WHERE status = 'active'
-- );
```

### Proposed RPC (SECURITY DEFINER, called ONLY from a trusted Edge Function)

```sql
CREATE OR REPLACE FUNCTION public.merge_anonymous_account(
    p_idempotency_key TEXT,
    p_anonymous_user_id TEXT,   -- resolved server-side by the Edge Function from the
    p_existing_user_id TEXT    -- anonymous session's OWN JWT and the new session's OWN JWT
                                -- respectively — NEVER accepted as raw client parameters
                                -- without that verification happening first, in the Edge
                                -- Function, before this RPC is ever called.
) RETURNS public.account_merge_requests
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_request public.account_merge_requests;
BEGIN
    -- Idempotent: a repeated call with the same key returns the existing
    -- row instead of re-applying the merge.
    SELECT * INTO v_request FROM public.account_merge_requests
     WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
        RETURN v_request;
    END IF;

    INSERT INTO public.account_merge_requests (idempotency_key, anonymous_user_id, existing_user_id)
    VALUES (p_idempotency_key, p_anonymous_user_id, p_existing_user_id)
    RETURNING * INTO v_request;

    -- Single transaction (implicit, PL/pgSQL function body): dedupe
    -- shop_cart / user_mascots / gifts rows, write a point_transactions
    -- row instead of summing users.points directly, enforce at most one
    -- active subscription, then mark succeeded. On ANY error, the whole
    -- transaction rolls back and the request row is marked failed —
    -- never a partial merge.
    -- (Concrete dedupe/merge SQL is owned by the implementation task; not
    -- written here since the affected tables' exact constraints are not
    -- yet finalized — see "No RLS" / "No ledger" points above.)

    UPDATE public.account_merge_requests
       SET status = 'succeeded', completed_at = NOW()
     WHERE id = v_request.id
    RETURNING * INTO v_request;

    RETURN v_request;
END;
$$;
```

### Edge Function responsibilities (new, e.g. `supabase/functions/account-merge/`)

1. Require a valid Authorization Bearer JWT for the **existing account** (the caller's current,
   just-logged-in session) — reject with 401 otherwise, same pattern as
   `resolveAuthenticatedUser()` in `supabase/functions/_shared/supabase-clients.ts`.
2. Require the **anonymous user's own JWT/refresh token** to be presented too (e.g. captured by the
   frontend immediately before starting the Existing Account Login flow, analogous to how
   `previousAuthUserId` is already captured today) and independently verify it server-side via
   `anonClient.auth.getUser(anonymousToken)` — never trust a client-supplied anonymous `user_id`
   string by itself.
3. Only after BOTH identities are independently verified, call `merge_anonymous_account(...)` with
   the SERVER-RESOLVED ids (never the raw request body's ids) and a deterministic idempotency key
   derived the same way as `buildMergeIdempotencyKey()` in `subscription-entry-guard.js`.
4. Return a normalized `{ ok, data | error: { code, message, retryable } }` DTO exactly matching
   `account-merge-service.js`'s `mergeRpcClient` contract, so the frontend wiring added in this
   hotfix needs no further changes.

### Frontend wiring (already done by this hotfix, ready for the RPC above)

- `js/services/auth/account-merge-service.js`: `createAccountMergeService({ mergeRpcClient })`.
- `js/services/auth/subscription-entry-guard.js`: `completeLoginAndResume()` calls
  `accountMergeService.mergeAnonymousIntoExistingAccount({ idempotencyKey })` where
  `idempotencyKey = buildMergeIdempotencyKey(previousAuthUserId, authUserId)` —
  `merge:<anonymousUUID>:<existingUUID>`, deterministic per pair, safe to retry.
  - Success -> `authState` (already refreshed by `verifyLoginOtp`) + resumes the original
    `pending.checkoutContext` -> `ACTION.ENTER_CHECKOUT` (spec requirement 5).
  - Failure -> `ACTION.EXISTING_ACCOUNT_MERGE_REQUIRED`, `pending` preserved unchanged,
    `retryable` flag surfaced so the UI can distinguish "try again" from "not supported yet".

---

## Consequences

- **Positive**: the eventual merge implementation only requires building the RPC + Edge Function
  and injecting a real `mergeRpcClient` — no further changes to the Guard, UI, or auth flow. The
  idempotency contract is proven by unit tests today (`account-merge-service.test.js`,
  `subscription-entry-guard.test.js`) against fakes, so the real RPC only needs to satisfy the same
  contract.
- **Negative**: Existing Account Login remains blocked from auto-Checkout until this future work is
  done — an existing-account user must manually re-click "訂閱" after logging in (their own click
  then goes through `evaluateSubscriptionEntry()` -> `ENTER_CHECKOUT` directly, since they're now a
  real Official User; they just won't have their anonymous cart/mascot/points data yet).
- **Risk if skipped**: implementing "merge" by trusting client-supplied ids or a service-role key in
  the browser (both explicitly prohibited by this hotfix's requirements and by
  `supabase.instructions.md`) would allow a horizontal account-takeover / data-injection attack.
  This ADR exists specifically to prevent that shortcut from being taken under time pressure.

## Follow-up work (tracked, not started)

1. Add RLS policies to `users` / `user_mascots` / `redeem_history` / `shop_cart` / `orders` /
   `order_items` (currently missing — a pre-existing gap, independent of this ADR, flagged here
   because the merge RPC depends on these tables being properly owner-scoped first).
2. Build `point_transactions` ledger table + migrate `points-repository.js`'s `deductPoints()` to
   write a transaction row instead of a raw UPDATE.
3. Build the real `subscriptions` table (owned by the Checkout/Payment/Webhook work).
4. Implement `merge_anonymous_account()` RPC + `account-merge` Edge Function per the sketch above,
   with real Cart/Mascot/Gift dedupe rules confirmed by product.
5. Wire a real `mergeRpcClient` into `createAccountMergeService()` in `subscription-entry.js`.
