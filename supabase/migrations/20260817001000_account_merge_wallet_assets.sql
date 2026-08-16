-- P-AUTH-05A.2: Account Merge Coins/Tickets 最小補強
--
-- V1 scope (20260816000400_account_merge_requests_and_finalize.sql,
-- already applied to production) only transferred `points` (via the
-- existing points ledger) plus `shop_cart`/`user_mascots`/`redeem_history`
-- — `users.coins`/`users.tickets` were explicitly OUT of scope (see that
-- migration's own `excludedV1`-style framing). This migration ADDS coins
-- and tickets to the SAME atomic `finalize_account_merge` transaction,
-- using the SAME already-deployed, unmodified ledger primitives
-- (`apply_coin_transaction`/`apply_ticket_transaction` from
-- 20260817000000_ticket_coin_wallet_ledger.sql) and mirroring the EXISTING
-- points-transfer pattern byte-for-byte (lock-then-read anonymous balance,
-- skip entirely when zero, transfer-out-then-transfer-in via two ledgered
-- calls referencing the SAME claim id, never a raw `UPDATE users SET
-- coins = ...`).
--
-- NEVER edits an already-applied migration: `20260816000400`'s file is
-- untouched. `CREATE OR REPLACE FUNCTION public.finalize_account_merge`
-- (same 3-arg signature, same `public.account_merge_requests` return
-- type — no `DROP FUNCTION` needed since the signature/return type are
-- unchanged) supersedes only the function BODY.
--
-- Per this task's explicit scope ("不得重構 Account Merge"): the
-- Cart/Mascot/Redeem blocks below are copied VERBATIM from the
-- already-applied migration, byte-identical. The Points block was
-- ALSO originally copied verbatim, but see the follow-up hotfix note
-- below — since this file (20260817001000) is itself not yet applied,
-- its own Points block was fixed in place rather than left with a known
-- type mismatch. Nothing about the claim-locking, email-binding check,
-- canonical idempotency key computation/lookup, claim-expiry check, or
-- the claim-used/request-insert finalization at the end was changed.
--
-- Overflow handling (`bigint` vs `INTEGER`): `users.points`/`users.coins`/
-- `users.tickets` are all `bigint` on the real project, but
-- `apply_point_transaction`/`apply_coin_transaction`/`apply_ticket_transaction`
-- (existing, unmodified, shared by many OTHER callers — changing their
-- signature is explicitly out of scope for this "minimal
-- reinforcement" task) all declare `p_delta INTEGER`. ALL THREE asset
-- blocks below (Points, Coins, Tickets) read the anonymous account's
-- balance into a `BIGINT` local variable (never truncated to `INTEGER`
-- implicitly) and EXPLICITLY validate it fits within `INTEGER`'s range
-- BEFORE casting and calling the ledger RPC — an out-of-range balance
-- raises a clear, named exception (rolling back the ENTIRE merge
-- transaction, per requirement 9) instead of ever silently
-- wrapping/truncating a `bigint` value through an unchecked cast.
--
-- Hotfix (this file, not yet applied — fixed in place, no new migration
-- needed): the Points block ORIGINALLY still declared `v_anon_points
-- INTEGER` (copied verbatim from the already-applied 20260816000400,
-- which predates the bigint-column discovery) with no range guard — the
-- SAME latent bigint/integer mismatch class the Coins/Tickets blocks
-- were designed to avoid. Since this migration has never been applied,
-- it was corrected directly: `v_anon_points` is now `BIGINT`, with the
-- identical `IF v_anon_points > 2147483647 THEN RAISE EXCEPTION` guard
-- and `::INTEGER` casts at the two `apply_point_transaction` call sites,
-- byte-for-byte the same pattern as Coins/Tickets. This means the Points
-- block is NO LONGER byte-identical to `20260816000400`'s original (only
-- Cart/Mascot/RedeemHistory remain byte-verbatim) — an intentional,
-- narrowly-scoped fix, not a broader refactor of Account Merge.
--
-- Idempotency (requirement 3): `v_claim.id` (the SAME, already-existing
-- claim row id — never freshly generated per call) is passed as
-- `p_reference_id` to EVERY ledger call in this function (points, coins,
-- tickets) — identical to the existing Points block's own convention.
-- This is belt-and-suspenders: `finalize_account_merge`'s OWN idempotency
-- guarantee (canonical-key lookup + claim-status check, both UNCHANGED
-- above this point) already ensures this entire code path only ever runs
-- ONCE per real merge — a resend short-circuits via `RETURN
-- v_existing_request` long before reaching any ledger call.
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: purely additive (two new ledger call
-- blocks inside an existing function body); no table/column/policy is
-- added or altered.
-- ROLLBACK (manual): re-apply `20260816000400`'s original
-- `CREATE OR REPLACE FUNCTION public.finalize_account_merge(...)` body in
-- a new migration (never edit `20260816000400` itself).
-- VERIFICATION: `supabase/migrations/__tests__/account-merge-wallet-assets-shape.test.js`
-- (static structural tests only — see review-auth-05A.2-account-merge-wallet-assets.md
-- for the full manual/E2E verification plan; NOT executed by this task,
-- which is local-migration-and-tests-only, no `db push`/deploy).

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
    -- BIGINT to match users.points/users.coins/users.tickets' real column
    -- type — never implicitly narrowed to INTEGER. (Hotfix: v_anon_points
    -- was originally copied verbatim as INTEGER from the already-applied
    -- 20260816000400; since 20260817001000 itself is not yet applied, it
    -- was fixed in place here rather than adding another migration.)
    v_anon_points BIGINT := 0;
    v_anon_coins BIGINT := 0;
    v_anon_tickets BIGINT := 0;
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
    -- (unchanged from 20260816000400 — copied verbatim)

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
    -- both referencing this claim for audit traceability. Read as BIGINT
    -- (matches users.points' real type), explicit INTEGER-range guard
    -- before calling the (INTEGER-parameter) apply_point_transaction RPC
    -- — never an implicit/silent narrowing (same pattern as Coins/Tickets
    -- below).
    IF to_regclass('public.users') IS NOT NULL THEN
        SELECT COALESCE(points, 0) INTO v_anon_points
          FROM public.users
         WHERE user_id::text = v_claim.anonymous_user_id;

        IF v_anon_points IS NOT NULL AND v_anon_points > 0 THEN
            IF v_anon_points > 2147483647 THEN
                RAISE EXCEPTION 'finalize_account_merge: anonymous account points balance % exceeds the ledger''s INTEGER range, cannot merge safely', v_anon_points;
            END IF;

            PERFORM public.apply_point_transaction(v_claim.anonymous_user_id, (-v_anon_points)::INTEGER, 'account_merge_transfer_out', v_claim.id);
            PERFORM public.apply_point_transaction(p_existing_user_id, v_anon_points::INTEGER, 'account_merge_transfer_in', v_claim.id);
        END IF;
    END IF;

    -- --- P-AUTH-05A.2 NEW: Coins/Tickets, same ledgered-transfer pattern ---

    -- Coins: read as BIGINT (matches users.coins' real type), explicit
    -- INTEGER-range guard before calling the (INTEGER-parameter)
    -- apply_coin_transaction RPC — never an implicit/silent narrowing.
    IF to_regclass('public.users') IS NOT NULL THEN
        SELECT COALESCE(coins, 0) INTO v_anon_coins
          FROM public.users
         WHERE user_id::text = v_claim.anonymous_user_id;

        IF v_anon_coins IS NOT NULL AND v_anon_coins > 0 THEN
            IF v_anon_coins > 2147483647 THEN
                RAISE EXCEPTION 'finalize_account_merge: anonymous account coins balance % exceeds the ledger''s INTEGER range, cannot merge safely', v_anon_coins;
            END IF;

            PERFORM public.apply_coin_transaction(v_claim.anonymous_user_id, (-v_anon_coins)::INTEGER, 'account_merge_transfer_out', v_claim.id);
            PERFORM public.apply_coin_transaction(p_existing_user_id, v_anon_coins::INTEGER, 'account_merge_transfer_in', v_claim.id);
        END IF;
    END IF;

    -- Tickets: identical pattern to Coins above.
    IF to_regclass('public.users') IS NOT NULL THEN
        SELECT COALESCE(tickets, 0) INTO v_anon_tickets
          FROM public.users
         WHERE user_id::text = v_claim.anonymous_user_id;

        IF v_anon_tickets IS NOT NULL AND v_anon_tickets > 0 THEN
            IF v_anon_tickets > 2147483647 THEN
                RAISE EXCEPTION 'finalize_account_merge: anonymous account tickets balance % exceeds the ledger''s INTEGER range, cannot merge safely', v_anon_tickets;
            END IF;

            PERFORM public.apply_ticket_transaction(v_claim.anonymous_user_id, (-v_anon_tickets)::INTEGER, 'account_merge_transfer_out', v_claim.id);
            PERFORM public.apply_ticket_transaction(p_existing_user_id, v_anon_tickets::INTEGER, 'account_merge_transfer_in', v_claim.id);
        END IF;
    END IF;

    -- Only NOW, after every merge step above has succeeded without
    -- raising, do we mark the claim used and record the completed
    -- request (keyed by the CANONICAL key computed in Step 3). If
    -- anything above failed, execution never reaches here and the ENTIRE
    -- transaction (including the claim's status AND every ledger
    -- transfer above, points/coins/tickets/mascots/cart/redeem alike)
    -- rolls back — no partial success is ever possible.
    UPDATE public.account_merge_claims
       SET status = 'used', used_at = NOW()
     WHERE id = v_claim.id;

    -- PII minimization: result_json stores ONLY counts/amounts and the
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
            'coinsTransferred', COALESCE(v_anon_coins, 0),
            'ticketsTransferred', COALESCE(v_anon_tickets, 0),
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
