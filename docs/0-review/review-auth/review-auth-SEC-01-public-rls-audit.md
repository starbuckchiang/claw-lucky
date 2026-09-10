# review-auth-SEC-01-public-rls-audit

Auth-SEC-01：Supabase public tables RLS 緊急**唯讀**稽核。

觸發：Supabase Security Advisor — severity **CRITICAL**、lint `rls_disabled_in_public`、linked Sandbox project。
Auth-07C.8 已暫停。本稽核**只讀 catalog／grants／policies／migration 檔**；未讀取任何資料列、未做任何修改。

```text
Gate: PASS（稽核完成；異常已定位，未修復 — 修復屬後續 Gate）
```

```text
Code Changed: NO
Database Changed: NO
Deployment Performed: NO
Commit/Push Performed: NO
Data Rows Read: NO
```

---

## 1. 稽核方法（全部唯讀）

| 來源 | 查詢 |
|---|---|
| `pg_class` / `pg_namespace` / `pg_policies` | 31 張 public 一般資料表的 `relrowsecurity`、`relforcerowsecurity`、policy 數 |
| `information_schema.role_table_grants` | anon / authenticated / service_role 的 table-level grants |
| `pg_policies` | 每表 policy cmd 與 roles 彙總 |
| `supabase/migrations/**` grep | `ENABLE ROW LEVEL SECURITY`、`CREATE TABLE`、REVOKE/GRANT 溯源 |
| `js/**`、`supabase/functions/**` grep | 異常表的實際程式使用面（僅檔名／呼叫點，未執行） |

未執行任何 `SELECT` 於一般資料表、未按 Resolve、未 ALTER／REVOKE／GRANT、未 db push、未部署。

---

## 2. 全表清單（31 張）

**關鍵背景**：本專案所有 public 表都保留 Supabase 預設 table-level grants —
`anon`、`authenticated`、`service_role` 對**每一張表**都有
`SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,TRUNCATE`。
亦即 **RLS 是唯一實際防線**；RLS disabled = 該表對 anon key 完全開放讀寫。

| Table | RLS | Policies | Policy roles/cmds 摘要 | RLS/建表 migration 來源 |
|---|---|---|---|---|
| account_merge_claims | ✅ | 1 | authenticated ALL(deny 形) | 20260816000200 |
| account_merge_requests | ✅ | 1 | authenticated ALL | 20260816000400 |
| **cart_items** | ✅ | **0** | —（enabled 無 policy＝anon/authenticated 全拒） | **無 migration 來源**（Dashboard 建；程式碼零引用） |
| coin_transactions | ✅ | 4 | authenticated R/W 各項 | 20260817000000 |
| daily_generation_usage | ✅ | 4 | authenticated | 20260712122000 |
| gacha_draw_requests | ✅ | 2 | authenticated | 20260817000200 |
| **generation_cost_config** | ❌ **DISABLED** | **0** | — | 建表 20260712040000；**任何 migration 皆未 ENABLE RLS** |
| gift_redemption_requests | ✅ | 2 | authenticated | 20260817000300 |
| gifts | ✅ | 1 | anon+authenticated SELECT（公開目錄，合理） | RLS 來源不可溯（Dashboard；無 CREATE TABLE migration） |
| logs | ✅ | 2 | authenticated INSERT/SELECT | 不可溯（Dashboard） |
| lucky_wallpapers | ✅ | 3 | authenticated | 不可溯（Dashboard） |
| mascot_rarities | ✅ | 2 | authenticated | 20260817000200 |
| mascots | ✅ | 2 | anon+authenticated SELECT（公開目錄，合理） | 不可溯（Dashboard） |
| order_items | ✅ | 6 | anon/authenticated（deny write＋owner read 形） | 20260816000000 |
| orders | ✅ | 7 | 同上 | 20260816000000 |
| payment_orders | ✅ | 3 | anon/authenticated | 20260821000200 |
| payment_webhook_events | ✅ | 2 | anon/authenticated ALL(deny 形) | 20260821000200 |
| paypal_subscription_transactions | ✅ | 5 | anon/authenticated | **20260907000100（07C — RLS 已正確 ENABLE）** |
| paypal_subscriptions | ✅ | 5 | anon/authenticated | **20260907000100（07C — RLS 已正確 ENABLE）** |
| point_transactions | ✅ | 4 | authenticated | 20260816000100 |
| **prompt_versions** | ❌ **DISABLED** | **0** | — | 建表 20260712040100；**任何 migration 皆未 ENABLE RLS** |
| redeem_history | ✅ | 7 | anon/authenticated | 20260816000000 |
| shop_cart | ✅ | 8 | authenticated | 20260816000000 |
| shop_checkout_requests | ✅ | 2 | authenticated | 20260817000400 |
| shop_products | ✅ | 1 | anon+authenticated SELECT（公開商品目錄，合理） | 不可溯（Dashboard） |
| ticket_transactions | ✅ | 4 | authenticated | 20260817000000 |
| user_mascots | ✅ | 8 | authenticated | 20260816000000 |
| user_subscription_slots | ✅ | 5 | anon/authenticated | **20260907000100（07C — RLS 已正確 ENABLE）** |
| users | ✅ | 7 | authenticated | 20260816000000 |
| wallpaper_generation_jobs | ✅ | 4 | authenticated | 20260712122000 |
| wallpaper_generations | ✅ | 4 | authenticated | 20260712122000 |

`relforcerowsecurity` = false（全表）；正常 — service_role／owner 需 bypass。

---

## 3. 異常清單

### 3.1 RLS disabled 且 anon／authenticated 有權限（CRITICAL — Advisor 命中）

| Table | 實際暴露 | 影響 |
|---|---|---|
| `generation_cost_config` | anon key 可 **SELECT／INSERT／UPDATE／DELETE** | 任何人可改壁紙生成扣點成本（如改 0＝免費生成、或改天價）；讀取僅內部定價配置（無 PII） |
| `prompt_versions` | anon key 可 **SELECT／INSERT／UPDATE／DELETE** | 任何人可**竄改 active prompt template** → 對 AI 生成管線做 prompt injection／內容污染；也可刪除 registry 使生成失敗；讀取為內部 prompt 資產（無 PII） |

兩表皆僅由 `wallpaper-generate` Edge Function（service_role client）經
`js/services/wallpaper/points-repository.js`（`costConfigTable = "generation_cost_config"`）與
`js/services/prompt/prompt-registry-loader.js`（`tableName = "prompt_versions"`）讀取；
**瀏覽器端程式碼零引用** → 前端完全不需要直接存取。

### 3.2 RLS enabled 但 0 policy

| Table | 效果 | 判定 |
|---|---|---|
| `cart_items` | anon／authenticated 全拒（RLS enabled＋無 policy＝deny-all）；service_role 照常 bypass | 非暴露；疑為 Dashboard 建立的 legacy 表，`js/**`／`supabase/functions/**` 零引用（App 用的是 `shop_cart`） |

### 3.3 敏感類別表狀態（payment／subscription／wallet／user／webhook／gift／gacha／order）

| 類別 | 表 | 狀態 |
|---|---|---|
| payment | payment_orders、payment_webhook_events | ✅ RLS＋policies（20260821000200） |
| subscription | paypal_subscriptions、paypal_subscription_transactions、user_subscription_slots | ✅ RLS＋policies（20260907000100） |
| wallet | point_transactions、coin_transactions、ticket_transactions | ✅ RLS＋policies |
| user | users、user_mascots | ✅ RLS＋policies |
| webhook | payment_webhook_events | ✅ RLS＋policies |
| gift | gifts（公開讀 only）、gift_redemption_requests、redeem_history | ✅ RLS＋policies |
| gacha | gacha_draw_requests、mascot_rarities | ✅ RLS＋policies |
| order | orders、order_items、shop_cart、shop_checkout_requests | ✅ RLS＋policies |

**→ 付款／訂閱／錢包／用戶資料未因本次 lint 暴露。**

---

## 4. 異常表預期存取模型

| Table | 模型 | 依據 |
|---|---|---|
| `generation_cost_config` | **SERVER_ONLY** | 僅 Edge Function（service_role）讀；前端零引用；寫入僅應由管理端／migration |
| `prompt_versions` | **SERVER_ONLY** | 僅 Edge Function（service_role）讀；seed 由 migration `20260727000000` 寫入 |
| `cart_items` | **UNKNOWN**（legacy，程式碼零引用；不猜測 policy） | 建議後續 Gate 先確認是否可下線，而非補 policy |

依指示，UNKNOWN 不自行設計 policy。

---

## 5. Migration 溯源結論

1. **根因 migration**：`20260712040000_create_wallpaper_core_tables.sql`（建 `generation_cost_config`）與
   `20260712040100_create_prompt_versions.sql`（建 `prompt_versions`）皆**不含**任何
   `ENABLE ROW LEVEL SECURITY`／`REVOKE`／`GRANT` 語句。
2. 後續的 wallpaper RLS migration `20260712122000_rls_wallpaper_core.sql` 只涵蓋
   `wallpaper_generations`／`wallpaper_generation_jobs`／`daily_generation_usage` 三表，
   **漏掉同批建立的兩張 config 表** — 此即 Advisor CRITICAL 的直接來源，存在於 2026-07-12 起的每一次部署。
3. **Auth-07C subscription migrations 無遺漏**：`20260907000100_paypal_subscriptions_rpc.sql`
   L229–231 對三張新表全部 `ENABLE ROW LEVEL SECURITY` 且已有 policies（live catalog 證實）——
   本次告警**與 07C 無關**。
4. 所有表都保留 Supabase 預設 anon/authenticated 全權限 grants（本 repo 從未做過 grants 收斂）；
   在 RLS enabled 的表上此為 Supabase 常態（RLS 擋住），但這使「忘記 ENABLE RLS」的失誤代價極大 —
   建議後續修復 Gate 一併考慮對 SERVER_ONLY 表做 grants 收斂（本階段未執行）。

---

## 6. 建議後續（本階段未執行）

1. 新 migration：對兩表 `ENABLE ROW LEVEL SECURITY`（無 policy＝deny-all；service_role 不受影響），
   可另加 REVOKE anon/authenticated 收斂 — 需走正常「本機 shape test → 授權後 db push」流程。
2. `cart_items`：先確認 legacy 用途再決定下線或補 policy。
3. 修復完成前，`prompt_versions`／`generation_cost_config` 的內容完整性建議於修復 Gate 中以唯讀方式
   核對是否已遭未授權竄改（本稽核未讀資料列，無法斷言）。

---

## Auth-SEC-01 Result

```text
Auth-SEC-01 Result:
Public Tables Checked: 31
RLS Disabled Tables: 2 (generation_cost_config, prompt_versions)
Critical Tables: generation_cost_config (anon full R/W), prompt_versions (anon full R/W)
Anon Writable Tables: generation_cost_config, prompt_versions
Authenticated Writable Tables: generation_cost_config, prompt_versions (其餘皆受 RLS policy 限制)
Affected Migration: 20260712040000_create_wallpaper_core_tables.sql / 20260712040100_create_prompt_versions.sql（建表未 ENABLE RLS）；20260712122000_rls_wallpaper_core.sql（RLS 補課漏掉此兩表）
Payment/Subscription Data Exposed: NO
Immediate Data Mutation Required: NO
Code Changed: NO
Database Changed: NO
Deployment Performed: NO
Recommended Access Model Per Table: generation_cost_config=SERVER_ONLY; prompt_versions=SERVER_ONLY; cart_items=UNKNOWN (legacy, RLS enabled + 0 policy = deny-all, 非本次暴露)
Gate: PASS
```

完成後停止；未修復（修復屬後續 Gate）。
