# review-auth-07C.10-sandbox-final-release-preflight

Auth-07C.10：PayPal Subscriptions Sandbox Final Release Preflight。

```text
Gate: READY_FOR_RELEASE_APPROVAL
Release Classification: SANDBOX_CODE_RELEASE_ONLY
```

```text
Commit Performed: NO
Push Performed: NO
Database Changed: NO（僅唯讀查詢）
Functions Deployed: NONE
Secrets Changed: NO
Live PayPal Plan Created: NO
```

---

## 1. 07C 完整功能矩陣（15 項全數確認）

| # | 功能 | 證據 |
|---|---|---|
| 1 | monthly = USD 5 自動續訂 | RPC `acquire` 伺服器定價 5.00＋CHECK 約束；07C.3 Sandbox Plan；07C.7F 實付 USD 5 |
| 2 | yearly = USD 48 自動續訂 | 同上（48.00）；07C.3 建立 yearly plan |
| 3 | Subscriptions API（非 Orders v2） | SDK `vault=true, intent=subscription`＋`createSubscription`（07C.6）；後端 `/v1/billing/subscriptions`（07C.4） |
| 4 | 首期 SALE 後才建 paid_through | Confirm Grants Entitlement: NO（07C.4）；07C.7F reconciliation 後 paid_through 才出現 |
| 5 | SALE webhook／reconciliation 冪等 | UNIQUE sale/event＋07C.7F get_status ×2 tx 仍 1 |
| 6 | ACTIVE＋paid_through 顯示權益 | 07C.6 view-model＋07C.7F 實測 |
| 7 | 取消後兩端 CANCELLED | 07C.8：PayPal GET CANCELLED＋本地 CANCELLED |
| 8 | 取消後權益保留至 paid_through | 07C.8：paid_through 不變；07C.9 S1 |
| 9 | 取消後 slot OCCUPIED 至到期 | 07C.8＋07C.9 S1（release RPC 回 FALSE） |
| 10 | 到期後才 RELEASED | 07C.9 S2/S3/S7（邊界含等於） |
| 11 | 到期後可重新訂閱 | 07C.9 S9（acquire 發新 session；舊列保留） |
| 12 | refund/reversal 安全狀態機 | 07C.2/07C.4 tests（access block＋needs_review）— mock 層級，Sandbox 未實測退款（依 07C.8 禁令） |
| 13 | webhook signature verification ON | 07C.7F smoke（bad signature→401、0 rows）＋v8 未再部署 |
| 14 | paypal-subscription verify_jwt ON | live functions list：`verify_jwt=true` |
| 15 | RLS Advisor 無 critical | SEC-01A/B 修復；live catalog：RLS-disabled 一般資料表 = **0** |

## 2. 所有 Gate 結果

07C.1/1A READY_FOR_IMPLEMENTATION → 07C.2 PASS(shape) → 07C.2A PASS(live PG) → 07C.3 PASS →
07C.4 PASS → 07C.5 PASS → 07C.6 PASS → 07C.7A PASS → 07C.7B PASS → 07C.7C FAIL_DELIVERY（診斷，
由 7E 取代）→ 07C.7D BLOCKED_LOG_ACCESS（診斷）→ 07C.7E PASS → 07C.7E.1 PASS → 07C.7F PASS →
**07C.8 PASS** → **07C.9 PASS**；SEC-01 PASS → SEC-01A PASS → SEC-01B PASS → SEC-01C PASS
（含 evidence closure，commit 8c25e5f 已 push）。

## 3. 修改檔案分類（git status 148 項）

### A. AUTH_07C_REQUIRED（核准 commit 候選）

Tracked modified（7）：`subscription.html`、`css/pages/subscription.css`、
`js/pages/subscription-entry.js`、`config.js`（公開 Sandbox Client ID＋PAYPAL_ENV，公開值設計）、
`js/user.js`（verifyTurnstile forceFresh — 訂閱登入流程必要）、`.env.example`（僅空佔位）、
`scripts/verify-local.ps1`（07C syntax checks）。

Untracked：`supabase/config.toml`（paypal-webhook verify_jwt=false 部署設定）；
`js/services/subscription/`（3 服務＋4 測試檔）；
`supabase/functions/_shared/paypal-{checkout,subscription,webhook}-handler.{js,ts}`、
`lib/paypal-{client,plans}.{js,ts}`、`__tests__/paypal-*.test.js`（2）；
`supabase/functions/{paypal-checkout,paypal-subscription,paypal-webhook}/index.ts`；
migrations `20260821000200`／`20260907000100`／`20260908000100`＋3 個 shape 測試；
review docs `review-auth-07*.md`（07 系列 24 檔）＋`note-auth-07C.1A.md`。
Secret/PII 掃描（71 檔）：3 hits 全為安全誤報（sanitizer 測試用假 JWT
`eyJ….aaa.bbb`、prose 佔位名、遮罩 UID prefix `5020bf33-…`）。

### B. SEC_ALREADY_COMMITTED

SEC migrations／tests／4 review docs 已於 `8c25e5f` push。
`review-auth-SEC-01C-rls-security-release.md` 工作樹尚有 evidence-closure 更新
（Review Update Commit Pending — 屬 SEC 系列，不混入 07C commit）。

### C. SUPPORT_01（排除）

`docs/0-review/review-support/review-support-01-paypal-coffee-links.md`（modified）、
`docs/0-working-prompts/prompts-auth/prompts-support-01*.md`（3）。

### D. UNRELATED_EXISTING_CHANGE（排除）

05C 時期 review docs（6）、`review-github-pages-cors-account-data.md`、
gift-redeem docs（2）、`prompts-auth-05C-merge.md`（modified）、`prompts-auth-05C-5.md`、
gift-redeem／redemption prompts。

### E. TEMPORARY_OR_SENSITIVE（絕不 commit）

**`docs/0-working-prompts/prompts-auth/paypel測試用帳號.txt`（真實 Sandbox 憑證）**、
`scripts/auth-07c*/`（9 個診斷 harness 目錄，含 `.jsonl` 執行紀錄）、
`scripts/auth-07c8-cancel-e2e/`＋`scripts/auth-07c9-expiry/`（本二 Gate 的 harness＋log）、
`supabase/.temp/cli-latest`、其餘 `docs/0-working-prompts/**` prompt 檔（部分含測試參數）。

### F. UNKNOWN（排除，勿刪）

`=`（0-byte 殘留檔，疑 shell redirect 誤產物）。

## 4–5. 核准候選／排除清單

核准候選＝上述 A 全部（tracked 7＋untracked 約 46 檔）。
排除＝B 的 pending review 更新、C、D、E、F 全部。
禁令遵守：未用 `git add .`/`-A`、未還原、未刪除任何檔案。

## 6. 測試結果

```text
pwsh -File scripts/verify-local.ps1 → 873 pass / 0 fail
（含 subscription backend 29、webhook/Orders 41、migration shape、view-model 16＋expiry 5、
 cancellation、reconciliation、RLS shape 全部子集）
Secret/PII leakage scan（71 候選檔）→ 0 real hits
```

## 7. Migration 與 Function 版本

- `supabase migration list`：local=remote 到 `20260910000200`；**pending = 0**。
- `paypal-webhook` **v8**（verify_jwt=false gateway；handler 內簽章驗證 ON）— 與 07C.7F 一致。
- `paypal-subscription` **v2**（verify_jwt=true）— 與 07C.7F/07C.8 一致。
- `paypal-checkout` v8 — 本階段未改動。

## 8. Sandbox 最終資料狀態（唯讀）

CANCELLED；paid_through=2026-10-07T10:00:00Z；release_after=paid_through；slot OCCUPIED；
tx=1；signed cancellation webhook SUCCESS/processed（1 筆）；reconciliation resolved；
access_blocked_at=null。未再取消／付款／建立／修改。

## 9. Security Advisor

DB catalog：public RLS-disabled 一般資料表 = **0**（`rls_disabled_in_public` 條件已清除；
Dashboard 顯示以其掃描週期為準）。

## 10. GitHub Pages 部署風險

- Pages 由 **main branch 自動部署**（`pages-build-deployment`；run #509 由 SEC-01C push 即時觸發，實證）。
- **push main 會立即公開發布** subscription.html＋新 config.js。
- 公開前端 PayPal 環境：**sandbox**（config.js `PAYPAL_ENV="sandbox"`；公開 Client ID sha256
  `0c3626cd…` 與後端 `PAYPAL_CLIENT_ID` secret digest **MATCH**）。
- 後端：`PAYPAL_ENV` digest = sha256("sandbox") **MATCH**；`PAYPAL_PLAN_ID_MONTHLY/YEARLY` 為
  07C.3 Sandbox 建立（digest 未變）。
- 前後端環境一致性：**MATCH（同為 Sandbox）**。
- → push main 將使公開網站對訪客提供 **Sandbox PayPal** 訂閱結帳：
  **Release Classification: SANDBOX_CODE_RELEASE_ONLY**，不得宣稱 Production Live。

## 11. 建議發布選項（等待人工批准，未自行執行）

- **A**：commit（僅 A 類清單）但不 push — 本機保存，公開站不變。
- **B（建議）**：commit 後 push 到不觸發 Pages 的 review branch（如 `release/auth-07c-sandbox`）—
  離機備份且公開站不變。
- **C**：等 Live PayPal 配置（Live Plan、Live Client ID、PAYPAL_ENV=live、webhook 重註冊）完成後再
  push main。

## 12. 聲明

本 Gate 未 commit、未 push、未切換 Live Secrets、未建立 Live PayPal Plan、未修改資料庫、
未部署 Function。

---

## Auth-07C.10 Result

```text
Auth-07C.10 Result:
Environment: sandbox (frontend config.js + backend PAYPAL_ENV both verified)
All 07C Gates: PASS (07C.1→07C.9 terminal states all PASS; 7C/7D diagnostic gates superseded by 7E/7F; SEC-01~01C PASS)
Full Tests: 873/873 PASS
Required Files: 53 (7 tracked modified + ~46 untracked; category A list in review doc)
Excluded Files: categories B(pending SEC review update)/C(3+1)/D(11)/E(harnesses+jsonl+real-creds txt+.temp)/F(=)
Unknown Files: 1 ("=" 0-byte stray; excluded, not deleted)
Pending Migrations: 0 (local=remote through 20260910000200)
paypal-webhook Version: v8 (matches 07C.7F review)
paypal-subscription Version: v2 (matches 07C.7F/07C.8 review)
Verify JWT: ON (paypal-subscription/paypal-checkout); webhook gateway OFF by design, handler signature verify ON
Webhook Signature Verification: ON
Security Advisor: CLEAR (0 RLS-disabled public tables at DB catalog level)
Sandbox Subscription Final State: CANCELLED; paid_through 2026-10-07T10:00:00Z; slot OCCUPIED; release_after=paid_through; tx 1; signed cancel webhook SUCCESS; reconciliation resolved; access_blocked null
GitHub Pages Source: main branch (pages-build-deployment, auto on push — verified via run #509)
Push Main Deploys Public Site: YES
Public Frontend PayPal Environment: sandbox
Backend PayPal Environment: sandbox
Frontend/Backend Environment Match: MATCH
Recommended Release Option: B (review branch; A also safe) — awaiting approval
Commit Performed: NO
Push Performed: NO
Production Live Ready: NO (Sandbox-only configuration; Live plans/secrets not provisioned)
Gate: READY_FOR_RELEASE_APPROVAL
```

完成後停止。等待人工批准發布選項 A／B／C。
