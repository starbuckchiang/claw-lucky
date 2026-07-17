# AI Coding Rules

## Never

- Never modify unrelated files.
- Never implement requirements not approved in Specification.
- Never skip RLS.
- Never hardcode prompts.
- Never expose service role keys.
- Never bypass Provider Adapter.

## Always

- Keep PR small.
- Follow Tasks.md.
- Write migration separately.
- Use Prompt Registry.
- Preserve backward compatibility.
- Add tests.

## Module System

本專案目前採用 CommonJS。

Production Code：
- 使用 require()
- 使用 module.exports

若需建立獨立測試腳本，可使用 .mjs 與 ES Module。

不得在既有 .js 檔案混用 import 與 module.exports。