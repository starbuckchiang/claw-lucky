# review-WEB-HOME-01B — Consent PostgreSQL Verification & Sandbox Deployment

日期：2026-09-11
分支：`release/auth-07c-sandbox`
狀態：**PARTIAL — BLOCKED_NO_ISOLATED_SANDBOX**

---

## 一、結論

本次完成所有不會變更遠端環境的部署前檢查，但未執行 migration、Edge Function 部署或真實 JWT E2E。

阻擋原因：Supabase CLI 顯示帳號只有一個 linked project，且該 project 只有 `main` default branch；`project_ref` 與 `parent_project_ref` 相同，並非隔離 preview branch。依 WEB-HOME-01B「只允許 Sandbox Supabase」限制，此 linked target 不可視為 Sandbox，也不得執行 `supabase db push` 或 `supabase functions deploy consent-ops`。

本機亦無可用的隔離 PostgreSQL：Docker Linux engine 不存在、Docker Desktop 未安裝，`psql`、`postgres`、`pg_isready` 均不可用。因此無法在本機實際套用 migration；所有 PostgreSQL runtime、RLS、RPC、刪除行為及真實 JWT 結果均明確標為 `NOT RUN`。

## 二、部署前檢查

| 檢查 | 結果 |
|---|---|
| Branch | PASS — `release/auth-07c-sandbox` |
| WEB-HOME-01A review | 已讀取；實際位置為 `docs/0-review/review-web/review-WEB-HOME-01A-legal-consent-persistence.md` |
| Pending migration | PASS — 僅 `20260910000300_user_consents_append_only.sql` |
| `supabase db push --dry-run` | PASS — 僅列出上述 migration，未套用 |
| `npm run verify-local` | PASS — 935/935 |
| Migration/RLS/RPC 靜態測試 | PASS（包含 constraint、RLS、grant、trigger、RPC search_path、idempotency） |
| 實際 SQL parse/apply | NOT RUN — 無隔離 PostgreSQL |
| Hardcoded service-role key | PASS — 無值或 secret-shaped literal；僅透過 `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` |
| Secret 檢查 | 未讀取任何值；程式只引用 Supabase 平台保留名稱 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。CLI custom secret list 不列出這些平台內建值，故未宣稱遠端值已讀取驗證。 |
| Existing `consent-ops` deployment | 無；function list 未包含 `consent-ops` |

未修改 01A migration 或功能程式碼。本次只新增本 review。

## 三、Migration 與權限靜態證據

靜態測試及 SQL review 證實 migration 宣告下列設計，但因未在 PostgreSQL 執行，不等同 runtime proof：

- `public.user_consents` 的 UUID primary key、`auth.users(id)` foreign key、scope/source/hash/idempotency CHECK 與 `(user_id, consent_scope, idempotency_key)` UNIQUE。
- Foreign key 未使用 `ON DELETE CASCADE`。
- RLS enabled；authenticated owner-only SELECT policy 使用 `auth.uid() = user_id`。
- anon 無 table privilege；authenticated 只有 SELECT，沒有 INSERT／UPDATE／DELETE。
- append-only trigger 在 UPDATE／DELETE 前拋錯。
- `record_user_consent` 為 `SECURITY DEFINER`、固定 `search_path = public, pg_temp`，PUBLIC／anon／authenticated EXECUTE 均撤銷，只授權 service_role。
- `accepted_at` 不在 RPC signature，INSERT 依資料庫 `DEFAULT now()`。
- RPC 使用 `ON CONFLICT DO NOTHING`，相同 user/scope/idempotency key 回傳原紀錄。

### FORCE ROW LEVEL SECURITY 判定

目前不需要 `FORCE ROW LEVEL SECURITY`：anon/authenticated 不是 table owner，且已由 RLS policy 與顯式 grant/revoke 限制；受信任 service-role 寫入路徑則需要執行受限 RPC。append-only trigger 仍會阻擋普通 UPDATE／DELETE，包括 bypass RLS 的寫入角色。正式 Sandbox runtime 驗證時仍需檢查實際 owner、role attributes 與 grants，再確認此判定。

## 四、未執行的 PostgreSQL 驗證

以下項目因沒有隔離 PostgreSQL 而未執行，不能以 01A 靜態測試代替：

- 實際建立 table／constraints／policy／trigger／RPC。
- authenticated own-read、other-user deny、anon deny。
- anon/authenticated direct INSERT／UPDATE／DELETE deny。
- append-only trigger runtime rejection。
- PUBLIC／anon／authenticated RPC deny及 service_role RPC success。
- 同 key idempotency、不同 scope 獨立紀錄、database server time。
- 刪除隔離 `auth.users` 測試使用者時的 foreign-key 行為與清理。

依 SQL 設計預期刪除結果為 `RESTRICTED_BY_AUDIT_FOREIGN_KEY`，但本次沒有 runtime proof，因此最終結果仍填 `NOT RUN`，不填預期值。

## 五、Sandbox 部署與 JWT E2E

因 linked target 不是隔離 Sandbox，流程在任何寫入前停止：

- 未執行 `supabase db push`。
- 未執行 `supabase functions deploy consent-ops`。
- 未使用 `--no-verify-jwt`。
- 未修改 Secrets。
- 未建立或使用測試帳號。
- 未讀取或輸出 JWT、Email、OTP、使用者 UUID、service-role key。
- 未測試 unauthenticated／invalid／valid JWT request。
- 未呼叫 PayPal、未建立 Subscription、未部署 GitHub Pages。

`consent-ops/index.ts` 的本機程式碼使用既有 `resolveAuthenticatedUser(req)` 進行 JWT user resolution，所有 response 均傳入 request-aware CORS helper；這些由 935-test suite 的 handler與 static boundary tests覆蓋，但 function 尚未部署，不能宣稱 live `verify_jwt` 或 HTTP E2E 已通過。

## 六、流程 Gate

本機自動測試已證實：

- account upgrade 未勾選不呼叫 consent/OTP。
- consent write 失敗不送 OTP。
- checkout 未勾選不呼叫 consent。
- consent write 失敗不呼叫 `actions.subscription.create`。
- `digital_content_waiver` flag 關閉。

由於沒有可用的 deployed Sandbox `consent-ops`，未執行成功寫入後停止在 OTP 前、或成功 consent 後進入可建立訂閱狀態的真實 Sandbox 流程。沒有呼叫 PayPal。

## 七、解除阻擋條件

需先提供或建立一個與 production default project 分離的 Supabase Sandbox project／preview branch，並重新 link 至該隔離 ref。另需提供可執行 PostgreSQL 的隔離環境（例如安裝並啟動 Docker Desktop 後使用 Supabase local stack）。完成後應從本任務第二節重新檢查 project identity、pending migration scope 與 935/935，再依序執行 local PostgreSQL runtime tests、Sandbox db push、只部署 `consent-ops`、最後執行真實 JWT E2E。

## 八、最終結果

```text
WEB-HOME-01B Result: BLOCKED_NO_ISOLATED_SANDBOX
Pre-deploy Tests: PASS — 935/935
Migration Scope: PASS — only 20260910000300_user_consents_append_only.sql pending
PostgreSQL Migration: NOT RUN — isolated PostgreSQL unavailable
Consent Table: NOT CREATED/VERIFIED IN SANDBOX
RLS Enabled: STATIC PASS; RUNTIME NOT RUN
Own Record Read: NOT RUN
Other Record Read: NOT RUN
Direct Insert: NOT RUN
Direct Update/Delete: NOT RUN
Append-only Trigger: STATIC PASS; RUNTIME NOT RUN
RPC Public Execute: STATIC DENY; RUNTIME NOT RUN
RPC Authenticated Execute: STATIC DENY; RUNTIME NOT RUN
RPC Service Role Execute: STATIC ALLOW; RUNTIME NOT RUN
Idempotency: STATIC PASS; RUNTIME NOT RUN
Server Time: STATIC PASS; RUNTIME NOT RUN
Policy Version/Hash: LOCAL PASS — 2026-09-15/canonical hashes; SANDBOX NOT RUN
Auth User Delete Result: NOT RUN (expected RESTRICTED_BY_AUDIT_FOREIGN_KEY, not claimed)
Sandbox DB Push: NO — linked target is production default, not Sandbox
Function Deployed: NO
Verify JWT: SOURCE/STATIC PASS; DEPLOYED NOT RUN
Unauthenticated Request: NOT RUN
Valid JWT Request: NOT RUN
JWT User Match: NOT RUN
Field Injection Rejected: LOCAL TEST PASS; LIVE NOT RUN
Account Upgrade Blocking: LOCAL TEST PASS; LIVE SANDBOX NOT RUN
Subscription Blocking: LOCAL TEST PASS; LIVE SANDBOX NOT RUN
PayPal Called: NO
PayPal Subscription Created: NO
Secrets Changed: NO
Other Functions Deployed: NONE
GitHub Pages Deployed: NO
Commit/Push Performed: NO
Gate: PARTIAL
```
