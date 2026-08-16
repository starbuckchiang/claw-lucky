---
applyTo: "supabase/migrations/**/*.sql"
description: "Rules for Supabase migrations and RLS SQL"
---

# Supabase Migration Rules

- Create a new migration; never rewrite an applied migration.
- Keep RLS enabled.
- Never fix access errors by disabling RLS.
- Use `auth.uid()` for ownership.
- Define explicit policies by operation.
- Avoid destructive schema changes.
- Use existing naming conventions.
- Include rollback and verification notes.
- Test access using at least two different users.