# review-WEB-HOME-01B.1A — Legacy Migration Baseline Audit

日期：2026-09-11
分支：`release/auth-07c-sandbox`
狀態：**BLOCKED_SCHEMA_SOURCE — DESIGN ONLY**

---

## 一、結論

Repository migration chain 不是可從空白 Supabase 重建的完整 schema 歷史。它假設九個 legacy public tables 已存在，但 repository 中沒有建立這些 tables 的 migration：`users`、`mascots`、`gifts`、`user_mascots`、`redeem_history`、`shop_products`、`shop_cart`、`orders`、`order_items`。

在全新 local Supabase database 執行 migration chain 時，第一個失敗檔案為 `20260712040000_create_wallpaper_core_tables.sql`。該 migration 的前置檢查找不到 `public.users` 的單欄 primary key，拋出 PostgreSQL `P0001`；同一段邏輯也要求 `public.mascots` 與 `public.gifts` 的單欄 primary key。這是 migration provenance 缺口，不是 WEB-HOME consent migration 的錯誤。

目前不可安全建立正式 baseline migration。`scripts/auth-07c7e1-local-pg/00-bootstrap.sql` 足以作為 local compatibility harness，但不能證明 production 的完整欄位、type、default、constraint、index、trigger、RLS、policy、grant 與 ownership。已知 production evidence 也與 bootstrap 有差異，例如 production `users` 以獨立 `id` 為 primary key、`user_id` 為 unique identity；bootstrap 則以 `user_id TEXT PRIMARY KEY` 定義。直接複製 bootstrap 或猜測 production shape，會把 schema drift 固化成新 migration。

因此本階段只保留 audit harness 並產出設計報告：不建立 baseline migration、不修改既有 migration、不存取 remote。推薦的最終方案是取得可信且經 review 的 schema-only provenance 後採用 `OPTION_A_FORMAL_BASELINE`；在來源完成前 Gate 為 `BLOCKED_SCHEMA_SOURCE`。

## 二、重現與分析方法

所有執行均使用 disposable `postgres:16-alpine`，只綁定 `127.0.0.1:55435`。`scripts/web-home-01b1a-baseline-audit/run.ps1` 以 repository 既有 bootstrap 建立 control，然後逐一移除 legacy table、依檔名順序套用全部 migrations，記錄第一個 apply-time failure。每個 case 完成後刪除 container。

另以全新 local Supabase 重現真正的 blank-database path。第一個錯誤為：

```text
Migration: 20260712040000_create_wallpaper_core_tables.sql
SQLSTATE: P0001 (raise_exception)
Missing prerequisite: public.users single-column primary key
Same prerequisite block also requires: public.mascots, public.gifts
```

Omission matrix 結果：

| 移除項目 | 第一個 apply-time failure | 判讀 |
|---|---|---|
| none (bootstrap control) | none | 現有 test bootstrap 可套用 chain |
| `public.users` | `20260712040000_create_wallpaper_core_tables.sql` | immediate dependency |
| `public.mascots` | `20260712040000_create_wallpaper_core_tables.sql` | immediate dependency |
| `public.gifts` | `20260712040000_create_wallpaper_core_tables.sql` | immediate dependency |
| `public.user_mascots` | `20260817000200_gacha_draw_secure_rpc.sql` | composite return type requires table |
| `public.redeem_history` | none | deferred inside PL/pgSQL; gift redeem runtime requires it |
| `public.shop_products` | none | guarded/deferred; cart and checkout runtime require it |
| `public.shop_cart` | `20260817000400_shop_cart_checkout_secure_rpc.sql` | composite return type requires table |
| `public.orders` | `20260817000400_shop_cart_checkout_secure_rpc.sql` | composite return type requires table |
| `public.order_items` | none | deferred inside PL/pgSQL; checkout/order reads require it |

`none` 不代表 object 可省略。PostgreSQL 不會在 `CREATE FUNCTION` 時完整驗證所有 PL/pgSQL statement，而部分 migrations 也以 `to_regclass(...)` guard 跳過不存在的 legacy table；因此 migration command 可完成，但第一次執行相關 RPC 或 UI query 才失敗。Clean rebuild 的判準必須包含 application-required schema，不可只看 migration process exit code。

## 三、Legacy Object 缺口清單

以下 `Contains Seed Data` 指 `00-bootstrap.sql` 本身；它只建立 schema，沒有 public application rows。所有 production rows 均不得複製。

| Object | Type | Referenced By | Creating Migration Exists | Required For Clean Rebuild | Contains Seed Data | Production Data Must Not Be Copied |
|---|---|---|---|---|---|---|
| `public.users` | table | wallpaper core/prompt FK discovery; wallet ledgers; ensure-user; gacha/gift RPCs; consent-adjacent app identity and balances | NO | YES | NO | YES |
| `public.mascots` | catalog table | wallpaper context; gacha selection and reward RPCs; collection UI | NO | YES | NO | YES |
| `public.gifts` | catalog table | wallpaper context; gift catalog and redemption RPCs | NO | YES | NO | YES |
| `public.user_mascots` | ownership/join table | RLS; account merge; gacha RPC return/upsert; shop unlock checks; collection UI | NO | YES | NO | YES |
| `public.redeem_history` | transaction/history table | RLS; account merge; gift redemption RPC; gift history UI | NO | YES | NO | YES |
| `public.shop_products` | catalog/inventory table | cart/checkout RPCs; product and shop UI | NO | YES | NO | YES |
| `public.shop_cart` | cart table | RLS; account merge; shop RPCs; cart UI | NO | YES | NO | YES |
| `public.orders` | order table | RLS; checkout RPCs; order confirmation/history UI | NO | YES | NO | YES |
| `public.order_items` | order line table | RLS; checkout RPC; order confirmation/history UI | NO | YES | NO | YES |
| `public.logs` | dangling legacy table name | `js/api.js` and `js/temp/api_0.js` constants only; no active `.from(DB.logs)` call found | NO | NO | NO | YES |

後續 migrations 會建立 feature-owned objects，例如 wallpaper tables、ledger/request tables、subscription tables、consent table 與其 functions/policies；這些不是缺失的 legacy baseline objects。PayPal Edge Functions 使用的 `payment_orders`、`payment_webhook_events`、`paypal_subscriptions` 也都有 repository migration，不屬於本缺口。

## 四、Bootstrap 分類

### A. 正式 schema 必要定義候選

九個 public legacy table 的存在是正式 schema 必要條件：`users`、`mascots`、`gifts`、`user_mascots`、`redeem_history`、`shop_products`、`shop_cart`、`orders`、`order_items`。`orders` 的 order-number generation function/trigger 也是實際 checkout contract 的必要候選。

這裡的「候選」只表示 object 必須存在，不表示 bootstrap 中的具體 DDL 已被證明正確。

### B. 測試專用 stub

- local `anon`、`authenticated`、`service_role` roles
- `auth` schema 與以 request GUC 模擬 JWT 的 `auth.uid()`
- 最小化 `storage.buckets`、`storage.objects` tables 與 storage grants
- local default privileges 和 broad harness grants

正式 Supabase environment 已提供這些 platform objects；不得由 legacy application baseline 重建。

### C. Production-shape 相容定義

Bootstrap 中九個 public table、`generate_order_no()` 與 `trigger_set_order_no` 是為了讓 local tests 接近既有 production contract 的 compatibility definitions。它們可供測試，但不是 authoritative schema：

- 無完整 production index、RLS/policy、grant、ownership provenance。
- 多處使用 `CREATE TABLE IF NOT EXISTS`，會掩蓋不相符的既有 schema。
- `users` identity/PK shape 與已知 production shape 不一致。
- 多個真實 type 只從歷史 production runtime evidence 得知，例如 balance `bigint`、部分 shop IDs 為 UUID、`redeem_history.id` 為 `bigint`；bootstrap 不能單獨證明完整 catalog。
- `generate_order_no()` 是簡化的 harness implementation，不能取代已知 production 使用 advisory lock 與 Asia/Taipei sequence contract 的 authoritative definition。

### D. Seed／fixture 資料

`00-bootstrap.sql` 沒有 application seed rows。`scripts/auth-07c7e1-local-pg/10-seed-legacy.sql` 與 `20-seed-subscription.sql` 包含 local test users、orders、webhook/subscription fixtures；它們完全排除於正式 baseline。Catalog rows、使用者 rows、交易 rows、order rows、subscription rows 及任何 production rows 都不得 dump 或複製進 repository migration。

### E. 不應進正式 migration 的內容

- `dblink` extension：omission harness/test utility，不是 application schema requirement。
- local role creation、BYPASSRLS role attributes、test grants/default privileges。
- auth/storage stubs。
- `public.supabase_migrations_local` local harness tracker。
- bootstrap 的 `CREATE ... IF NOT EXISTS` drift-masking pattern。
- 簡化的 order-number function/trigger，除非由 authoritative source 證明完全一致。
- 任何 fixture insert、credential、JWT、Email、user identifier 或 production data。

`pgcrypto` 可能由正式 migrations 使用，但 Supabase platform extension availability 應由 baseline precondition 或獨立正式 migration 明確管理；不可因 bootstrap 同時建立它，就把整份 bootstrap 視為 authoritative。

## 五、方案比較

| 方案 | 空白 DB 完整重建 | 既有 production 安全性 | CI／新 Sandbox 重現 | 判定 |
|---|---|---|---|---|
| `OPTION_A_FORMAL_BASELINE` | YES，前提是完整 schema-only DDL 已證明 | 可設計為只建立缺失 schema；production rollout 必須先做 exact-shape preflight，不能用 `IF NOT EXISTS` 掩蓋 drift | YES | **推薦的最終方案；目前被 schema source 阻擋** |
| `OPTION_B_SANDBOX_SCHEMA_CLONE` | NO；clone 可提供既有 schema，但未修復 blank migration chain | schema-only isolated branch/clone 不複製 rows 時風險較低 | 僅能驗證 clone-based upgrade，不證明 blank rebuild | 可作 interim runtime verification，不是 baseline 解法 |
| `OPTION_C_PRODUCTION_BASELINE_MARKING` | NO；只改 migration history 不會建立 blank DB 所缺 tables | 只有在 production schema 與 baseline exact match 且經人工批准時才可能安全 | NO，除非另有真正 baseline | 不推薦作主要解法；本階段不得 repair/mark |

### 推薦實施順序

1. 從可信來源取得 schema-only provenance：原始建表 SQL、受控 schema-only export，或由 DBA review 的 catalog capture。只擷取 metadata，不擷取 rows、identity values 或 credentials。
2. 對九個 tables 與 order-number dependencies 建立逐項 manifest：column/order/type/nullability/default、PK/unique/FK/check、index、trigger/function、RLS/policy、grant/owner、extension dependency。
3. 將 manifest 與 production schema、既有 migration expectations、runtime call sites 三方比對；任何差異先決策，不猜測。
4. 新增一個 forward-only formal baseline migration，排序在第一個依賴 legacy schema 的 migration 之前；不修改任何已存在 migration，不含 data，不使用 `CREATE TABLE IF NOT EXISTS`。
5. 對已存在 schema 的 deployment path，使用會驗證 exact shape 並在 mismatch 時明確失敗的 preflight/transition strategy。不要以 no-op DDL 或 migration repair 假裝一致。
6. 在 disposable blank Supabase 連續重建兩次，驗證 catalog fingerprint 一致、無 temporary bootstrap，然後執行 consent runtime harness 與完整 regression suite。
7. Production migration history marking 如仍有需要，必須是獨立、人工批准的後續操作；它不能替代 blank rebuild proof。

## 六、正式 Baseline 建立判定

本次沒有建立 migration 草案，原因是缺少可證明完整且正確的 schema source。已知 table 名稱、部分欄位及歷史 runtime observations 不足以證明所有 constraints、indexes、RLS、policies、grants 與 triggers。依任務限制，不能猜測 production schema，也不能把 test bootstrap 升格為 production DDL。

解除 `BLOCKED_SCHEMA_SOURCE` 至少需要：

- 九個 legacy tables 的 reviewed authoritative schema-only definition。
- order-number functions/triggers 的 authoritative definition。
- catalog/transaction seed ownership決策；schema migration 必須保持零 rows。
- production exact-shape comparison strategy 與 mismatch fail-closed 規則。
- blank rebuild、second rebuild、無 bootstrap、consent runtime、完整 regression 的 executable acceptance plan。

## 七、本機驗證結果

- Blank local Supabase migration chain：**FAIL**，first failure `20260712040000_create_wallpaper_core_tables.sql` / `P0001`。
- Bootstrap control migration chain：**PASS**。
- Per-object omission audit：**PASS**，已記錄九個 legacy table 的 apply-time/deferred dependencies。
- WEB-HOME-01B.1 PostgreSQL consent runtime harness：**PASS**，輸出 `WEB_HOME_01B1_RUNTIME_PASS` 與 `WEB_HOME_01B1_LOCAL_POSTGRES_PASS`；此結果仍依賴 test bootstrap。
- `npm run verify-local`：**935 passed / 0 failed**。
- Audit script diagnostics：**0 errors**。
- Final container check：無 local audit/Supabase container 殘留。

本次 regression 與 consent runtime 是在新增 audit harness 後重新執行；沒有宣稱 blank migration chain 已修復。

## 八、安全與範圍

- 未存取或修改 remote Supabase。
- 未執行 `supabase db push`、`supabase functions deploy`、`supabase migration repair`。
- 未修改 remote migration history 或 Secrets。
- 未呼叫 PayPal、未發送 OTP、未建立 Subscription。
- 未讀取或輸出使用者資料、Email、JWT 或 credential。
- 未修改任何既有 migration，未建立正式 baseline migration。
- 未複製 production data。
- 未 commit、未 push、未修改 main、未使用 `git add .` 或 `git add -A`。

## 九、完整結果

```text
WEB-HOME-01B.1A Result: BLOCKED_SCHEMA_SOURCE
First Clean-Rebuild Failure: 20260712040000_create_wallpaper_core_tables.sql — SQLSTATE P0001; missing public.users PK prerequisite (same block also requires public.mascots and public.gifts)
Missing Legacy Objects: users, mascots, gifts, user_mascots, redeem_history, shop_products, shop_cart, orders, order_items
Bootstrap Schema Objects: 9 public compatibility tables plus generate_order_no/trigger; not authoritative
Test-only Objects: anon/authenticated/service_role roles, auth.uid stub, auth/storage stubs, local grants/default privileges, supabase_migrations_local, dblink
Seed/Data Objects Excluded: all 10-seed-legacy.sql and 20-seed-subscription.sql fixtures; all catalog and production rows
Recommended Option: OPTION_A_FORMAL_BASELINE after authoritative reviewed schema-only provenance
Formal Baseline Created: NO
Existing Migration Modified: NO
Production Data Copied: NO
Clean Database Rebuild: FAIL
Second Rebuild: NOT RUN — first rebuild fails and no safe baseline was created
Temporary Bootstrap Required: YES
Consent Runtime Tests: PASS WITH TEST BOOTSTRAP
Regression Tests Passed: 935
Regression Tests Failed: 0
Remote Database Accessed: NO
Remote Database Mutated: NO
Migration History Repaired: NO
Function Deployed: NO
Secrets Changed: NO
Commit/Push Performed: NO
Gate: BLOCKED_SCHEMA_SOURCE
```