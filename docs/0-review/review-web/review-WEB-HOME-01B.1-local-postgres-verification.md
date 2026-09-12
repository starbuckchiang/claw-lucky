# review-WEB-HOME-01B.1 — Local PostgreSQL Runtime Verification

日期：2026-09-11
分支：`release/auth-07c-sandbox`
狀態：**PASS — LOCAL_RUNTIME_VERIFIED**

---

## 一、結論

WEB-HOME-01B.1 已在本機 Docker Linux/PostgreSQL 與本機 Supabase 完成 runtime 驗證。所有資料庫及 HTTP 連線均指向 `127.0.0.1`；未連線或修改 linked remote database，未執行 remote push/deploy。

- Docker Server：Docker Desktop 4.77.0，Engine 29.5.3，`linux/amd64`。
- Supabase CLI：2.109.1。
- PostgreSQL harness：`postgres:16-alpine`，僅綁定 `127.0.0.1:55434`。
- Local Supabase API：`http://127.0.0.1:54321`；DB：`127.0.0.1:54322`。
- Migration、RLS、RPC、append-only、auth user delete、JWT Function E2E 全部通過。
- `npm run verify-local`：935/935 PASS。

## 二、本機啟動與 migration

第一次 `supabase start` 證實 repository migration chain 依賴未納入 migrations 的 legacy base tables（`users`、`mascots`、`gifts` 等），因此第一個 migration 在全新空白 local Supabase 無法執行。這不是 consent migration 錯誤。

驗證使用 repository 既有 `scripts/auth-07c7e1-local-pg/00-bootstrap.sql` 作為 production-shaped legacy baseline，並新增 WEB-HOME-01B.1 專用 local harness：

- `scripts/web-home-01b1-local-pg/run.ps1`
- `scripts/web-home-01b1-local-pg/10-auth-users.sql`
- `scripts/web-home-01b1-local-pg/20-consent-runtime-tests.sql`
- `scripts/web-home-01b1-local-pg/function-e2e.cjs`

PostgreSQL harness 在每個 SQL 階段確認 target 為 `127.0.0.1:55434`，依序套用全部 repository migrations，最後輸出 `WEB_HOME_01B1_RUNTIME_PASS` 與 `WEB_HOME_01B1_LOCAL_POSTGRES_PASS`。容器在 `finally` 中刪除。

為啟動完整 local Supabase，曾建立一個 temporary、最早排序的 legacy bootstrap migration；Function E2E 完成後已刪除，未保留於 migration chain，亦未推送 remote。

## 三、Schema 與權限 runtime 結果

實際 PostgreSQL catalog 與角色測試確認：

- `public.user_consents` 存在，UUID primary key 正確。
- `user_id` foreign key 指向 `auth.users(id)`，delete action 不是 CASCADE。
- scope、source、scope/version、hash shape、idempotency key CHECK 均存在。
- UNIQUE `(user_id, consent_scope, idempotency_key)` 存在。
- `accepted_at` 使用 database `now()` default。
- RLS enabled，owner-only SELECT policy 存在。
- authenticated A 可讀 A 的兩筆紀錄，讀不到 B 的紀錄。
- anon SELECT 被拒絕。
- anon/authenticated direct INSERT 被拒絕。
- authenticated direct UPDATE/DELETE 被拒絕。
- append-only trigger 阻擋 authenticated、BYPASSRLS service_role 與 table owner `postgres` 的 UPDATE/DELETE。
- `record_user_consent` 為 SECURITY DEFINER，`search_path=public, pg_temp`。
- PUBLIC、anon、authenticated 無 RPC EXECUTE；service_role 可執行。
- 相同 user/scope/idempotency key 重送回傳相同 record，只保留一筆。
- 相同 key 搭配不同 scope 可各自建立一筆。
- `accepted_at` 落在 database test window 內，並在重送時保持不變。

## 四、使用者刪除結果

對具有 consent records 的隔離測試 `auth.users` 使用者執行 DELETE，foreign key 阻擋刪除；同意紀錄仍完整存在。因此分類為：

`RESTRICTED_BY_AUDIT_FOREIGN_KEY`

沒有 CASCADE deletion，也沒有 orphaned record。測試資料只存在於 disposable local database；容器移除後全數清除，未停用 constraint。

## 五、Local Function JWT E2E

`consent-ops` 僅在 `127.0.0.1:54321` 本機 serve。E2E runner 從 local `supabase status` 在 process memory 中取得 local development credentials，不輸出 JWT、Email、password、UUID 或 key。

驗證結果：

- 無 JWT：HTTP 401。
- 無效 JWT：HTTP 401。
- 合法 local test JWT：HTTP 200，成功寫入 `account_upgrade`。
- authenticated owner-only REST read 的 `user_id` 與 JWT user 在程式內比對為 MATCH；未輸出 UUID。
- Terms／Privacy version 均為 `2026-09-15`。
- 兩個 policy hash 與 canonical constants 完全一致。
- `accepted_at` 由 server/database 產生。
- 相同 idempotency key 重送回傳相同 consent record及時間，`wasExisting=true`。
- 注入 `user_id`、`accepted_at`、`terms_version`、`privacy_content_sha256` 各自均 HTTP 400。
- `digital_content_waiver` 在 flag 關閉時 HTTP 400，未建立紀錄。
- API responses 不含 JWT、Email、password、user UUID、anon/service-role key；正常回應仍依既有 API contract 包含非身分識別用途的 `consentId`。
- Function log 只含 localhost routing、serve event及預期 invalid-token parser error；未含 JWT、Email、UUID、Secret、request body或政策內容。

## 六、安全與清理

- 未執行 `supabase db push`、`supabase functions deploy`、`supabase migration repair`。
- 未修改 Secrets。
- 未呼叫 PayPal、未建立 Subscription、未發送 OTP。
- 未 commit、未 push、未修改 main。
- 未使用 `git add .` 或 `git add -A`。
- `supabase stop --no-backup` 已執行；所有 local Supabase containers 已移除。
- disposable PostgreSQL container 已移除。
- temporary local bootstrap migration 已刪除。

## 七、回歸測試

`npm run verify-local`：

- Tests passed：935
- Tests failed：0
- Duration：約 8.1 秒

## 八、完整結果

```text
WEB-HOME-01B.1 Result: PASS
Docker Engine: PASS — Docker Desktop 4.77.0 / Engine 29.5.3 / linux/amd64
Local Supabase: PASS — localhost stack started, tested, and removed
Remote Database Accessed: NO
Migration Applied Locally: YES — disposable PostgreSQL and local Supabase only
Consent Table: PASS
Constraints: PASS
RLS Enabled: PASS
Own Read: PASS
Other User Read: DENIED
Anon Read: DENIED
Direct Insert: DENIED — anon and authenticated
Direct Update/Delete: DENIED — authenticated; trigger also blocks service_role and table owner
Append-only Trigger: PASS
RPC Public Execute: DENIED
RPC Authenticated Execute: DENIED
RPC Service Role Execute: PASS
Idempotency: PASS
Server Time: PASS
Auth User Delete Result: RESTRICTED_BY_AUDIT_FOREIGN_KEY
Local Function: PASS — consent-ops served on 127.0.0.1
Unauthenticated Request: 401
Valid JWT Request: 200
JWT User Match: MATCH
Field Injection: REJECTED
Sensitive Data Leakage: NONE FOUND IN API RESPONSE OR FUNCTION LOG
Tests Passed: 935
Tests Failed: 0
Remote DB Push: NO
Remote Function Deploy: NO
PayPal Called: NO
Commit/Push Performed: NO
Gate: PASS
```
