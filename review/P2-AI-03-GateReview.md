# P2-AI-03 Gate Review 問題修正 — 完成報告

已閱讀 AI Constitution、工作規格、Gate Review 報告與現有 Prompt Registry/測試架構。本次允許修改程式碼與測試，**未 deploy、未 commit、未 push**。

---

## 一、修改檔案清單

| 檔案 | 類型 |
|---|---|
| [js/services/prompt/fallback-templates.js](../js/services/prompt/fallback-templates.js) | 修改（`daily_lucky_context` 模板內容） |
| [supabase/functions/_shared/lib/fallback-templates.ts](../supabase/functions/_shared/lib/fallback-templates.ts) | 修改（同步 Deno twin） |
| [supabase/migrations/20260727000000_seed_daily_lucky_context_prompt.sql](../supabase/migrations/20260727000000_seed_daily_lucky_context_prompt.sql) | **新增**（idempotent 種子 migration） |
| [js/services/prompt/__tests__/fallback-templates.test.js](../js/services/prompt/__tests__/fallback-templates.test.js) | **新增**（真實模板 contract test） |
| [js/services/shopkeeper/__tests__/shopkeeper-context-agent.test.js](../js/services/shopkeeper/__tests__/shopkeeper-context-agent.test.js) | 修改（+2 Same Mascot DTO 測試） |
| [js/services/wallpaper/__tests__/generation-service.test.js](../js/services/wallpaper/__tests__/generation-service.test.js) | 修改（+2 Snapshot Persist 測試） |
| [js/services/wallpaper/__tests__/generation-repository.test.js](../js/services/wallpaper/__tests__/generation-repository.test.js) | 修改（+1 metadata_json Persist 測試） |
| [scripts/verify-local.ps1](../scripts/verify-local.ps1) | 修改（新增 `fallback-templates.js` 的 `node --check`） |

`git status` 確認**沒有任何 UI / `wallpaper.html` / `js/pages/wallpaper.js` 或 Wallpaper Prompt Builder / Prompt Validator 內容**出現在本次改動中。

---

## 二、問題根因

`daily_lucky_context` 的 fallback 模板（部署環境唯一會用到的版本，因為 DB 從未有對應的 active seed row）要求 AI 輸出 **snake_case** 欄位（`lucky_theme`/`one_liner`），**完全沒提到 `story`/`version`**。而 `validateShopkeeperContext()` 檢查的是 **camelCase** 的 `luckyTheme/blessing/story/version`。兩者 schema 不一致，導致即使 Gemini API 呼叫全部成功，AI 回傳的 JSON 也必定驗證失敗 → **每次都靜默退回 Fallback**，AI 生成 Lucky Theme 功能形同虛設，且 196 個既有測試因為都用手刻的正確 schema mock，完全偵測不到這個缺陷。

---

## 三、修正內容

**1. 模板內容修正**（`fallback-templates.js` + `.ts` twin）：新模板明確要求：
- 只能輸出合法 JSON，禁止 Markdown code fence 與額外說明文字
- camelCase 欄位：`luckyTheme`/`blessing`/`story`/`oneLiner`/`shopkeeperMessage`/`version`
- 除 `version` 外皆須為非空繁體中文字串
- **`version` 改為固定字面值 `"shopkeeper-context-v1"`**——依 AI Constitution Principle 6（Deterministic Before AI），version/schema 屬於系統已知資訊，不應由 AI 自行猜測，因此模板直接要求 AI 原樣照抄這個固定字串，而非讓 AI 自創版本號

**2. Prompt Registry 種子資料**：確認 `supabase/migrations/` 中**從未有** `daily_lucky_context` 的 active row（`prompt-registry-loader.js` 的邏輯是「DB 查無 row → 直接退回 code-level fallback」）。新增 [20260727000000_seed_daily_lucky_context_prompt.sql](../supabase/migrations/20260727000000_seed_daily_lucky_context_prompt.sql)：
- 模板內容與修正後的 `fallback-templates.js` 完全一致
- `version = "shopkeeper-context-v1"`
- **雙重保險確保 idempotent**：`WHERE NOT EXISTS (... is_active = TRUE ...)` 防止建立第二筆 active row（會讓 loader 拋出 `MULTIPLE_ACTIVE_PROMPTS`），外加 `ON CONFLICT (prompt_type, version) DO NOTHING` 防止完全重複的 row
- 未改動 `prompt_versions` 表結構、RLS 或建立任何第二套 Registry

---

## 四、8/8 測試覆蓋證據

| # | 規格要求 | 覆蓋測試 | 檔案 |
|---|---|---|---|
| 1 | JSON Parse Success | `JSON Parse Success -> returns AI-sourced context` | `shopkeeper-context-agent.test.js`（既有） |
| 2 | Missing Story → Fallback | `Missing Story -> Fallback` | 同上（既有） |
| 3 | Missing Blessing → Fallback | `Missing Blessing -> Fallback` | 同上（既有） |
| 4 | AI Timeout → Fallback | `AI Timeout -> Fallback` | 同上（既有） |
| 5 | Provider Failure → Fallback | `Provider Failure -> Fallback` | 同上（既有） |
| 6 | Same Mascot DTO → 一致結構 | `Same Mascot DTO -> every call produces a consistently-shaped ShopkeeperContext (AI source)` + `... Fallback source is ALSO consistently shaped ...` | 同上（**新增**） |
| 7 | Snapshot Persist | `Snapshot Persist -> createGenerationRecord payload includes shopkeeperSnapshot/shopkeeperVersion/source` + `... Fallback source is persisted too` | `generation-service.test.js`（**新增**） |
| 8 | metadata_json 包含 shopkeeperSnapshot | `metadata_json includes shopkeeperSnapshot/shopkeeperVersion/source without overwriting promptSnapshot/contextVersion/builderVersion` | `generation-repository.test.js`（**新增**） |

**8/8 已全數覆蓋**。另外新增 6 個「真實模板 contract test」（`fallback-templates.test.js`），直接載入真正的 `fallback-templates.js`（非 mock），驗證欄位齊全、禁止 snake_case 回歸、要求 JSON/繁中，並用**真正的** `validateShopkeeperContext()` 證明「照著模板指示產生的 JSON 會通過驗證」——這正是防止本次缺陷再次發生的關鍵測試。

---

## 五、完整測試結果

`.\scripts\verify-local.ps1` → **207/207 通過**，exit code 0（原本 196 + 本次新增 11 個測試）。Syntax Check 全數通過，無 UI/wallpaper.html/Wallpaper Prompt Builder/Prompt Validator 相關檔案被修改。未發現 API Key / secrets 寫入任何檔案。

---

## 六、Migration 安全性

- ✅ 可重複執行：`WHERE NOT EXISTS` + `ON CONFLICT DO NOTHING` 雙重防護，多次執行不會產生重複資料或 `MULTIPLE_ACTIVE_PROMPTS` 衝突
- ✅ 未修改任何既有表結構、RLS 或建立新表/新 Registry
- ✅ `created_by` 使用 `NULL`（欄位無 `NOT NULL` 限制，經確認允許）

---

## Gate 結論：🟢 PASS

原 Gate Review 的「阻擋級」缺陷（模板 schema 不符）與 3 項缺失測試已全部修正並驗證。

## 部署後仍需手動驗證項目（沿用原 Gate Review 第 7 節，未改變）

1. 部署後觸發一次真實生成，確認 `source` 真的是 `"ai"`（而非因為其他未預期原因仍落到 fallback）。
2. 查詢實際寫入的 `wallpaper_generations.metadata_json`，確認 `shopkeeperSnapshot`/`shopkeeperVersion`/`source` 落地且格式正確。
3. 確認 migration 在遠端執行後，`prompt_versions` 真的只有一筆 `daily_lucky_context` 的 active row。
4. 真實 timeout/rate-limit 情境確認 Fallback 觸發、不阻擋生成。
5. `correlationId` 全程一致性（真實 Edge Function Logs）。
6. 一組已登入、擁有吉祥物+Gift 的測試帳號完整跑一次 UI 流程（需注意 Cloudflare Turnstile 對自動化的干擾）。
7. 明確設定 `SHOPKEEPER_MODEL`/`SHOPKEEPER_TIMEOUT_MS`/`SHOPKEEPER_MAX_RETRY` 三個 secrets（非必要，但建議）。
8. 確認此次部署範圍是否有意包含尚未提交的 P2-AI-02 架構（`js/services/prompt/**`）。

**完成，停止於此，等待 Product Review。未 deploy、未 commit、未 push。**
