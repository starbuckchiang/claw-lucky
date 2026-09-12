-- WEB-HOME-01A: user_consents append-only consent audit table + secure write RPC
--
-- Purpose: persist a server-authoritative record of the user's active
-- consent to the Terms of Service / Privacy Policy at the moment they
-- (a) start the formal-member upgrade (account_upgrade) or (b) start a
-- PayPal subscription checkout (checkout). Records are APPEND-ONLY:
-- users can only SELECT their own rows; nobody (including service_role,
-- via trigger) can UPDATE or DELETE rows through ordinary SQL.
--
-- Writes happen ONLY through the consent-ops Edge Function (service_role)
-- calling public.record_user_consent(...) below. The Edge Function derives
-- user_id from the verified JWT and versions/hashes from the server-side
-- canonical policy module (supabase/functions/_shared/lib/policy-versions.ts)
-- — the browser can never supply user_id / accepted_at / versions / hashes.
--
-- Deliberately NOT stored (WEB-HOME-01A section 3): Email, IP, JWT,
-- access tokens, PayPal payer data, card data, Client Secret, service-role
-- key. Only scope/version/hash/time/correlation metadata.
--
-- Deletion policy design decision (WEB-HOME-01A section 4): the FK to
-- auth.users(id) uses the default NO ACTION (NOT ON DELETE CASCADE), so a
-- future account-deletion flow must explicitly decide how to handle the
-- consent audit trail (legal retention vs erasure) — silent cascade
-- deletion of an audit record is prohibited. Until that flow exists,
-- deleting an auth.users row with consents will fail loudly by design.
--
-- NOT applied to any environment by this task (WEB-HOME-01A section 9:
-- no `supabase db push`). Local file + static structural tests only.

CREATE TABLE public.user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  consent_scope text NOT NULL,
  terms_version text,
  privacy_version text,
  terms_content_sha256 text,
  privacy_content_sha256 text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  correlation_id text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_consents_scope_allowlist CHECK (
    consent_scope IN ('account_upgrade', 'checkout', 'digital_content_waiver')
  ),

  CONSTRAINT user_consents_source_allowlist CHECK (
    source IN ('subscription_page', 'account_upgrade_form')
  ),

  -- Per-scope version/hash requirements:
  --   account_upgrade        -> consents to Terms AND Privacy (all 4 required)
  --   checkout               -> consents to Terms (terms fields required)
  --   digital_content_waiver -> waiver against Terms (terms fields required)
  CONSTRAINT user_consents_scope_versions CHECK (
    (
      consent_scope = 'account_upgrade'
      AND terms_version IS NOT NULL
      AND privacy_version IS NOT NULL
      AND terms_content_sha256 IS NOT NULL
      AND privacy_content_sha256 IS NOT NULL
    )
    OR (
      consent_scope IN ('checkout', 'digital_content_waiver')
      AND terms_version IS NOT NULL
      AND terms_content_sha256 IS NOT NULL
    )
  ),

  CONSTRAINT user_consents_hash_shape CHECK (
    (terms_content_sha256 IS NULL OR terms_content_sha256 ~ '^[0-9a-f]{64}$')
    AND (privacy_content_sha256 IS NULL OR privacy_content_sha256 ~ '^[0-9a-f]{64}$')
  ),

  CONSTRAINT user_consents_idempotency_key_shape CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 128
  ),

  CONSTRAINT user_consents_user_scope_idem_key UNIQUE (user_id, consent_scope, idempotency_key)
);

CREATE INDEX user_consents_user_id_idx ON public.user_consents (user_id);

-- ---------------------------------------------------------------------------
-- Append-only enforcement: block UPDATE/DELETE at the database level for
-- EVERY ordinary role (including service_role — it bypasses RLS but not
-- triggers). Consent audit rows are immutable once written.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.prevent_user_consents_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'user_consents is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_user_consents_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_user_consents_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_user_consents_mutation() FROM authenticated;

CREATE TRIGGER user_consents_append_only
  BEFORE UPDATE OR DELETE ON public.user_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_user_consents_mutation();

-- ---------------------------------------------------------------------------
-- RLS: owner-only SELECT; NO INSERT/UPDATE/DELETE policies for anon or
-- authenticated (deny-all for writes). Grants revoked as defense in depth
-- (this project keeps Supabase's permissive default grants otherwise —
-- see review-auth-SEC-01-public-rls-audit.md).
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_consents_owner_select
  ON public.user_consents
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.user_consents FROM PUBLIC;
REVOKE ALL ON TABLE public.user_consents FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_consents FROM authenticated;
GRANT SELECT ON TABLE public.user_consents TO authenticated;

-- ---------------------------------------------------------------------------
-- Secure write RPC — called ONLY by the consent-ops Edge Function with the
-- service_role key. Idempotent: INSERT ... ON CONFLICT DO NOTHING against
-- the (user_id, consent_scope, idempotency_key) unique constraint is the
-- serialization primitive (P-AUTH-05B-2B.1 pattern); a retry with the same
-- key returns the ORIGINAL row unchanged. accepted_at always comes from
-- the database's own now() default — never a caller-supplied time.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_user_consent(
  p_user_id uuid,
  p_consent_scope text,
  p_source text,
  p_terms_version text,
  p_privacy_version text,
  p_terms_content_sha256 text,
  p_privacy_content_sha256 text,
  p_correlation_id text,
  p_idempotency_key text
)
RETURNS TABLE (
  out_id uuid,
  out_consent_scope text,
  out_terms_version text,
  out_privacy_version text,
  out_accepted_at timestamptz,
  out_was_existing boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required';
  END IF;

  IF p_consent_scope NOT IN ('account_upgrade', 'checkout', 'digital_content_waiver') THEN
    RAISE EXCEPTION 'consent scope not allowed';
  END IF;

  IF p_source NOT IN ('subscription_page', 'account_upgrade_form') THEN
    RAISE EXCEPTION 'consent source not allowed';
  END IF;

  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 OR char_length(p_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'idempotency key invalid';
  END IF;

  INSERT INTO public.user_consents (
    user_id,
    consent_scope,
    terms_version,
    privacy_version,
    terms_content_sha256,
    privacy_content_sha256,
    source,
    correlation_id,
    idempotency_key
  )
  VALUES (
    p_user_id,
    p_consent_scope,
    p_terms_version,
    p_privacy_version,
    p_terms_content_sha256,
    p_privacy_content_sha256,
    p_source,
    p_correlation_id,
    p_idempotency_key
  )
  ON CONFLICT (user_id, consent_scope, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;

  RETURN QUERY
  SELECT
    uc.id,
    uc.consent_scope,
    uc.terms_version,
    uc.privacy_version,
    uc.accepted_at,
    (v_inserted_id IS NULL) AS was_existing
  FROM public.user_consents AS uc
  WHERE uc.user_id = p_user_id
    AND uc.consent_scope = p_consent_scope
    AND uc.idempotency_key = p_idempotency_key;
END;
$$;

REVOKE ALL ON FUNCTION public.record_user_consent(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_user_consent(uuid, text, text, text, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.record_user_consent(uuid, text, text, text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_consent(uuid, text, text, text, text, text, text, text, text) TO service_role;
