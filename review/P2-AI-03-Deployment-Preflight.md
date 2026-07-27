# P2-AI-02 + P2-AI-03 Deployment Preflight

**方法**：全程唯讀。**未修改任何應用程式檔案、未 stage、未 commit、未 push、未 db push、未 deploy。**（過程中曾建立一個暫時性的 import-graph 診斷腳本供分析用，分析後已刪除，確認未留下任何新檔案。）

---

## 1. 測試結果

`.\scripts\verify-local.ps1` → **207/207 通過**，exit code 0。與上次 Gate Review 一致，無新增失敗。

---

## 2. `supabase migration list` + `db push --dry-run`

```json
{"migrations":[
  {"local":"20260712040000","remote":"20260712040000", ...},
  {"local":"20260712040100","remote":"20260712040100", ...},
  {"local":"20260712122000","remote":"20260712122000", ...},
  {"local":"20260712122100","remote":"20260712122100", ...},
  {"local":"20260716010000","remote":"20260716010000", ...},
  {"local":"20260727000000","remote":"", ...}
]}
```

```
DRY RUN: migrations will *not* be pushed to the database.
Would push these migrations:
 • 20260727000000_seed_daily_lucky_context_prompt.sql
```

## 3. Pending Migration 清單

**只有 1 筆待套用 migration，且正是預期的那一筆：**

| Migration | 狀態 |
|---|---|
| `20260727000000_seed_daily_lucky_context_prompt.sql` | ✅ Pending（預期中，唯一一筆） |

前 5 筆（`20260712040000` ~ `20260716010000`）皆為 local/remote 一致（已套用）。**無其他非預期的 pending migration，未發現 BLOCKED 項目。**

---

## 4. Deno Import Graph 分析（從 `wallpaper-generate/index.ts` 靜態追蹤）

- **本地 `.ts` 檔案，全部成功解析：43 個**（含所有 P2-AI-02/03 必要模組：`shopkeeper-context-agent.ts`、`shopkeeper-context-validator.ts`、`shopkeeper-fallback-context.ts`、`gemini-text-provider.ts`、`prompt-context-resolver.ts`、`prompt-validator.ts`、`prompt-snapshot.ts`、`wallpaper-prompt-builder.ts`、`mascot-repository.ts`、`gift-repository.ts`、`generation-service.ts`、`generation-repository.ts`、`fallback-templates.ts`、`wallpaper-generate-handler.ts` 等）
- **外部 specifier（由 Edge Runtime 自行解析，非本地檔案）：** `npm:@google/genai@^1.0.0`、`npm:@supabase/supabase-js@2`
- **未解析（unresolved）的 import：0 筆**
- 額外確認：對所有 `.ts` 檔案做全文搜尋，**沒有任何一個 `.ts` 檔案 import 了 `.js` 檔案**（避免誤用 Node-only CommonJS 檔案）

**結論：Import graph 完整、無斷鏈、無本機才有但部署不會包含的檔案。**

---

## 5. Release Commit 檔案清單（建議納入）

### P2-AI-02（Prompt 架構基礎）

```
js/services/prompt/wallpaper-prompt-builder.js
js/services/prompt/prompt-validator.js
js/services/prompt/prompt-snapshot.js
js/services/prompt/__tests__/wallpaper-prompt-builder.test.js
js/services/prompt/__tests__/wallpaper-prompt-builder.gate3.test.js
js/services/prompt/__tests__/prompt-validator.test.js
js/services/prompt/__tests__/prompt-snapshot.test.js
js/services/wallpaper/mascot-repository.js
js/services/wallpaper/gift-repository.js
js/services/wallpaper/__tests__/mascot-repository.test.js
js/services/wallpaper/__tests__/gift-repository.test.js
supabase/functions/_shared/lib/wallpaper-prompt-builder.ts
supabase/functions/_shared/lib/prompt-validator.ts
supabase/functions/_shared/lib/prompt-snapshot.ts
supabase/functions/_shared/lib/mascot-repository.ts
supabase/functions/_shared/lib/gift-repository.ts
```

### P2-AI-03（Shopkeeper Context Agent）

```
js/services/shopkeeper/shopkeeper-context-agent.js
js/services/shopkeeper/shopkeeper-context-validator.js
js/services/shopkeeper/shopkeeper-fallback-context.js
js/services/shopkeeper/__tests__/shopkeeper-context-agent.test.js
js/services/shopkeeper/__tests__/shopkeeper-context-validator.test.js
js/services/shopkeeper/__tests__/shopkeeper-fallback-context.test.js
js/services/ai/gemini-text-provider.js
js/services/ai/__tests__/gemini-text-provider.test.js
js/services/prompt/prompt-context-resolver.js
js/services/prompt/__tests__/prompt-context-resolver.test.js
js/services/prompt/fallback-templates.js
js/services/prompt/__tests__/fallback-templates.test.js
js/services/wallpaper/generation-service.js
js/services/wallpaper/generation-repository.js
js/services/wallpaper/__tests__/generation-service.test.js
js/services/wallpaper/__tests__/generation-repository.test.js
js/services/wallpaper/__tests__/provider-resilience-integration.test.js
supabase/functions/_shared/lib/shopkeeper-context-agent.ts
supabase/functions/_shared/lib/shopkeeper-context-validator.ts
supabase/functions/_shared/lib/shopkeeper-fallback-context.ts
supabase/functions/_shared/lib/gemini-text-provider.ts
supabase/functions/_shared/lib/prompt-context-resolver.ts
supabase/functions/_shared/lib/fallback-templates.ts
supabase/functions/_shared/lib/generation-service.ts
supabase/functions/_shared/lib/generation-repository.ts
supabase/functions/_shared/wallpaper-generate-handler.js
supabase/functions/_shared/wallpaper-generate-handler.ts
supabase/functions/_shared/gemini-client.ts
supabase/functions/wallpaper-generate/index.ts
supabase/functions/_shared/__tests__/wallpaper-generate-handler-resilience-wiring.test.js
```

### 必要 Migration

```
supabase/migrations/20260727000000_seed_daily_lucky_context_prompt.sql
```

### 基礎設施

```
scripts/verify-local.ps1
.env.example
```

### 對應必要 Gate Review 文件（本次審查鏈直接產出的稽核紀錄）

```
review/P2-AI-03-佈署前檢查.md
review/P2-AI-03-GateReview.md
review/P2-AI-03-ReleaseScopeReview.md
review/P2-AI-03-architecture.svg
review/P2-AI-03-localhost5500整合現況檢查.md
docs/acceptance/P2-AI-03-acceptance.md
```

> ⚠️ 注意：`docs/acceptance/P2-AI-03-acceptance.md` 內部引用了 `P2-AI-03-acceptance-screenshots/` 的截圖連結，但依第 6 節指示「測試截圖」明確排除，因此**該文件提交後會有失效的圖片連結**——是否要一併放行截圖，請你確認。

---

## 6. 明確排除清單

| 類別 | 項目 |
|---|---|
| 編輯器/工具設定 | `.vscode/mcp.json` |
| Playwright 產物 | `.playwright-mcp/**` |
| 測試截圖 | `docs/development/reviews/P2-AI-03-acceptance-screenshots/**` |
| 無關文件 | `docs/development/reports/**`、`docs/development/workflows/*.md`、`docs/product/P2-AI-roadmap.md`、`docs/proposals/**`、`docs/acceptance/P2-AI-02-acceptance.md`、`review/P2-AI-06-review.md`、`docs/development/reviews/P2-AI-01-*.md`、`docs/development/reviews/P2-AI-02-*.md`、`docs/working-prompts/**`（全部 prompts-* 工作紀錄檔，含本次 `prompts-P2-AI-03-6.md`） |
| 無關 spec 刪除/新增 | `specs/001-ai-lucky-wallpaper/**`（刪除）、`specs/001-p1-ai-lucky-wallpaper/**`、`specs/002-p2-ai-prompt-builder/**` |
| 本次會話另一項無關任務的產物 | `docs/working-prompts/無人店面.pptx`、`無人店面.backup.pptx`、`無人店面死角牆面動態螢幕合成圖.png`、`scripts/beautify_pptx*.py` |
| secrets／API Key | 無發現任何 `.env`、金鑰或 secrets 被寫入任何檔案（已逐檔確認） |
| 其他無法確認用途的修改 | `docs/development/reviews/P2-AI-03.md`（M，內容與 `review/P2-AI-03-GateReview.md` 重疊，用途不明確）、已刪除的 `docs/development/reviews/P2-AI-01.md`／`P2-AI-02.md`／`docs/development/workflows/ai-layer-worklow.md`（拼字錯誤版本，已被 `ai-layer-workflow.md` 取代）／`docs/working-prompts/prompts-P2-AI-02.md` 等（刪除原因不明） |

---

## 7. JS／Deno TS Twin 完整性檢查

逐一核對第 5 節清單中**每一組**應該成對存在的 `.js`/`.ts`：

| Node `.js`（測試基準） | Deno `.ts`（部署版本） | 狀態 |
|---|---|---|
| `prompt/wallpaper-prompt-builder.js` | `lib/wallpaper-prompt-builder.ts` | ✅ |
| `prompt/prompt-validator.js` | `lib/prompt-validator.ts` | ✅ |
| `prompt/prompt-snapshot.js` | `lib/prompt-snapshot.ts` | ✅ |
| `prompt/prompt-context-resolver.js` | `lib/prompt-context-resolver.ts` | ✅ |
| `prompt/fallback-templates.js` | `lib/fallback-templates.ts` | ✅ |
| `wallpaper/mascot-repository.js` | `lib/mascot-repository.ts` | ✅ |
| `wallpaper/gift-repository.js` | `lib/gift-repository.ts` | ✅ |
| `wallpaper/generation-service.js` | `lib/generation-service.ts` | ✅ |
| `wallpaper/generation-repository.js` | `lib/generation-repository.ts` | ✅ |
| `shopkeeper/shopkeeper-context-agent.js` | `lib/shopkeeper-context-agent.ts` | ✅ |
| `shopkeeper/shopkeeper-context-validator.js` | `lib/shopkeeper-context-validator.ts` | ✅ |
| `shopkeeper/shopkeeper-fallback-context.js` | `lib/shopkeeper-fallback-context.ts` | ✅ |
| `ai/gemini-text-provider.js` | `lib/gemini-text-provider.ts` | ✅ |
| `_shared/wallpaper-generate-handler.js` | `_shared/wallpaper-generate-handler.ts` | ✅ |

**14 組全部成對存在，沒有任何一側缺漏。**（`index.ts`、`gemini-client.ts` 屬於 Deno-only 的入口/client 建構檔，依既有慣例本來就沒有 `.js` 對應版本，非缺漏。）

---

## 8. 部署前本機 Commit 建議（僅供參考，未執行）

### 建議 commit message

```
P2-AI-02 + P2-AI-03: Prompt Builder architecture + Shopkeeper Context Agent

- P2-AI-02: Prompt Context Resolver / Validator / Wallpaper Prompt Builder /
  Prompt Snapshot + mascot/gift repositories
- P2-AI-03: Shopkeeper Context Agent (AI-generated daily Lucky Context with
  deterministic fallback), Gemini Text Provider, corrected daily_lucky_context
  fallback template schema, seed migration for the Prompt Registry active row
- 207/207 tests passing (verify-local.ps1)
```

### 建議 `git add`（精確路徑，逐一列出，不使用萬用字元避免誤帶入排除項目）

```powershell
git add `
  js/services/prompt/wallpaper-prompt-builder.js `
  js/services/prompt/prompt-validator.js `
  js/services/prompt/prompt-snapshot.js `
  js/services/prompt/prompt-context-resolver.js `
  js/services/prompt/fallback-templates.js `
  js/services/prompt/__tests__/wallpaper-prompt-builder.test.js `
  js/services/prompt/__tests__/wallpaper-prompt-builder.gate3.test.js `
  js/services/prompt/__tests__/prompt-validator.test.js `
  js/services/prompt/__tests__/prompt-snapshot.test.js `
  js/services/prompt/__tests__/prompt-context-resolver.test.js `
  js/services/prompt/__tests__/fallback-templates.test.js `
  js/services/wallpaper/mascot-repository.js `
  js/services/wallpaper/gift-repository.js `
  js/services/wallpaper/generation-service.js `
  js/services/wallpaper/generation-repository.js `
  js/services/wallpaper/__tests__/mascot-repository.test.js `
  js/services/wallpaper/__tests__/gift-repository.test.js `
  js/services/wallpaper/__tests__/generation-service.test.js `
  js/services/wallpaper/__tests__/generation-repository.test.js `
  js/services/wallpaper/__tests__/provider-resilience-integration.test.js `
  js/services/shopkeeper/ `
  js/services/ai/gemini-text-provider.js `
  js/services/ai/__tests__/gemini-text-provider.test.js `
  supabase/functions/_shared/lib/wallpaper-prompt-builder.ts `
  supabase/functions/_shared/lib/prompt-validator.ts `
  supabase/functions/_shared/lib/prompt-snapshot.ts `
  supabase/functions/_shared/lib/mascot-repository.ts `
  supabase/functions/_shared/lib/gift-repository.ts `
  supabase/functions/_shared/lib/shopkeeper-context-agent.ts `
  supabase/functions/_shared/lib/shopkeeper-context-validator.ts `
  supabase/functions/_shared/lib/shopkeeper-fallback-context.ts `
  supabase/functions/_shared/lib/gemini-text-provider.ts `
  supabase/functions/_shared/lib/prompt-context-resolver.ts `
  supabase/functions/_shared/lib/fallback-templates.ts `
  supabase/functions/_shared/lib/generation-service.ts `
  supabase/functions/_shared/lib/generation-repository.ts `
  supabase/functions/_shared/wallpaper-generate-handler.js `
  supabase/functions/_shared/wallpaper-generate-handler.ts `
  supabase/functions/_shared/gemini-client.ts `
  supabase/functions/wallpaper-generate/index.ts `
  supabase/functions/_shared/__tests__/wallpaper-generate-handler-resilience-wiring.test.js `
  supabase/migrations/20260727000000_seed_daily_lucky_context_prompt.sql `
  scripts/verify-local.ps1 `
  .env.example `
  review/P2-AI-03-佈署前檢查.md `
  review/P2-AI-03-GateReview.md `
  review/P2-AI-03-ReleaseScopeReview.md `
  review/P2-AI-03-architecture.svg `
  "review/P2-AI-03-localhost5500整合現況檢查.md" `
  docs/acceptance/P2-AI-03-acceptance.md
```

### Commit 後驗證指令（僅供參考，未執行）

```powershell
git status --porcelain=v1          # 確認排除清單中的項目仍是 untracked/unstaged
git show --stat HEAD               # 檢查這次 commit 實際包含的檔案清單
.\scripts\verify-local.ps1         # 對已 commit 的狀態再跑一次，確保沒有漏帶檔案
git log -1 --name-status           # 逐檔確認 A/M 狀態符合預期
```

---

## 最終結論

| 檢查項目 | 結果 |
|---|---|
| 測試 | ✅ 207/207 |
| Pending Migration | ✅ 僅 1 筆，符合預期 |
| db push dry-run | ✅ 僅套用預期的 seed migration |
| Deno import graph | ✅ 43 個本地檔案全部解析成功，0 unresolved |
| JS/TS twin 完整性 | ✅ 14 組全部成對存在 |
| Secrets 檢查 | ✅ 無外洩 |

## Deployment Preflight：🟢 PASS

無阻擋項目。唯一需要你確認的是第 5 節提到的「`docs/acceptance/P2-AI-03-acceptance.md` 引用的截圖是否一併放行」這個小決策點，其餘可依第 8 節建議的 commit 範圍直接進行。

**完成，停止於此，等待你的確認。未 stage、未 commit、未 push、未 db push、未 deploy。**
