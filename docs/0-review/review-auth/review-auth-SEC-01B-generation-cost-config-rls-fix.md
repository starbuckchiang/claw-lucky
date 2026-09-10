# review-auth-SEC-01B-generation-cost-config-rls-fix

Auth-SEC-01B：`public.generation_cost_config` SERVER_ONLY RLS Hotfix。

前置：

- `docs/0-review/review-auth/review-auth-SEC-01-public-rls-audit.md`
- `docs/0-review/review-auth/review-auth-SEC-01A-prompt-versions-rls-fix.md`

```text
Gate: PASS
```

```text
Migration Applied: YES (20260910000200, user-approved db push)
Data Mutated: NO
Functions Deployed: NONE
Secrets Changed: NO
Commit/Push: NO
Sensitive Config Content Output: NO (counts/booleans/hash prefix only)
```

---

## 1. 唯讀 Preflight

| 檢查 | 結果 |
|---|---|
| Live RLS | **disabled**；FORCE off；policies 0 |
| anon/authenticated grants | 完整（Supabase 預設全開） |
| service_role grants | 7 privileges |
| 程式引用 | 僅 `js/services/wallpaper/points-repository.js` 與 `_shared/lib/points-repository.ts` 的 `getActiveGenerationCost()`（`costConfigTable="generation_cost_config"`），由 `wallpaper-generate` service_role client 呼叫 |
| 瀏覽器前端直接引用 | **零**（`*.html`／`js/pages/**` 無） |
| 建表 migration | `20260712040000_create_wallpaper_core_tables.sql`（無 RLS 語句） |
| Seed migration | **不存在**（repo 從未 seed 此表；`points-service.js` 設計上以 `defaultGenerationCost = 10` fallback） |
| prompt_versions 修復仍有效 | RLS on、grants NONE、seed row md5/updated_at 不變 |
| Pending migration | 僅 `20260910000200`（list＋`db push --dry-run` 皆確認） |

## 2. 完整性檢查 — **MATCH**

| 項目 | 值 | 判定 |
|---|---|---|
| row count | **0** | 與權威來源一致（無 seed migration；程式以 code default 10 fallback 為設計行為） |
| expected config keys | n/a（空表） | **MATCH** |
| duplicate key count | 0 | PASS |
| active config count | 0 | PASS（`uq_generation_cost_config_single_active` 約束下 0 或 1 皆合法） |
| cost values vs 規格 | n/a（空表；權威 cost=10 由 code default 提供） | **MATCH** |
| created_at／updated_at 異常 | 無資料列，無異常 | PASS |
| canonical SHA-256 前 8 碼 | `cc1d2f83`（EMPTY-state canonical） | 基準已記錄 |

**→ 暴露期間（2026-07-12 起）無任何未授權寫入證據**（無列即無插入／竄改）。未修改任何資料。

## 3. Migration

`supabase/migrations/20260910000200_generation_cost_config_server_only_rls.sql`：

```sql
ALTER TABLE public.generation_cost_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.generation_cost_config FROM anon, authenticated;
```

零 policy（deny-all）、無 `USING (true)`／`WITH CHECK (true)`、無 FORCE RLS、
不碰資料／表結構、不修改已套用 migration、冪等可重跑。

## 4. 測試

新增 `supabase/migrations/__tests__/generation-cost-config-server-only-rls-shape.test.js`（7 tests，
含 prompt_versions 修復檔不退步、原建表 migration 維持無 RLS 的迴歸鎖），沿用 SEC-01A 的
「先剝離 `--` 註解行再做負向斷言」模式。

```text
generation-cost-config-server-only-rls-shape.test.js: 7 pass / 0 fail
scripts/verify-local.ps1（含 auth/payment/subscription 全套）: 868 pass / 0 fail
```

註：本環境無本機 Postgres／Docker harness，`supabase db reset`／`supabase test db` 不可用
（repo 既定事實）；`verify-local.ps1` 為本專案實際標準驗證入口。

## 5. 部署 Gate

本機 Gate PASS 後停止並通知；取得使用者明確批准（"yes"）後執行 `supabase db push` —
CLI 確認清單僅列 `20260910000200` 一檔，套用成功。

## 6. 遠端驗證（唯讀）

| 檢查 | 結果 |
|---|---|
| `generation_cost_config` RLS | **ON**（FORCE off，如設計） |
| policies | **0** |
| anon/authenticated grants | **NONE** |
| service_role grants | **7（intact）**；`pg_roles.rolbypassrls = true` → Edge Function 讀取不受影響 |
| anon Data API GET | **HTTP 401 / 42501 permission denied** |
| anon Data API POST | **HTTP 401 / 42501** |
| anon Data API PATCH | **HTTP 401 / 42501** |
| anon Data API DELETE | **HTTP 401 / 42501** |
| wallpaper-generate smoke | **STRUCTURAL PASS**（service_role bypass＋grants intact＋空表 fallback 行為由 868 測試覆蓋；未執行真實 HTTP 生成 — 需真實 user session 且會消耗真實生成） |
| prompt_versions 迴歸 | **PASS**（RLS on、grants NONE、anon GET 401/42501） |
| row count 修復後 | 仍 **0**（零資料變動） |
| public schema RLS-disabled 一般資料表 | **0 張** → `rls_disabled_in_public` 告警條件已於資料庫層清除（Dashboard Advisor 清單可能需重新掃描／刷新才反映） |

## 7. 後續

- Auth-07C.8（PayPal 取消訂閱 E2E）**可恢復執行**。
- 非緊急遺留：`cart_items` legacy 表處置、全專案預設 grants 收斂（SEC-01 §6）。
- 本次新增檔案（migration＋test＋本文件）未 commit — 未獲 commit/push 授權。

---

## Auth-SEC-01B Result

```text
Auth-SEC-01B Result:
Table: public.generation_cost_config
Access Model: SERVER_ONLY
Integrity Check: MATCH (0 rows = authoritative state; no seed migration exists; code default fallback by design)
Unauthorized Mutation Evidence: NO
Migration: 20260910000200_generation_cost_config_server_only_rls.sql
RLS Enabled: YES
Policies: 0
Anon Grants: NONE
Authenticated Grants: NONE
Service-role Access: INTACT (7 privileges + rolbypassrls)
Client Deny Tests: PASS (GET/POST/PATCH/DELETE all 401/42501)
Wallpaper Generate Smoke: STRUCTURAL PASS (service_role bypass verified; no real HTTP generation executed)
Prompt Versions Regression: PASS (RLS on, grants NONE, anon GET denied)
Full Tests: 868 pass / 0 fail (verify-local)
Migration Applied: YES (single pending, user-approved)
Security Advisor Cleared: YES at database level (0 RLS-disabled public tables; Dashboard may need rescan)
Data Mutated: NO
Functions Deployed: NONE
Secrets Changed: NO
Commit/Push: NO
Auth-07C.8 Safe To Resume: YES
Gate: PASS
```
