# P2-AI-03 Release Scope Review

**方法**：唯讀（`git status`、`supabase db query --linked` 唯讀 SELECT）。**未修改任何檔案、未 commit、未 push、未執行 migration、未 deploy、未修改遠端資料。**

---

## 1 + 2. Release Scope（已分類的檔案清單）

### 🟦 P2-AI-02（Prompt 架構基礎，Shopkeeper 依賴此層）

```
js/services/prompt/wallpaper-prompt-builder.js  (+ .ts + 2 個 test)
js/services/prompt/prompt-validator.js          (+ .ts + test)
js/services/prompt/prompt-snapshot.js           (+ .ts + test)
js/services/wallpaper/mascot-repository.js      (+ .ts + test)
js/services/wallpaper/gift-repository.js        (+ .ts + test)
```

**狀態**：全部 `??`（untracked，從未 commit）。

### 🟩 P2-AI-03（Shopkeeper Context Agent 及其串接）

```
js/services/shopkeeper/shopkeeper-context-agent.js       (+ .ts + test)
js/services/shopkeeper/shopkeeper-context-validator.js   (+ .ts + test)
js/services/shopkeeper/shopkeeper-fallback-context.js    (+ .ts + test)
js/services/ai/gemini-text-provider.js                   (+ .ts + test)
js/services/prompt/prompt-context-resolver.js            (+ .ts + test)   ← P2-AI-02 建立，P2-AI-03 改了 contract
js/services/prompt/fallback-templates.js                 (M, + .ts + test)
js/services/wallpaper/generation-service.js               (M + .ts)
js/services/wallpaper/generation-repository.js            (M + .ts)
js/services/wallpaper/__tests__/generation-service.test.js (M)
js/services/wallpaper/__tests__/generation-repository.test.js (M)
js/services/wallpaper/__tests__/provider-resilience-integration.test.js (M)
supabase/functions/_shared/wallpaper-generate-handler.js  (M + .ts)
supabase/functions/_shared/gemini-client.ts               (M)
supabase/functions/wallpaper-generate/index.ts            (M)
supabase/functions/_shared/__tests__/wallpaper-generate-handler-resilience-wiring.test.js (M)
.env.example                                              (M，新增 SHOPKEEPER_* 變數)
```

### 🟨 測試／Migration（跨切面）

```
supabase/migrations/20260727000000_seed_daily_lucky_context_prompt.sql   (新增)
scripts/verify-local.ps1                                                 (M)
```

### ⬜ 無關修改（文件/報告/spec，不影響部署範圍——部署只會推 `supabase/functions/**` 程式碼與 `supabase/migrations/**`）

```
docs/acceptance/**, docs/development/reviews/**, docs/development/workflows/**,
docs/development/reports/**, docs/product/P2-AI-roadmap.md,
docs/working-prompts/**（prompts-P2-AI-01~06 系列全部）,
review/**（含本次與先前的 Gate Review 報告本身）,
specs/001-p1-ai-lucky-wallpaper/, specs/001-ai-lucky-wallpaper/（刪除, 已被前者取代）,
specs/002-p2-ai-prompt-builder/,
.playwright-mcp/（Playwright 測試截圖/紀錄）,
.vscode/mcp.json（編輯器設定）
```

### ❓ 無法判定

**無**——本次盤點所有檔案皆可明確歸類。

---

## 3. P2-AI-03 是否依賴尚未部署的 P2-AI-02？

**是，且是強依賴，無法拆分。** `generation-service.js` 直接 `require`／`import`：`wallpaper-prompt-builder.js`、`prompt-validator.js`、`prompt-snapshot.js`、`mascot-repository.js`、`gift-repository.js`（皆為 P2-AI-02 產物）。這些檔案 `git status` 顯示皆為 `??`（從未 commit），代表遠端 Edge Function 目前執行的版本**連 P2-AI-02 都沒有**。

## 4. 是否必須將 P2-AI-02、P2-AI-03 一起部署？

**必須。** 若只部署 P2-AI-03 新增檔案而不含 P2-AI-02 的模組，Edge Function 在 Deno 啟動時的靜態 import 就會直接找不到模組而失敗（不是執行期錯誤，是根本無法啟動）。這兩個階段目前在程式碼庫中已經是**同一個不可分割的部署單元**。

---

## 5. 遠端 Prompt Registry 狀態（唯讀查詢，`prompt_versions` where `prompt_type = 'daily_lucky_context'`）

```sql
SELECT version, is_active, created_at,
       (template ILIKE '%luckyTheme%')        AS has_luckyTheme,
       (template ILIKE '%blessing%')          AS has_blessing,
       (template ILIKE '%story%')             AS has_story,
       (template ILIKE '%oneLiner%')          AS has_oneLiner,
       (template ILIKE '%shopkeeperMessage%') AS has_shopkeeperMessage,
       (template ILIKE '%version%')           AS has_version_field,
       length(template) AS template_length
FROM public.prompt_versions
WHERE prompt_type = 'daily_lucky_context';
```

**結果：`rows: []` — 遠端目前完全沒有任何 `daily_lucky_context` 的資料列（無論 active 與否）。**

未輸出任何完整 prompt 內容或 secrets，僅使用布林欄位檢查 schema 存在性（本次因為 0 rows，連布林欄位都無實際資料可回報）。

這與先前 Gate Review 的判斷一致：**目前部署（若真的執行）會處於「Scenario A：完全沒有資料」的最安全起始狀態。**

---

## 6. Migration 行為矩陣（4 種情境）

| 情境 | 我的 migration（`WHERE NOT EXISTS (...is_active=TRUE...)` + `ON CONFLICT DO NOTHING`）的行為 | 結果 |
|---|---|---|
| **A. 遠端完全沒有資料**（✅ 目前實際狀態） | `NOT EXISTS` 為真 → 執行 INSERT | 新增 1 筆正確 schema 的 active row，`version = shopkeeper-context-v1` |
| **B. 遠端已有「正確」的 active row** | `NOT EXISTS` 為假（因為已有 active row）→ **跳過 INSERT** | No-op，保留既有正確資料不變（不會產生第二筆 active row） |
| **C. 遠端已有「錯誤」的 active row**（例如 schema 仍是 snake_case） | `NOT EXISTS` 只檢查 `is_active = TRUE`，**不檢查內容正確性** → 判斷為「已有 active row」→ **跳過 INSERT** | ⚠️ **No-op，但保留的是錯誤資料**——migration 本身不會自動修復錯誤的 active row，需要人工介入 |
| **D. 遠端已有多筆 active row**（資料庫已處於損壞狀態） | 同樣判斷為「已有 active row」→ **跳過 INSERT**；但此損壞狀態**與我的 migration 完全無關**，`prompt-registry-loader.js` 本來就會在此情境下拋出 `MULTIPLE_ACTIVE_PROMPTS` | migration 不會讓情況變得更糟，但也不會修復——這是既有的資料完整性問題，需獨立處理 |

**重點**：情境 C、D 需要人工預先確認（一次性 `SELECT` 檢查即可，如本報告第 5 節做的查詢），而不能單靠這個 migration 自動修復——這是刻意的保守設計（migration 不應該在未經人工確認下，自動覆蓋/停用一筆可能是有意義的既有 active 資料）。**目前查詢結果確認遠端是情境 A，因此本次可以安全直接執行。**

---

## 7. 正式部署是否需要分別執行 `db push` 與 `functions deploy`？

**是，兩者是完全獨立的部署動作，缺一不可：**

- `supabase db push`：套用 `supabase/migrations/**`（含新的 `20260727000000_seed_daily_lucky_context_prompt.sql`）到遠端 Postgres。
- `supabase functions deploy wallpaper-generate`：上傳 `supabase/functions/**`（P2-AI-02 + P2-AI-03 全部程式碼）到 Edge Runtime。

兩者互不觸發彼此——**執行其中一個不會自動執行另一個**。

---

## 8. 建議的安全部署順序（依賴正確、可回復）

1. **部署前再次確認**：重跑本報告第 5 節的唯讀查詢，確認遠端仍是「Scenario A（空）」——若已被其他人變更為 B/C/D，先手動處理再繼續。
2. `supabase db push`（先套用 migration，讓 active prompt row 先於程式碼就緒；即使順序顛倒也不會出錯，因為 `prompt-registry-loader.js` 在查無 row 時會安全退回 code-level fallback，不會中斷服務）。
3. 部署後立即重跑第 5 節查詢，確認**剛好新增 1 筆** `daily_lucky_context` active row，且 `version = shopkeeper-context-v1`。
4. `supabase functions deploy wallpaper-generate`（同時帶出 P2-AI-02 + P2-AI-03，因兩者不可分割部署）。
5. 觸發一次真實生成請求，確認 `source` 為 `"ai"`（而非因未知原因落到 fallback）。
6. **回復方案（若部署後發現問題）**：
   - **Function 回復**：透過 Supabase Dashboard 的 Edge Function 版本歷史回滾到部署前版本（CLI 本身不保留自動快照，因為程式碼從未 commit，git 也無法作為回復依據）。
   - **Migration 回復**：執行 `UPDATE public.prompt_versions SET is_active = FALSE WHERE prompt_type = 'daily_lucky_context' AND version = 'shopkeeper-context-v1';`（停用而非刪除，保留稽核軌跡），讓系統退回 code-level fallback 模板。

---

## 部署前阻擋項

| # | 項目 | 狀態 |
|---|---|---|
| 1 | 遠端 `daily_lucky_context` 資料狀態 | ✅ 已確認為 Scenario A（空），可安全部署 |
| 2 | P2-AI-02/03 依賴完整性 | ✅ 確認必須一起部署，已列入建議步驟 |
| 3 | Migration 冪等性 | ✅ 已於 Gate Review 驗證 |
| 4 | 本機測試 | ✅ 207/207（上次 Gate Review 已確認） |
| 5 | 尚無實際部署阻擋項 | 目前沒有發現會阻止部署的技術性問題 |

---

## Release Gate：🟢 PASS

範圍明確（P2-AI-02 + P2-AI-03 為單一不可分割部署單元）、遠端 Prompt Registry 狀態確認為最安全的空白起始狀態、migration 行為矩陣證明可安全重複執行、部署步驟具備明確順序與回復方案。**無阻擋項。**

**完成，停止於此，等待確認。未修改、未 commit、未 push、未執行 migration、未 deploy。**
