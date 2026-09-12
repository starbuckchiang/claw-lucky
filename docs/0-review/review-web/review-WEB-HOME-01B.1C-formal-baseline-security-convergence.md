# review-WEB-HOME-01B.1C — Formal Legacy Baseline & Security Convergence

日期：2026-09-12
狀態：**PASS — LOCAL ONLY**

## 結論

已依 `WEB-HOME-01B.1B-legacy-schema-manifest.md` 建立正式零資料 legacy baseline。全新環境可從 `20260712000000` 開始依序套用完整 migration chain，不再依賴 `00-bootstrap.sql`。九個 legacy tables、identity sequences、constraints、indexes、order-number functions/trigger、RLS 與最低權限均由正式 migrations 管理。

另新增兩個 forward migrations：`20260912000000` 修正歷史 wallpaper migration 在 clean rebuild 時把 user FK 綁到 surrogate `users.id` 的差異；`20260912000100` 移除 authoritative manifest 列出的 legacy permissive policies、過寬 client grants 與重複 unique constraint。既有 migration 均未修改，production/remote 均未存取或變更。

## 新增 migrations

| Migration | 用途 |
|---|---|
| `20260712000000_legacy_application_schema_baseline.sql` | 九個 legacy tables、identity、PK/UNIQUE/FK/index、order number、RLS、catalog SELECT 與最低權限 |
| `20260912000000_legacy_user_fk_alignment.sql` | 將三個 wallpaper user FK 對齊 authoritative `users.user_id`；保留 RESTRICT/CASCADE/RESTRICT |
| `20260912000100_legacy_rls_grants_convergence.sql` | 移除 legacy permissive policies/broad grants，保留 `p_*` owner policies、catalog reads、service-role RPC，移除重複 unique constraint |

## 九個 table 來源

`users`、`mascots`、`gifts`、`user_mascots`、`redeem_history`、`shop_products`、`shop_cart`、`orders`、`order_items` 的 column order/type/nullability/default/identity、constraints、indexes 與 trigger 均來自 01B.1B sanitized authoritative manifest。沒有使用舊 bootstrap 作 schema source，沒有複製 catalog/user/order/transaction rows。

Clean baseline 故意未重建 production 的安全缺陷：legacy owner direct-write policies、anon redeem-history read、unrestricted orders/order_items read/write、client table/sequence/function `ALL` grants，以及第二個等價 `user_mascots(user_id, mascot_id)` unique constraint。

## Order number contract

`generate_order_no() RETURNS text` 使用 `Asia/Taipei` 日期、`pg_advisory_xact_lock(hashtext('orders-' || YYMMDD))`、同日最大序號加一，輸出 `LUCK-YYMMDD-NNNNNN`。`set_order_no()` 僅在 null/blank 時填值；`trigger_set_order_no` 為 `BEFORE INSERT`；`orders_order_no_key` 提供最終唯一性。

在 PostgreSQL 16 disposable database 同時送出 24 筆獨立 transaction：24/24 成功、格式全數符合、序號為 000001–000024、重複 0。

## Clean rebuild evidence

- PostgreSQL clean rebuild 1：PASS。
- PostgreSQL clean rebuild 2：PASS。
- 完整 migration chain：兩次皆 PASS。
- 九個 legacy tables：9/9。
- application-required RPC：建立成功；`ensure_user_row` 由 `service_role` 實際呼叫成功。
- Catalog fingerprint：兩次皆為 `54262b0465445c0d9a87d3e50d9a2ea1`。
- Temporary bootstrap required：NO。
- 正式 local Supabase `db reset --local`：PASS，從 baseline 套用完整 chain。

Fingerprint 涵蓋 public tables 的 columns/types/nullability/default/identity、constraints、indexes、policies 與 function definitions/config，不包含 application rows。

## Security convergence evidence

Disposable production-shaped fixture 先加入 manifest 所列 20 個 legacy permissive policies、過寬 anon/authenticated grants，再執行 convergence migration兩次。結果：

- 20/20 legacy policies 移除。
- unrestricted `orders_*` 與 `order_items_*` policies 移除。
- anon/authenticated 對九表的 INSERT/UPDATE/DELETE/TRUNCATE privileges 移除。
- 六個既有 `p_*_select_owner` policies 保留，兩個 local users 的 cross-owner read 實測為 0 rows。
- `mascots`、enabled `gifts`、enabled `shop_products` 的 anon catalog reads 保留；disabled gift 不可見。
- `service_role` 的 `ensure_user_row` EXECUTE 與實際呼叫保留。
- `user_mascots` 僅保留 `uq_user_mascots_user_mascot`；移除前會驗證兩 constraint definitions 完全相同。
- Migration 不依賴 application rows；fixture 空資料也可執行。
- 第二次執行 PASS，且 converged fingerprint 與 clean rebuild 相同。

## Compatibility checker與release plan

`production-compatibility-check.sql` 以 `BEGIN TRANSACTION READ ONLY` 執行，只讀取 `information_schema`/`pg_catalog` metadata。它 fail-closed 比對九表 columns/type/nullability/default/identity、PK/UNIQUE/FK、indexes、RLS、order functions/trigger/search_path/contract；不讀 application rows，也不要求 production 保留將被移除的 insecure policies/grants。已在兩個 clean rebuild 實際執行 PASS。

新空白環境：正常由 `20260712000000` 起依序執行全部 migrations。

既有 production：不得執行 baseline CREATE TABLE。未來須在獨立人工核准階段先執行 exact read-only compatibility preflight；只有完全 PASS 才可將 baseline version 標記 applied。該階段才可考慮 migration repair/history marking。`20260912000000`、`20260912000100` 與 consent migration 仍正常執行。任何 mismatch 必須停止，不得以 `IF NOT EXISTS` 或 repair 掩蓋。

## Consent與regression

- Bootstrap-free PostgreSQL consent runtime：PASS，`WEB_HOME_01B1_RUNTIME_PASS`。
- Local Supabase consent-ops JWT E2E：PASS；no JWT/invalid JWT = 401，valid JWT = 200，idempotency/version hash/server time/field-injection rejection/waiver rejection全部 PASS，response sensitive leakage = false。
- Focused WEB-HOME SQL tests：7/7 PASS。
- Updated order-number + WEB-HOME focused tests：17/17 PASS。
- `npm run verify-local`：942/942 PASS，0 failed。
- VS Code diagnostics：新增 migrations 與 test 無 error。

## Scope聲明

- Remote database accessed/mutated：NO/NO。
- `supabase db push`、migration repair/history marking：未執行。
- Function deploy、Secrets、PayPal、OTP、Subscription：均未執行或變更。
- Production rows/raw dump：未讀取、未複製、未保留、未 commit。
- Existing migrations：未修改。
- Commit/push、`git add .`、`git add -A`、main 修改：均未執行。
- 測試僅使用 localhost disposable PostgreSQL 與 local Supabase。

## 完整結果

```text
WEB-HOME-01B.1C Result: PASS
Baseline Migration: supabase/migrations/20260712000000_legacy_application_schema_baseline.sql
Baseline Version: 20260712000000
Legacy Tables: 9/9
Authoritative Manifest Used: YES
Production Rows Copied: NO
Raw Dump Committed: NO
Existing Migrations Modified: NO
Insecure Policies Reproduced: NO
Broad Client Grants Reproduced: NO
Order Number Contract: LUCK-YYMMDD-NNNNNN / Asia-Taipei / advisory transaction lock / daily max+1 / BEFORE INSERT
Order Number Concurrency: PASS — 24/24 unique, contiguous 000001-000024
Clean Rebuild: PASS
Second Clean Rebuild: PASS
Catalog Fingerprints Match: YES — 54262b0465445c0d9a87d3e50d9a2ea1
Temporary Bootstrap Required: NO
Consent Runtime Tests: PASS
Local JWT E2E: PASS
Security Convergence Migration: supabase/migrations/20260912000100_legacy_rls_grants_convergence.sql
Legacy Permissive Policies Removed: YES — 20/20 manifest-named policies
Unrestricted Order Reads Removed: YES
Direct Client Writes Denied: YES
Catalog Reads Preserved: YES
Service Role RPC Preserved: YES
Duplicate Unique Constraint: REMOVED SAFELY; one equivalent constraint retained
Production Compatibility Checker: PASS LOCALLY — read-only/catalog-only/fail-closed
Regression Tests Passed: 942
Regression Tests Failed: 0
Remote Database Accessed: NO
Remote Database Mutated: NO
Migration Repair Performed: NO
Function Deployed: NO
Secrets Changed: NO
PayPal Called: NO
Commit/Push Performed: NO
Gate: PASS
```