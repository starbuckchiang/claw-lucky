-- WEB-HOME-01B.1 local-only dependency for the consent audit foreign key.
-- Supabase normally owns this table; the isolated PostgreSQL harness needs
-- only the identity column used by public.user_consents.

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON auth.users TO authenticated;
GRANT ALL ON auth.users TO service_role;
