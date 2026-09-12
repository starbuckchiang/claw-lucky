# review-WEB-HOME-01B.2 — Isolated Sandbox Deployment & Consent E2E

日期：2026-09-12
分支：`release/auth-07c-sandbox`
狀態：**PASS — ISOLATED SANDBOX**

## 結論

完整 32-file migration chain 已從正式 baseline 起部署至獨立的 `claw-lucky-sandbox` project，且只部署 `consent-ops`。Production 與 Sandbox project digest 分別為 `5158b2f6`、`655ece1d`，兩者不同；所有 mutation 前均重新確認 linked target 為 Sandbox。

Sandbox PostgreSQL、RLS、RPC、JWT、冪等性、server-authoritative policy metadata，以及本機 `subscription.html` 的 account-upgrade／checkout consent gates 均完成 runtime E2E。沒有發送 Email OTP、呼叫 PayPal、建立 Subscription、修改 Secrets、部署 GitHub Pages、commit 或 push。工作區完成後仍 linked 至 Sandbox。

## Project identity

| Gate | 結果 |
|---|---|
| Production ref digest | `5158b2f6` |
| Sandbox ref digest | `655ece1d` |
| Projects distinct | PASS |
| Production identity | 獨立 project；`main` 為 default branch |
| Sandbox identity | 唯一命名 `claw-lucky-sandbox` 的獨立 project |
| Initial linked target | Production digest `5158b2f6` |
| Deployment linked target | Sandbox digest `655ece1d` |
| Current linked target | Sandbox digest `655ece1d` |

只使用 project/branch metadata 進行 identity gate；未查詢 Production application rows，也未對 Production 執行任何 DDL、DML、migration、Function 或 Auth mutation。

## Pre-deploy verification

- `npm run verify-local`：942/942 PASS，0 failed。
- PostgreSQL clean rebuild 1：PASS。
- PostgreSQL clean rebuild 2：PASS。
- 24-way order-number concurrency：24/24 PASS。
- Production-shaped security convergence：PASS。
- Temporary bootstrap required：NO。
- Catalog fingerprint：兩次 clean rebuild 與 converged fixture 均為 `54262b0465445c0d9a87d3e50d9a2ea1`。
- Production compatibility checker：在 Sandbox 以 read-only transaction 執行 PASS。

## Migration deployment

`supabase db push --dry-run` 對 Sandbox 列出完整 32-file chain：

- 第一個 application migration：`20260712000000_legacy_application_schema_baseline.sql`。
- 包含 `20260910000300_user_consents_append_only.sql`。
- 包含 `20260912000000_legacy_user_fk_alignment.sql`。
- 包含 `20260912000100_legacy_rls_grants_convergence.sql`。
- Migration history divergence：NO。
- Migration repair required/used：NO/NO。

Dry-run gate 通過後，`supabase db push` 對 Sandbox 成功套用全部 32 files。後續 `supabase migration list` 顯示 32 個 local/remote version pairs；baseline、consent、alignment、convergence versions 均存在。第一次 post-push verifier 因 CLI 2.109.1 table 格式與 parser 假設不同而誤報 remote count 0；改以 format-independent version-token parser 重驗後為 32/32。這是驗證器解析問題，不是 push 或 migration history failure；未重推、未 repair。

## Sandbox schema/runtime

Authoritative compatibility checker與 rollback-only security runtime suite確認：

- 九個 legacy tables 9/9 存在，schema/constraints/indexes相容，九表 RLS enabled。
- `public.user_consents`、required constraints、owner SELECT policy、append-only trigger及 database `now()` default存在。
- catalog最低權限讀取保留；owner read成功，cross-user read為 0 rows。
- anon讀取 `user_consents` 為 401。
- authenticated直接 INSERT／UPDATE／DELETE分別為 403／403／403。
- table-owner update/delete實際被 append-only trigger阻擋。
- PUBLIC／anon／authenticated無 `record_user_consent` EXECUTE；service_role可執行且已由 live Function成功呼叫。
- legacy permissive policies及 unrestricted orders/order_items policies不存在。
- anon/authenticated broad write grants不存在。
- `user_mascots(user_id, mascot_id)`只保留一個等價 unique constraint。
- order-number function/trigger具備 `Asia/Taipei`、transaction advisory lock、`LUCK-YYMMDD-NNNNNN`及 `BEFORE INSERT`契約。

## Function deployment

部署前 Sandbox function count為 0。只執行 `supabase functions deploy consent-ops`，未使用 `--no-verify-jwt`；部署後只有：

- `consent-ops` version 1，status `ACTIVE`，`verify_jwt=true`。

沒有部署或修改其他 Function，沒有修改 Secrets或任何 PayPal Function。

## Real Sandbox JWT E2E

使用兩位全新 Sandbox anonymous Auth users執行完整 HTTP/Data API E2E，credentials與identifiers只保留在 process memory：

| Case | 結果 |
|---|---|
| 無 Authorization | 401 |
| 無效 JWT | 401 |
| 合法 JWT / account_upgrade | 200 |
| JWT user vs stored record user | MATCH |
| Database server time | PASS；`accepted_at`位於 request window內 |
| Terms / Privacy version | `2026-09-15` / `2026-09-15` |
| Canonical policy hashes | MATCH |
| Same-key retry | 200；相同 record與time，`wasExisting=true` |
| Duplicate row | NO；owner query為 1 row |
| `user_id` injection | 400 |
| `accepted_at` injection | 400 |
| Terms / Privacy version injection | 400 / 400 |
| Terms / Privacy hash injection | 400 / 400 |
| `digital_content_waiver` while disabled | 400；無新增 record |
| Owner read | PASS |
| Second-user read of first-user record | 0 rows |
| anon table read | 401 |
| authenticated direct INSERT / UPDATE / DELETE | 403 / 403 / 403 |
| Function response sensitive-value scan | NONE FOUND |

API response scan排除刻意由 owner-only Data API讀取的 row本身；`consent-ops` responses未包含 JWT、Auth user ID、public key或其他 session credential。Hosted Function logs無 CLI 讀取命令；本次成功與 400 validation paths不呼叫 application logger，401由平台 JWT gate拒絕。Function的錯誤 logging implementation僅允許 correlation ID、固定 event/reason與error type，並由既有 automated tests覆蓋。本報告不宣稱曾讀取 hosted log viewer。

## Frontend Sandbox E2E

本機使用 `http://localhost:5588/subscription.html`。localhost server在記憶體中動態提供 Sandbox runtime config與匿名 session；未建立 credential file，tracked `config.js`與 `js/config.js` diff均為空。

Browser automation替換 OTP與PayPal邊界為計數型攔截器；`consent-ops`成功路徑仍呼叫真實 Sandbox Function：

### Account upgrade

- Terms/Privacy checkbox預設未勾：PASS。
- 未勾選點擊寄送：consent request 0、OTP mutation request 0。
- 模擬 consent HTTP失敗：OTP service call 0、OTP step仍隱藏。
- 解除攔截後真實 Sandbox consent成功：OTP service boundary到達 1 次、OTP下一階段顯示。
- OTP boundary在呼叫前已 stub；`/auth/v1/otp`及非 GET `/auth/v1/user` request為 0，沒有 Email或OTP傳送。

### Subscription checkout

- payment checkbox預設未勾：PASS。
- 未勾選時 `actions.reject()` 1、`actions.resolve()` 0、consent request 0。
- 模擬 consent HTTP失敗：subscription handler 0、`actions.subscription.create` 0。
- 解除攔截後真實 Sandbox checkout consent成功：進入 subscription handler 1 次，隨即以測試 stop signal終止。
- `actions.subscription.create` 0。
- PayPal external network requests 0；PayPal Functions requests 0；未開啟付款視窗。
- 該 browser test user的 owner read確認 account-upgrade及 checkout各 1 筆 consent。

前端測試中的 500 responses為刻意 network interception，用來證明 consent failure會阻擋後續動作，不是 Sandbox Function failure。

## Test data and safety

本任務共建立 5 位 disposable Sandbox anonymous Auth users與 4 筆 append-only consent records；其中包含一次修正測試 assertion前已成功完成的 JWT run，以及最終 CLI/browser runs。依 retention contract保留並標記為 Sandbox測試資料：未停用 trigger、未移除 FK、未直接 DELETE consent，也未嘗試刪除受 audit FK保護的 users。

- Production database mutated：NO。
- Production Function deployed：NO。
- Production Auth settings changed：NO。
- Production Secrets changed：NO。
- Sandbox Secrets changed：NO。
- Email OTP sent：NO。
- PayPal called：NO。
- PayPal Subscription created：NO。
- GitHub Pages deployed：NO。
- Commit/push performed：NO。

## Final result

```text
WEB-HOME-01B.2 Result: PASS
Production Ref Digest: 5158b2f6
Sandbox Ref Digest: 655ece1d
Projects Distinct: YES
Linked Target: SANDBOX — 655ece1d
Pre-deploy Tests: PASS — 942/942
Clean Rebuild: PASS — two rebuilds
Catalog Fingerprint: 54262b0465445c0d9a87d3e50d9a2ea1
Migration Dry-run: PASS — full 32-file chain, baseline first
Baseline Migration Applied: YES
Alignment Migration Applied: YES
Convergence Migration Applied: YES
Consent Migration Applied: YES
Migration Repair Used: NO
Sandbox DB Push: PASS — 32/32 local/remote pairs
Consent Table: PASS
RLS Runtime: PASS
Legacy Policies Removed: YES
Broad Grants Removed: YES
Order Number Contract: PASS
Function Deployed: consent-ops v1 only
Verify JWT: ENABLED
Unauthenticated Request: 401
Invalid JWT Request: 401
Valid JWT Request: 200
JWT User Match: MATCH
Server Time: PASS
Policy Version/Hash: MATCH
Idempotency: PASS — one row
Field Injection: REJECTED — six variants, all 400
Waiver Flag: OFF — 400, no row
Own Record Read: PASS
Cross-user Read: 0 rows
Sensitive Data Leakage: NONE FOUND in Function responses; hosted log viewer not queried
Account Upgrade Blocking: PASS
Subscription Blocking: PASS
OTP Sent: NO
PayPal Called: NO
PayPal Subscription Created: NO
Production Database Mutated: NO
Production Function Deployed: NO
Production Secrets Changed: NO
GitHub Pages Deployed: NO
Commit/Push Performed: NO
Current Linked Project: SANDBOX
Gate: PASS
```

**安全警告：目前 workspace 仍 linked 至 Sandbox digest `655ece1d`。後續 Supabase CLI命令會指向 Sandbox；本任務刻意不自動切回 Production。**