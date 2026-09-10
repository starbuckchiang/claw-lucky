# review-auth-SEC-01A-prompt-versions-rls-fix

Auth-SEC-01A：`public.prompt_versions` RLS 緊急修復（SERVER_ONLY）。

前置：`docs/0-review/review-auth/review-auth-SEC-01-public-rls-audit.md`
（Advisor CRITICAL `rls_disabled_in_public`；本 Gate 修復其中 `prompt_versions`；
`generation_cost_config` 為同根因的另一表，**本 Gate 未處理**，留待後續指示。）

```text
Gate: PASS
```

```text
Migration Applied: YES (20260910000100, user-confirmed db push)
Code Changed: NO (only new migration + new shape test)
Data Mutated: NO
Function Deployed: NO
Secrets Changed: NO
Commit/Push Performed: NO
Prompt Content Read/Output: NO (metadata + md5 hash only)
```

---

## 1. 開始前唯讀鑑識

### 1.1 建表 migration

`supabase/migrations/20260712040100_create_prompt_versions.sql` —
**不含任何** `ENABLE ROW LEVEL SECURITY`／`REVOKE`／`GRANT`。
後續 RLS 補課 migration `20260712122000_rls_wallpaper_core.sql` 只涵蓋
`wallpaper_generations`／`wallpaper_generation_jobs`／`daily_generation_usage`，漏掉本表。

### 1.2 全部引用面（repo-wide grep）

| 引用 | 類型 | Client |
|---|---|---|
| `supabase/functions/wallpaper-generate/index.ts` → `createServiceClient` → `_shared/lib/prompt-registry-loader.ts`（`tableName = "prompt_versions"`） | Edge Function 讀取 | **service_role** |
| `js/services/prompt/prompt-registry-loader.js` | Node 測試用 CJS twin（不在瀏覽器頁面載入） | n/a |
| `supabase/migrations/20260727000000_seed_daily_lucky_context_prompt.sql` | 種子寫入 | migration |
| 測試檔（`prompt-registry-loader.test.js`、`wallpaper-generate-handler-resilience-wiring.test.js`） | fake client | n/a |

**瀏覽器前端 anon/authenticated client 直接查詢：無**（`*.html` 與 `js/pages/**` 皆零引用）。

### 1.3 修復前狀態（live，唯讀）

| 項目 | 值 |
|---|---|
| RLS enabled | **false** |
| FORCE RLS | false |
| policies | 0 |
| anon grants | SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE（Supabase 預設全開） |
| authenticated grants | 同上 |
| service_role grants | 同上 |

→ anon key 可完全讀寫。未讀取／輸出任何 prompt 內容。

### 1.4 模型判定

**SERVER_ONLY** — 唯一 runtime 讀者是 service_role Edge Function；寫入只來自 migration。
無任何前端直接讀取需求證據；未建立任何 `using (true)` 公開 policy。

---

## 2. Migration（新檔，未改已套用舊 migration）

`supabase/migrations/20260910000100_prompt_versions_server_only_rls.sql`：

```sql
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.prompt_versions FROM anon, authenticated;
```

- RLS enabled＋**零 policy** = anon/authenticated deny-all；service_role bypass RLS，Edge Function 不受影響。
- REVOKE = 縱深防禦：未來即使誤加寬鬆 policy，兩角色也無 table privilege。
- 冪等可重跑；不碰資料、不碰表結構；無 FORCE RLS；rollback／驗證步驟寫在檔頭。

## 3. 測試

新增 `supabase/migrations/__tests__/prompt-versions-server-only-rls-shape.test.js`（7 tests）：
ENABLE RLS 存在、REVOKE 存在、無 CREATE POLICY、無 `USING (true)`、無 DISABLE/GRANT/FORCE 語句、
不碰表結構／資料、原建表 migration 維持無 RLS（防止有人回頭改已套用檔案）。

初版有 2 個 false positive：檔頭註解引用了 `"using (true)"` 與 rollback 的 `DISABLE ROW LEVEL SECURITY`
字樣，命中全文 regex —— 修正為先剝離 `--` 註解行再斷言（與 repo 既有「header comment 引用自身模式」
教訓一致）。

```text
prompt-versions-server-only-rls-shape.test.js: 7 pass / 0 fail
scripts/verify-local.ps1: 861 pass / 0 fail
```

## 4. 部署（使用者明確授權後執行）

- `supabase migration list`：`20260910000100` 為**唯一** pending。
- `supabase db push` 確認清單只列該檔 → 使用者親自回覆 `Y` → 套用成功。

## 5. 修復後驗證（live，唯讀）

| 項目 | 修復前 | 修復後 |
|---|---|---|
| `relrowsecurity` | false | **true** |
| policies | 0 | 0（deny-all，符合 SERVER_ONLY） |
| anon/authenticated grants | 全開（14 筆） | **NONE（0 筆）** |
| service_role grants | 7 | **7（不變，Edge Function 不受影響）** |
| FORCE RLS | false | false（刻意不變） |

### 竄改完整性檢查（metadata only，未讀 prompt 內容）

| 項目 | 值 |
|---|---|
| Row count | **1**（僅 `20260727000000` 種子列） |
| prompt_type / version | `daily_lucky_context` / `shopkeeper-context-v1` |
| is_active | true |
| created_at == updated_at | **YES**（2026-07-27；`set_updated_at` trigger 會在任何 UPDATE 時改 updated_at） |
| template md5 / length | `4fef6dbc…` / 536（僅 hash，未輸出內容） |

→ **暴露期間（2026-07-12 起）無任何未授權寫入痕跡**：無新增列、無刪除、無更新。

## 6. 遺留事項（本 Gate 未處理）

1. **`generation_cost_config`**：同根因、同 CRITICAL 暴露（SEC-01 已判定 SERVER_ONLY），
   建議下一個 Gate 用同一模式修復（新 migration：ENABLE RLS + REVOKE）。
2. `cart_items`（RLS enabled、0 policy、零程式引用的 legacy 表）：確認下線或補 policy。
3. 全專案 anon/authenticated 預設 grants 收斂（非緊急；RLS enabled 的表已被 policy 擋住）。
4. Auth-07C.8（取消訂閱 E2E）可恢復執行。

---

## Auth-SEC-01A Result

```text
Auth-SEC-01A Result:
Table: public.prompt_versions
Access Model: SERVER_ONLY
Creating Migration: 20260712040100 (no RLS; gap confirmed)
Frontend Direct Access Found: NO
Fix Migration: 20260910000100_prompt_versions_server_only_rls.sql
RLS Enabled After: YES
Policies After: 0 (deny-all by design)
Anon/Authenticated Grants After: NONE
Service Role Grants After: intact (7)
Tampering During Exposure: NONE DETECTED (1 seed row; created_at == updated_at; no extra rows)
Prompt Content Read/Output: NO
Shape Tests: 7 pass / verify-local 861 pass / 0 fail
db push: YES (single migration; user-confirmed)
Code Changed: NO
Function Deployment: NONE
Secrets Changed: NO
Commit/Push: NO
Remaining Sibling Issue: generation_cost_config (same root cause, NOT fixed in this gate)
Gate: PASS
```
