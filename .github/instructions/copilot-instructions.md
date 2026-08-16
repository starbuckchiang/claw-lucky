# Claw Lucky repository instructions

## Project scope
- Frontend: vanilla HTML, CSS, JavaScript.
- Backend: Supabase database, storage, auth, and Edge Functions.
- Do not introduce React, Vue, TypeScript migration, or new frameworks unless explicitly requested.

## Change policy
- Make the smallest change necessary.
- Do not modify unrelated files.
- Do not modify database schema unless the task explicitly requires it.
- Preserve existing APIs and localStorage keys.
- Never commit API keys, generated images, node_modules, or .env files.

## Verification
- Run `.\scripts\verify-local.ps1`.
- Existing tests must remain green.
- Report changed files, commands run, results, and unresolved risks.

## Workflow
- Read the current task document first.
- Read only directly referenced architecture, ADR, spec, and review files.
- Do not scan the whole repository unless the task cannot be completed otherwise.