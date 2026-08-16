-- P-AUTH-05A.1 Hotfix: account_merge_requests (idempotency ledger) +
-- finalize_account_merge — DATABASE-COMPUTED canonical idempotency key,
-- never a client-supplied one (fixes the P-AUTH-05A.1 "冪等授權問題").
--
-- P-AUTH-05A-fix's `finalize_account_merge(p_claim_token_hash,
-- p_existing_user_id, p_existing_user_email_hash, p_idempotency_key)`
-- still had a real authorization hole: it looked up
-- `account_merge_requests` BY THE CALLER-SUPPLIED `p_idempotency_key`
-- BEFORE validating the claim or the email at all. That means whoever
-- controls the `idempotencyKey` value (ultimately the HTTP request,
-- however indirectly) could potentially replay/collide with an unrelated
-- prior request's cached result without ever proving they hold a valid
-- claim for THIS anonymous/existing pair — the idempotency check itself
-- was an authorization bypass.
--
-- FIX: `p_idempotency_key` is REMOVED from this function's parameters
-- entirely. The Edge Function calling this RPC (P-AUTH-05B, not yet
-- implemented) must never accept an idempotency key, anonymous UID,
-- existing UID, or email hash from the untrusted HTTP request body —
-- `p_existing_user_id`/`p_existing_user_email_hash` must be resolved from
-- the CALLER'S OWN verified Session (`resolveAuthenticatedUser()`), and
-- the anonymous side comes from the claim row itself (`v_claim.
-- anonymous_user_id`), never from a parameter. The canonical idempotency
-- key is then COMPUTED INSIDE THIS FUNCTION, deterministically, from
-- those two server-verified values — `'merge:' || anonymous_user_id ||
-- ':' || existing_user_id` (same textual shape as the existing
-- `subscription-entry-guard.js`'s `buildMergeIdempotencyKey()`, but now
-- computed by Postgres itself, never trusted from a caller).
--
-- Corrected validation ORDER (this is the actual fix — a caller can no
-- longer get ANY result before the claim+email are proven valid):
--   1. Lock the claim row by `claim_token_hash` (`FOR UPDATE`) — not
--      found -> reject.
--   2. Compare `v_claim.target_email_hash` to the caller's own verified
--      `p_existing_user_email_hash` — mismatch -> reject. This check runs
--      REGARDLESS of the claim's `status` (pending OR used), so a
--      different existing account can never piggy-back on someone else's
--      claim, even an already-used one, to peek at cached results.
--   3. ONLY NOW compute the canonical idempotency key from
--      `v_claim.anonymous_user_id` + `p_existing_user_id`, and look up
--      `account_merge_requests` by it:
--        - FOUND -> this is a legitimate resend of an already-completed
--          merge for THIS exact, now-proven pair -> return the stored
--          result unchanged (never re-applies points/re-moves data).
--        - NOT FOUND and `v_claim.status = 'used'` -> DATA INCONSISTENCY
--          (a claim can only become `used` by this same function, in the
--          same transaction that inserts the matching request row — if
--          that invariant is somehow violated, e.g. by a manual/other
--          write path, this is a bug, not a legitimate state) -> reject
--          loudly rather than silently proceeding.
--        - NOT FOUND and `v_claim.status <> 'pending'` (e.g. `revoked`)
--          or expired -> reject as before.
--        - NOT FOUND and `status = 'pending'` and not expired -> proceed
--          with the actual merge.
--   4. Perform the V1-scope merge (shop_cart/user_mascots/redeem_history/
--      points via `apply_point_transaction`).
--   5. Only after every merge step succeeds: mark the claim `used` and
--      INSERT the `account_merge_requests` row (keyed by the canonical
--      idempotency key) in the SAME transaction. Any `RAISE EXCEPTION`
--      anywhere above rolls back everything, including the claim's
--      status — it stays `pending`/retryable.
--
-- Concurrency: two simultaneous finalize calls for the SAME claim both
-- attempt `SELECT ... FOR UPDATE` on the same row — the second BLOCKS
-- until the first's transaction commits, then (per Postgres MVCC + row
-- locking semantics) reads the FIRST transaction's committed result
-- (`status = 'used'`), computes the SAME canonical key, finds the
-- request the first call inserted, and safely returns it — no unique
-- constraint violation, no double merge, no lost update.
--
-- V1 SCOPE (unchanged from P-AUTH-05A-fix): only `shop_cart`,
-- `user_mascots`, `redeem_history`, and `users.points` are merged.
-- `orders`/`order_items`/`subscriptions`/`logs` are DELIBERATELY untouched
-- (recorded in `result_json.excludedV1`).
--
-- PII MINIMIZATION: `result_json` stores ONLY row counts and the
-- `excludedV1` table-name list — never an email, a token, a token hash,
-- or any other unnecessary personal data.
--
-- DEPLOYMENT ORDER DEPENDENCY (unchanged): requires
-- `uq_user_mascots_user_mascot` from
-- 20260816000300_user_mascots_dedup_and_unique_constraint.sql to already
-- exist (ON CONFLICT (user_id, mascot_id) below).
--
-- GATE FRAMEWORK (P-AUTH-05A.1 requirement 8): this repository now tracks
-- three distinct gates for this feature, replacing the previous informal
-- "Gate 4"/"P-AUTH-05A PASS" language:
--   - 05A Design Gate  — schema/RLS/SECURITY DEFINER function DESIGN is
--     sound (this migration + its siblings + static structural tests).
--   - 05B Implementation — the actual Begin/Finalize Edge Functions get
--     written against the contract in review-auth-05A.1-hotfix.md. NOT
--     STARTED by this migration.
--   - 05C Staging Gate — the "真實 PostgreSQL 測試計畫" tests actually run
--     against a real/staging Supabase project. NOT DONE by this
--     migration.
-- Production deployment requires ALL THREE gates to pass, in order. This
-- migration file itself is still NOT deployed anywhere (05A Design Gate
-- work only).
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: purely additive (new table + new
-- function). The 4-arg `finalize_account_merge` from P-AUTH-05A-fix is
-- replaced in-place (that migration was never deployed, so no
-- `DROP FUNCTION` for the old signature is needed here).
-- ROLLBACK (manual):
--   REVOKE ALL ON FUNCTION public.finalize_account_merge(TEXT, TEXT, TEXT) FROM service_role;
--   DROP FUNCTION IF EXISTS public.finalize_account_merge(TEXT, TEXT, TEXT);
--   DROP POLICY IF EXISTS p_account_merge_requests_deny_all_authenticated ON public.account_merge_requests;
--   DROP TABLE IF EXISTS public.account_merge_requests;
-- VERIFICATION (manual): see review-auth-05A.1-hotfix.md "真實 PostgreSQL
-- 測試計畫（05C Staging Gate）".

CREATE TABLE IF NOT EXISTS public.account_merge_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ALWAYS the database-computed canonical key
    -- ('merge:'||anonymous_user_id||':'||existing_user_id) — never a
    -- caller-supplied value.
    idempotency_key TEXT NOT NULL,
    anonymous_user_id TEXT NOT NULL,
    existing_user_id TEXT NOT NULL,
    claim_id UUID NOT NULL REFERENCES public.account_merge_claims(id) ON DELETE RESTRICT,
    result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_account_merge_requests_idempotency_key UNIQUE (idempotency_key),
    -- A row here is only ever inserted once a merge has FULLY succeeded
    -- (any failure rolls back the whole transaction, including this
    -- insert) — so an anonymous user can be the source of at most ONE
    -- successful merge, ever.
    CONSTRAINT uq_account_merge_requests_anonymous_user UNIQUE (anonymous_user_id)
);

ALTER TABLE public.account_merge_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_account_merge_requests_deny_all_authenticated ON public.account_merge_requests;

-- Same posture as account_merge_claims: no permissive policy for
-- anon/authenticated at all; reachable only via service_role /
-- finalize_account_merge() (SECURITY DEFINER).
CREATE POLICY p_account_merge_requests_deny_all_authenticated
    ON public.account_merge_requests
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.finalize_account_merge(
    p_claim_token_hash TEXT,
    p_existing_user_id TEXT,
    p_existing_user_email_hash TEXT
) RETURNS public.account_merge_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_claim public.account_merge_claims;
    v_canonical_idempotency_key TEXT;
    v_existing_request public.account_merge_requests;
    v_request public.account_merge_requests;
    v_cart_merged_count INTEGER := 0;
    v_mascots_merged_count INTEGER := 0;
    v_redeem_reassigned_count INTEGER := 0;
    v_anon_points INTEGER := 0;
BEGIN
    IF p_claim_token_hash IS NULL OR btrim(p_claim_token_hash) = '' THEN
        RAISE EXCEPTION 'finalize_account_merge: p_claim_token_hash is required';
    END IF;

    IF p_existing_user_id IS NULL OR btrim(p_existing_user_id) = '' THEN
        RAISE EXCEPTION 'finalize_account_merge: p_existing_user_id is required';
    END IF;

    IF p_existing_user_email_hash IS NULL OR btrim(p_existing_user_email_hash) = '' THEN
        RAISE EXCEPTION 'finalize_account_merge: p_existing_user_email_hash is required';
    END IF;

    -- Step 1: lock the claim FIRST. Nothing (not even an idempotency
    -- lookup) happens before this — a caller cannot get ANY result
    -- without first pointing at a real claim row.
    SELECT * INTO v_claim
      FROM public.account_merge_claims
     WHERE claim_token_hash = p_claim_token_hash
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'finalize_account_merge: claim not found';
    END IF;

    -- Step 2: email binding check — runs for BOTH pending and used
    -- claims, so a resend/replay attempt from a DIFFERENT existing
    -- account (wrong email) can never reach the idempotency lookup below,
    -- even for an already-used claim.
    IF v_claim.target_email_hash <> p_existing_user_email_hash THEN
        RAISE EXCEPTION 'finalize_account_merge: existing account email does not match this claim''s target email';
    END IF;

    -- Step 3: ONLY NOW compute the canonical idempotency key — from
    -- server-verified values only (the claim's own anonymous_user_id,
    -- and the caller's own existing_user_id), never from anything the
    -- caller could set directly.
    v_canonical_idempotency_key := 'merge:' || v_claim.anonymous_user_id || ':' || p_existing_user_id;

    SELECT * INTO v_existing_request
      FROM public.account_merge_requests
     WHERE idempotency_key = v_canonical_idempotency_key;

    IF FOUND THEN
        -- Legitimate resend of an already-completed merge for this exact,
        -- now-proven (claim + matching email) pair.
        RETURN v_existing_request;
    END IF;

    -- No completed request exists for this canonical pair. If the claim
    -- is already `used`, that is a genuine inconsistency (this function
    -- is the ONLY place that ever sets `status = 'used'`, always in the
    -- same transaction as inserting the matching request row) — reject
    -- loudly instead of silently re-running the merge.
    IF v_claim.status = 'used' THEN
        RAISE EXCEPTION 'finalize_account_merge: claim is marked used but no matching completed request was found (data inconsistency)';
    END IF;

    IF v_claim.status <> 'pending' THEN
        RAISE EXCEPTION 'finalize_account_merge: claim is not pending (status=%)', v_claim.status;
    END IF;

    IF v_claim.expires_at <= NOW() THEN
        RAISE EXCEPTION 'finalize_account_merge: claim has expired';
    END IF;

    -- --- V1 merge scope: shop_cart, user_mascots, redeem_history, points ---
    -- orders/order_items/subscriptions/logs are DELIBERATELY untouched —
    -- see result_json.excludedV1 below.

    -- Cart: merge by product_id, summing quantity, capped at the product's
    -- current stock when known (best-effort; final stock re-validation at
    -- Checkout time is still required and unaffected by this).
    IF to_regclass('public.shop_cart') IS NOT NULL THEN
        WITH moved AS (
            UPDATE public.shop_cart existing_row
               SET quantity = LEAST(
                       existing_row.quantity + anon_row.quantity,
                       COALESCE((SELECT sp.stock FROM public.shop_products sp WHERE sp.id = existing_row.product_id), existing_row.quantity + anon_row.quantity)
                   ),
                   selected = existing_row.selected OR anon_row.selected,
                   unlock_verified = existing_row.unlock_verified OR anon_row.unlock_verified,
                   updated_at = NOW()
              FROM public.shop_cart anon_row
             WHERE anon_row.user_id::text = v_claim.anonymous_user_id
               AND existing_row.user_id::text = p_existing_user_id
               AND existing_row.product_id = anon_row.product_id
            RETURNING existing_row.id
        )
        SELECT COUNT(*) INTO v_cart_merged_count FROM moved;

        -- Rows for products the existing account did NOT already have:
        -- simply re-point them to the existing account.
        UPDATE public.shop_cart
           SET user_id = p_existing_user_id,
               updated_at = NOW()
         WHERE user_id::text = v_claim.anonymous_user_id
           AND product_id NOT IN (
               SELECT product_id FROM public.shop_cart WHERE user_id::text = p_existing_user_id
           );

        -- Any remaining anonymous-owned rows are the ones just merged
        -- INTO the existing account's matching row above — remove the
        -- now-redundant anonymous copies.
        DELETE FROM public.shop_cart WHERE user_id::text = v_claim.anonymous_user_id;
    END IF;

    -- Mascots: requires uq_user_mascots_user_mascot (see deployment-order
    -- note above) so ON CONFLICT can dedupe correctly.
    IF to_regclass('public.user_mascots') IS NOT NULL THEN
        WITH inserted AS (
            INSERT INTO public.user_mascots (user_id, mascot_id, mascot_name, rarity, image, obtain_count, first_obtained_at, last_obtained_at)
            SELECT p_existing_user_id, mascot_id, mascot_name, rarity, image, obtain_count, first_obtained_at, last_obtained_at
              FROM public.user_mascots
             WHERE user_id::text = v_claim.anonymous_user_id
            ON CONFLICT (user_id, mascot_id) DO UPDATE
                SET obtain_count = public.user_mascots.obtain_count + EXCLUDED.obtain_count,
                    first_obtained_at = LEAST(public.user_mascots.first_obtained_at, EXCLUDED.first_obtained_at),
                    last_obtained_at = GREATEST(public.user_mascots.last_obtained_at, EXCLUDED.last_obtained_at)
            RETURNING mascot_id
        )
        SELECT COUNT(*) INTO v_mascots_merged_count FROM inserted;

        DELETE FROM public.user_mascots WHERE user_id::text = v_claim.anonymous_user_id;
    END IF;

    -- Redeem history: reassign ownership only, never de-duplicated (spec
    -- Product Decision #16 — redeemed gifts are never consumed/merged,
    -- just reattributed to the existing account).
    IF to_regclass('public.redeem_history') IS NOT NULL THEN
        WITH reassigned AS (
            UPDATE public.redeem_history
               SET user_id = p_existing_user_id,
                   updated_at = NOW()
             WHERE user_id::text = v_claim.anonymous_user_id
            RETURNING 1
        )
        SELECT COUNT(*) INTO v_redeem_reassigned_count FROM reassigned;
    END IF;

    -- Points: NEVER a raw sum. Transfer the anonymous account's full
    -- balance via two ledgered transactions (out of anon, into existing),
    -- both referencing this claim for audit traceability.
    IF to_regclass('public.users') IS NOT NULL THEN
        SELECT COALESCE(points, 0) INTO v_anon_points
          FROM public.users
         WHERE user_id::text = v_claim.anonymous_user_id;

        IF v_anon_points IS NOT NULL AND v_anon_points > 0 THEN
            PERFORM public.apply_point_transaction(v_claim.anonymous_user_id, -v_anon_points, 'account_merge_transfer_out', v_claim.id);
            PERFORM public.apply_point_transaction(p_existing_user_id, v_anon_points, 'account_merge_transfer_in', v_claim.id);
        END IF;
    END IF;

    -- Only NOW, after every merge step above has succeeded without
    -- raising, do we mark the claim used and record the completed
    -- request (keyed by the CANONICAL key computed in Step 3). If
    -- anything above failed, execution never reaches here and the ENTIRE
    -- transaction (including the claim's status) rolls back.
    UPDATE public.account_merge_claims
       SET status = 'used', used_at = NOW()
     WHERE id = v_claim.id;

    -- PII minimization: result_json stores ONLY counts and the
    -- excludedV1 table list — never an email, a token, or a token hash.
    INSERT INTO public.account_merge_requests (idempotency_key, anonymous_user_id, existing_user_id, claim_id, result_json)
    VALUES (
        v_canonical_idempotency_key,
        v_claim.anonymous_user_id,
        p_existing_user_id,
        v_claim.id,
        jsonb_build_object(
            'cartMerged', v_cart_merged_count,
            'mascotsMerged', v_mascots_merged_count,
            'redeemHistoryReassigned', v_redeem_reassigned_count,
            'pointsTransferred', COALESCE(v_anon_points, 0),
            'excludedV1', jsonb_build_array('orders', 'order_items', 'subscriptions', 'logs')
        )
    )
    RETURNING * INTO v_request;

    RETURN v_request;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_account_merge(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_account_merge(TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_account_merge(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_account_merge(TEXT, TEXT, TEXT) TO service_role;
