# review-WEB-HOME-01C - Consent Feature Repository Release

日期：2026-09-12
分支：`release/auth-07c-sandbox`
狀態：**PASS - REPOSITORY RELEASED TO ISOLATED BRANCH**

## 結論

WEB-HOME-01A 至 01B.2 已驗證成果以 exact manifest 發布至 `release/auth-07c-sandbox`。核心 commit 為 `c175e6f1230b39307f083b455c3b366672648d18`，包含 55 個檔案；commit file set 與 manifest 精確一致，missing／extra／excluded 均為 0。

本階段只執行 repository release。未修改或 push `main`、未建立 PR、未部署 GitHub Pages、未操作 Production database 或 Function、未修改 Secrets、未呼叫 PayPal、未發送 OTP，也未建立 Subscription。

## Release identity

| 項目 | 結果 |
|---|---|
| Branch | `release/auth-07c-sandbox` |
| Branch head before | `5debb8cdc649cc3f757634d83cd5f2f8179a4a59` |
| Remote branch head before | `5debb8cdc649cc3f757634d83cd5f2f8179a4a59` |
| Origin main before | `8c25e5feefe5e0008ead1e543d64674047d2d3e8` |
| Core commit | `c175e6f1230b39307f083b455c3b366672648d18` |
| Core commit message | `feat: persist legal consent before account upgrade and subscription` |
| Manifest files | 55 |
| Core commit files | 55 |
| Exact set equality | PASS |

Manifest：`scripts/web-home-01c-release/manifest.txt`。所有路徑均逐檔 stage；未使用 `git add .` 或 `git add -A`。

## Verification

- `npm run verify-local`：942 passed、0 failed。
- Clean rebuild：兩次 PASS。
- Catalog fingerprint：`54262b0465445c0d9a87d3e50d9a2ea1`，兩次 clean rebuild 與 production-shaped convergence 一致。
- Order-number concurrency：24/24 PASS。
- Consent PostgreSQL runtime：PASS。
- Local consent-ops JWT E2E：無 JWT 401、invalid JWT 401、valid JWT 200；JWT user match、server time、policy version/hash、idempotency、field injection rejection、waiver rejection及 response leakage checks均 PASS。
- Production-shaped convergence：PASS。
- `git diff --cached --check`：PASS。
- Clean detached-worktree manifest overlay：55-file candidate set自足，verification PASS。

WEB-HOME-01B.2 的真實 isolated Sandbox E2E維持 PASS：`consent-ops` v1、`verify_jwt=true`、valid JWT 200、cross-user read 0 rows、direct INSERT／UPDATE／DELETE 403／403／403、account-upgrade與checkout gates均 PASS，且未送 OTP、未呼叫 PayPal、未建立 Subscription。

## Release hygiene

初次 cached diff check 找到 8 個 review Markdown檔案中的 16 行 trailing whitespace。修正僅移除該 16 行尾端 space；驗證為 16 additions／16 deletions、忽略行尾空白後差異為 0，Markdown非空白內容變更為 0。

PasswordAssignment scanner 的 7 個 findings逐項分類如下；未輸出任何值：

| File | Line | Classification | Remote-capable | Hardcoded real credential | Logged or persisted |
|---|---:|---|---|---|---|
| `scripts/web-home-01b1-local-pg/function-e2e.cjs` | 43 | `RUNTIME_RANDOM_TEST_PASSWORD` | NO | NO | NO |
| `scripts/web-home-01b1-local-pg/function-e2e.cjs` | 48 | `RUNTIME_RANDOM_TEST_PASSWORD` | NO | NO | NO |
| `scripts/web-home-01b1a-baseline-audit/run.ps1` | 33 | `LOCAL_DISPOSABLE_DOCKER_PASSWORD` | NO | NO | NO |
| `scripts/web-home-01b1a-baseline-audit/run.ps1` | 46 | `LOCAL_DISPOSABLE_DOCKER_PASSWORD` | NO | NO | NO |
| `scripts/web-home-01b1a-baseline-audit/run.ps1` | 54 | `LOCAL_DISPOSABLE_DOCKER_PASSWORD` | NO | NO | NO |
| `scripts/web-home-01b1a-baseline-audit/run.ps1` | 68 | `LOCAL_DISPOSABLE_DOCKER_PASSWORD` | NO | NO | NO |
| `scripts/web-home-01b1a-baseline-audit/run.ps1` | 77 | `LOCAL_DISPOSABLE_DOCKER_PASSWORD` | NO | NO | NO |

Runtime password由安全隨機方式在 process memory生成，只用於 localhost測試使用者，未寫入 log、review或artifact。Docker password只用於綁定 `127.0.0.1` 的 disposable local container；不是 remote Supabase、Production或Sandbox credential，container由 harness移除。

- Real Credential Matches：0。
- Secret Scanner Disabled：NO。
- Global Allowlist Added：NO。
- Full Sandbox project ref、test UUID、JWT、Supabase key、database connection string、PayPal Secret及raw dump：未提交。

## Remote and safety verification

- Core push target只有 `origin/release/auth-07c-sandbox`，未使用 force。
- `origin/main` 保持 `8c25e5feefe5e0008ead1e543d64674047d2d3e8`，與 release前一致。
- Release branch push沒有觸發 GitHub Pages Production deployment。
- Workspace linked project digest仍為 Sandbox `655ece1d`；本階段未切換 linked target。
- Production database mutated：NO。
- Production Function deployed：NO。
- Secrets changed：NO。
- PayPal called：NO。
- Excluded files committed：NO。

## Final result

```text
WEB-HOME-01C Result: PASS
Branch: release/auth-07c-sandbox
Branch Head Before: 5debb8cdc649cc3f757634d83cd5f2f8179a4a59
Manifest Files: 55
Tests Passed: 942
Tests Failed: 0
Clean Rebuild: PASS - two rebuilds
Catalog Fingerprint: 54262b0465445c0d9a87d3e50d9a2ea1
Consent Runtime: PASS
Sandbox E2E: PASS
Sensitive Scan: PASS - 0 real credentials; 7 benign test-only findings
Core Commit: c175e6f1230b39307f083b455c3b366672648d18
Core Commit Files: 55 - exact manifest
Origin Main Before: 8c25e5feefe5e0008ead1e543d64674047d2d3e8
Origin Main Changed: NO
GitHub Pages Triggered: NO
Production Database Mutated: NO
Production Function Deployed: NO
Supabase Linked Target: SANDBOX - digest 655ece1d
PayPal Called: NO
Secrets Changed: NO
Excluded Files Committed: NO
Gate: PASS
```

下一階段為 WEB-HOME-01D Production Database Preflight；本任務完成後停止，不啟動該階段。