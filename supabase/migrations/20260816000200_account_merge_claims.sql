-- P-AUTH-05A: Existing Account Merge Security Foundation
-- `account_merge_claims` (requirement 4): the foundation for the
-- begin/finalize merge contract that P-AUTH-05B will implement as Edge
-- Functions. This table stores ONLY:
--   - `claim_token_hash`   — a one-way hash of a server-generated, one-time
--                            claim token. The RAW token is NEVER stored
--                            here (requirement 4) — it must be generated
--                            and hashed inside the Edge Function
--                            (P-AUTH-05B), sent to the user only via the
--                            existing OTP round trip, and only the HASH is
--                            ever passed into the functions below.
--   - `anonymous_user_id`  — the anonymous session's own Auth UUID,
--                            resolved server-side from ITS OWN verified
--                            JWT by the Edge Function (never a raw request
--                            parameter trusted as-is).
--   - `target_email_hash`  — a one-way hash of the target existing
--                            account's email (NOT the raw email — this
--                            table must not become a plaintext PII store).
--   - `expires_at`/`used_at`/`status` — the claim's lifecycle.
--   - `created_at`/`updated_at` — audit trail.
--
-- This migration does NOT implement the actual data merge (Cart/Mascot/
-- Gift/Points/Subscription) — only the claim CREATION lifecycle
-- (`create_account_merge_claim`/`expire_stale_account_merge_claims`).
-- Consuming/finalizing a claim (with the required email-binding check,
-- idempotency check, and the actual merge) lives in
-- 20260816000400_account_merge_requests_and_finalize.sql's
-- `finalize_account_merge()` — see review-auth-05A-hotfix.md
-- "P-AUTH-05B Begin/Finalize Merge Contract (Revised)" for the full,
-- corrected design.
--
-- Hardening (requirement 6): both functions are SECURITY DEFINER, pin
-- `search_path`, and have EXECUTE revoked from PUBLIC/anon/authenticated —
-- reachable ONLY from a trusted Edge Function using the service-role key
-- (never the frontend — requirement 3/6 "此階段不得加入 service-role key
-- 到前端" is about the FRONTEND never holding this key, not about these
-- functions being unreachable from legitimate backend code).
--
-- BACKWARD-COMPATIBLE / REVERSIBLE: purely additive (new table + two new
-- functions); nothing existing is modified.
-- ROLLBACK (manual):
--   REVOKE ALL ON FUNCTION public.expire_stale_account_merge_claims() FROM service_role;
--   DROP FUNCTION IF EXISTS public.expire_stale_account_merge_claims();
--   REVOKE ALL ON FUNCTION public.create_account_merge_claim(TEXT, TEXT, TEXT, INTEGER) FROM service_role;
--   DROP FUNCTION IF EXISTS public.create_account_merge_claim(TEXT, TEXT, TEXT, INTEGER);
--   DROP POLICY IF EXISTS p_account_merge_claims_deny_all_authenticated ON public.account_merge_claims;
--   DROP TABLE IF EXISTS public.account_merge_claims;
-- VERIFICATION (manual): see review-auth-05A.md "手動驗證步驟".

CREATE TABLE IF NOT EXISTS public.account_merge_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_token_hash TEXT NOT NULL,
    anonymous_user_id TEXT NOT NULL,
    target_email_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'used', 'expired', 'revoked')),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_account_merge_claims_token_hash UNIQUE (claim_token_hash),
    CONSTRAINT ck_account_merge_claims_expiry CHECK (expires_at > created_at),
    CONSTRAINT ck_account_merge_claims_used_only_when_used_at_set
        CHECK ((status = 'used') = (used_at IS NOT NULL))
);

-- At most ONE outstanding (pending) claim per anonymous user at a time —
-- keeps "one merge attempt in flight" simple and prevents unbounded
-- claim-token spam for the same anonymous session.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_merge_claims_anon_pending
    ON public.account_merge_claims (anonymous_user_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_account_merge_claims_expires_at
    ON public.account_merge_claims (expires_at);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'account_merge_claims'
           AND t.tgname = 'trg_account_merge_claims_set_updated_at'
    ) THEN
        -- Reuses public.set_updated_at(), already defined by
        -- 20260712040000_create_wallpaper_core_tables.sql.
        EXECUTE 'CREATE TRIGGER trg_account_merge_claims_set_updated_at
                 BEFORE UPDATE ON public.account_merge_claims
                 FOR EACH ROW
                 EXECUTE FUNCTION public.set_updated_at()';
    END IF;
END $$;

ALTER TABLE public.account_merge_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_account_merge_claims_deny_all_authenticated ON public.account_merge_claims;

-- No permissive policy exists for `anon`/`authenticated` at all — this
-- table is reachable ONLY via `service_role` (which bypasses RLS) calling
-- the two SECURITY DEFINER functions below, or a trusted Edge Function's
-- own service-role client. This explicit RESTRICTIVE deny-all is
-- defense-in-depth / documents the intent, matching this repo's existing
-- style (see 20260712122000_rls_wallpaper_core.sql).
CREATE POLICY p_account_merge_claims_deny_all_authenticated
    ON public.account_merge_claims
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

-- Begin Merge (P-AUTH-05B contract, Step 1): creates a new claim, first
-- revoking any still-pending claim for the SAME anonymous user (so a user
-- who abandons one attempt and starts a new one doesn't collide with the
-- unique-pending index above). Never receives or stores a raw token/email —
-- only their hashes, computed by the caller (Edge Function).
CREATE OR REPLACE FUNCTION public.create_account_merge_claim(
    p_anonymous_user_id TEXT,
    p_claim_token_hash TEXT,
    p_target_email_hash TEXT,
    p_ttl_seconds INTEGER DEFAULT 900
) RETURNS public.account_merge_claims
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_claim public.account_merge_claims;
BEGIN
    IF p_anonymous_user_id IS NULL OR btrim(p_anonymous_user_id) = '' THEN
        RAISE EXCEPTION 'create_account_merge_claim: p_anonymous_user_id is required';
    END IF;

    IF p_claim_token_hash IS NULL OR btrim(p_claim_token_hash) = '' THEN
        RAISE EXCEPTION 'create_account_merge_claim: p_claim_token_hash is required';
    END IF;

    IF p_target_email_hash IS NULL OR btrim(p_target_email_hash) = '' THEN
        RAISE EXCEPTION 'create_account_merge_claim: p_target_email_hash is required';
    END IF;

    IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
        RAISE EXCEPTION 'create_account_merge_claim: p_ttl_seconds must be positive';
    END IF;

    UPDATE public.account_merge_claims
       SET status = 'revoked'
     WHERE anonymous_user_id = p_anonymous_user_id
       AND status = 'pending';

    INSERT INTO public.account_merge_claims (
        claim_token_hash, anonymous_user_id, target_email_hash, expires_at
    )
    VALUES (
        p_claim_token_hash, p_anonymous_user_id, p_target_email_hash, NOW() + make_interval(secs => p_ttl_seconds)
    )
    RETURNING * INTO v_claim;

    RETURN v_claim;
END;
$$;

REVOKE ALL ON FUNCTION public.create_account_merge_claim(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_account_merge_claim(TEXT, TEXT, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.create_account_merge_claim(TEXT, TEXT, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_account_merge_claim(TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- SUPERSEDED (P-AUTH-05A-fix Gate blocker #2/#3): this migration originally
-- defined a `consume_account_merge_claim(p_claim_token_hash,
-- p_existing_user_id)` function here that ONLY marked a claim `used` —
-- with NO check that the caller's own (verified) email actually matched
-- `target_email_hash`, and as a SEPARATE call from the actual data merge.
-- That is unsafe on two counts: (1) without an email-binding check, ANY
-- authenticated existing account could consume ANY claim by supplying its
-- own `user_id`, merging someone else's anonymous data into the wrong
-- account; (2) splitting "mark used" from "do the merge" into two calls
-- means a merge failure AFTER the claim was marked used would leave the
-- claim permanently unusable with NOTHING actually merged (no possible
-- retry). It has been REMOVED and replaced by the single atomic
-- `public.finalize_account_merge(...)` in
-- 20260816000400_account_merge_requests_and_finalize.sql, which performs
-- the email-hash comparison, idempotency check, the actual merge, AND
-- marking the claim `used` all inside ONE transaction — any failure rolls
-- back everything, including the claim's status, so it stays retryable.
-- (No `DROP FUNCTION` is needed here since `consume_account_merge_claim`
-- was never created by any migration that ran before this fix — it never
-- existed in a deployed environment.)

-- Housekeeping: a claim past its expires_at is functionally dead but its
-- `status` column would still (harmlessly) read 'pending' until something
-- flips it — this sweep function lets a scheduled job (pg_cron or an Edge
-- Function on a timer, NOT implemented here) mark them 'expired' for
-- clean audit/reporting. Never called from the frontend either.
CREATE OR REPLACE FUNCTION public.expire_stale_account_merge_claims()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE public.account_merge_claims
       SET status = 'expired'
     WHERE status = 'pending'
       AND expires_at <= NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_account_merge_claims() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_account_merge_claims() FROM anon;
REVOKE ALL ON FUNCTION public.expire_stale_account_merge_claims() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_account_merge_claims() TO service_role;
