-- P2-AI-03 Gate Review fix: seed a single active `daily_lucky_context`
-- Prompt Registry row so the Shopkeeper Context Agent's real Gemini calls
-- are driven by a schema-correct, DB-sourced prompt (not silently falling
-- back to the code-level fallback template on every request just because
-- no active row exists — `prompt-registry-loader.js` returns the fallback
-- ONLY when `fetchActivePromptsByType()` finds zero rows).
--
-- Schema MUST match `shopkeeper-context-validator.js`'s
-- `validateShopkeeperContext()` exactly: camelCase luckyTheme/blessing/
-- story/oneLiner/shopkeeperMessage/version, all non-empty strings.
-- `version` is a FIXED literal the model echoes back verbatim (AI
-- Constitution Principle 6 — version/schema metadata is system-known, not
-- AI-guessed).
--
-- Idempotent / safe to re-run:
--   1. Skips entirely if ANY active row already exists for this
--      prompt_type (avoids ever creating a second active row, which would
--      make the loader throw MULTIPLE_ACTIVE_PROMPTS).
--   2. `ON CONFLICT (prompt_type, version) DO NOTHING` as a second,
--      belt-and-suspenders guard against the exact same (prompt_type,
--      version) pair being inserted twice.
-- Does NOT alter the `prompt_versions` table shape, RLS, or any other
-- Prompt Registry infrastructure — no second registry is created.

INSERT INTO public.prompt_versions (
    prompt_type,
    version,
    template,
    is_active,
    metadata_json,
    created_by
)
SELECT
    'daily_lucky_context',
    'shopkeeper-context-v1',
    $tpl$你是「幸運雜貨店」的老闆娘，請為今天生成一份專屬的幸運內容。

規則：
1. 只能輸出一個合法的 JSON 物件，不得包含任何 Markdown 標記（例如 ```json 或 ```），不得包含 JSON 以外的任何說明文字。
2. JSON 物件必須完整包含下列 6 個欄位，欄位名稱必須完全一致（camelCase）：
   - luckyTheme：今天的幸運主題（繁體中文，非空字串）
   - blessing：給使用者的祝福語（繁體中文，非空字串）
   - story：今天的幸運小故事（繁體中文，非空字串）
   - oneLiner：一句話祝福（繁體中文，非空字串）
   - shopkeeperMessage：老闆娘想說的話（繁體中文，非空字串）
   - version：固定填入字串 "shopkeeper-context-v1"（非空字串，不需要自行產生）
3. 除了 version 之外，所有欄位內容都必須以繁體中文撰寫，且不得為空字串。
4. 吉祥物：{{mascotSpecies}}（{{mascotTitle}}）。禮物：{{giftName}}。請讓內容自然融入吉祥物與禮物的特色。

請直接輸出 JSON，不要有任何其他文字。$tpl$,
    TRUE,
    '{"seed": true, "safetyLevel": "strict", "source": "P2-AI-03 gate-review fix"}'::jsonb,
    NULL
WHERE NOT EXISTS (
    SELECT 1
      FROM public.prompt_versions
     WHERE prompt_type = 'daily_lucky_context'
       AND is_active = TRUE
)
ON CONFLICT (prompt_type, version) DO NOTHING;
