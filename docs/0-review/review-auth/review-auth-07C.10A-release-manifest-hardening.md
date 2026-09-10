# review-auth-07C.10A-release-manifest-hardening

Auth-07C.10A：Sandbox Release Manifest Hardening（Option B 準備）。

前置：`docs/0-review/review-auth/review-auth-07C.10-sandbox-final-release-preflight.md`

```text
Gate: READY_FOR_BRANCH_RELEASE
Release Option: B
Target Branch: release/auth-07c-sandbox
```

```text
Commit Performed: NO
Push Performed: NO
Branch Created: NO
db push: NO
Deployment: NONE
Sensitive File Deleted: NO（僅 ignore＋回報）
```

---

## 1. scripts/auth-07c*/ 逐檔重新分類（31 檔）

### A. REPRODUCIBLE_TEST_SOURCE（20 檔 — 納入 commit）

| 檔案 | 用途 |
|---|---|
| auth-07c2a-local-pg/{00-bootstrap,10-seed-legacy,30-behavior-tests}.sql＋run.ps1 | 07C.2A 本機 Docker Postgres 行為驗證 |
| auth-07c3-sandbox-product-plans/run.cjs | 07C.3 Product/Plan 建立 harness |
| auth-07c5-release/{smoke,smoke2,update-webhook-events}.cjs | 07C.5 release smoke |
| auth-07c7-monthly-e2e/precheck.cjs | 07C.7 precheck |
| auth-07c7b-paid-through-diag/run.cjs | 07C.7B 診斷 |
| auth-07c7c-sale-webhook-audit/run.cjs | 07C.7C 稽核 |
| auth-07c7d-edge-forensic/fetch-logs.cjs | 07C.7D 取證 |
| auth-07c7e1-local-pg/{00,10,20,30}*.sql＋run.ps1 | 07C.7E.1 本機 Postgres 驗證 |
| auth-07c7f-release/release.cjs | 07C.7F release＋reconciliation |
| auth-07c8-cancel-e2e/verify.cjs | 07C.8 取消後唯讀驗證 |
| auth-07c9-expiry/fixture.sql | 07C.9 BEGIN..ROLLBACK fixture |

Secret 掃描（20 檔）：29 hits **全為安全值** —
本機 Docker 拋棄式密碼 `PGPASSWORD=localtest`（僅本機容器）、公開 `sb_publishable_` key
（config.js 已公開）、`crypto.randomBytes()` runtime 隨機密碼（非儲存憑證）。
無真實 Email／JWT／token／Secret／完整 UID（僅 `5020bf33` 遮罩 prefix 常數，符合遮罩慣例）。
無改名藏敏感值情事。

### B. GENERATED_EVIDENCE（11 檔 — 不 commit，已加 gitignore）

`*.jsonl` ×6（07c3/07c5×3/07c7f/07c8）、`*.out` ×5（07c2a×2、07c7e1×3）。

### C. SENSITIVE（scripts/ 內 0 檔）

無 storage-state、browser profile、credential artifacts。

### D. UNKNOWN（0 檔）

## 2. 真實憑證檔防護

`docs/0-working-prompts/prompts-auth/paypel測試用帳號.txt`（**未讀取內容**）：

| 檢查 | 結果 |
|---|---|
| `git ls-files`（tracked？） | **NO**（空輸出） |
| staged？ | **NO** |
| `git log --all -- <path>`（history？） | **NO**（從未進過 history）→ 無需輪替、無需改寫 history |
| 名稱相近憑證檔 | 無（status 掃描 帳號/credential/password/secret/token 無其他命中） |
| `.gitignore` 精確規則後 `git check-ignore` | **MATCHED（exit 0）** |

**Sensitive Local File Still Present: YES** — 檔案仍在本機工作樹（依指示未刪除）。
提醒：測試全部完成後請自行安全移出 repository 或刪除。

`.gitignore` 新增（先檢查現有規則無重複；未誤傷合法 JSON fixture — `package.json` 等
check-ignore exit 1 驗證）：

```text
docs/0-working-prompts/prompts-auth/paypel測試用帳號.txt
scripts/auth-07c*/**/*.jsonl + scripts/auth-07c*/*.jsonl
scripts/auth-07c*/**/*.out   + scripts/auth-07c*/*.out
scripts/auth-07c*/**/storage-state*.json
scripts/auth-07c*/**/browser-profile/
supabase/.temp/
```

驗證：credential txt／verify.jsonl／run-console.out 皆 ignored；
harness sources（fixture.sql／verify.cjs／run.ps1）皆 **NOT** ignored（exit 1）。
註：`supabase/.temp/cli-latest` 已被 track，ignore 規則只防未來新檔 — staging 時仍須手動排除。

## 3. 精確 AUTH_07C_REQUIRED 清單

完整逐檔清單（**94 項**，每檔 path／tracked 狀態／用途／掃描結果）已寫入
**`scripts/auth-07c10a-release/manifest.txt`**（本身為第 94 項；本 review 為第 95 項候選）。
結構：tracked-modified 8（含 `.gitignore` 本次安全規則）＋config.toml 1＋前端服務與測試 7＋
shared handlers/lib twins/測試 12＋Edge entrypoints 3＋migrations與shape tests 6＋
harness sources 20＋review docs 36（07 系列 35＋本文件）＋note-auth-07C.1A 1。

排除（同 07C.10 分類，經本次強化）：generated evidence 11、credential txt、
`supabase/.temp/cli-latest`、Support-01（4）、05C／gift 等不相關（11）、0-byte `=`、
其餘 prompt 檔、SEC-01C review 的 pending 更新（屬 SEC 系列另行處理）。

## 4. 相依性完整性（乾淨 checkout 驗證）

- 方法：`git worktree add`（detached HEAD `8c25e5f`）→ 只覆蓋 manifest 93 檔
  （94 減本 review — 當時尚未寫成）→ 於 worktree 執行完整測試 → `git worktree remove`。
- **未複製 `.env`**（worktree 內 `Test-Path .env` = False）；未複製任何 Secret。
- 結果：**873/873 PASS** — 候選 manifest 疊在 HEAD 上自足，無缺檔、
  無依賴未提交 local-only 檔案；verify-local 引用的所有 node --check 目標與測試 glob 全數在內。
- 需 Secret 的真實 E2E 未於此重跑（僅 mock／local 全套，依指示）。

## 5. 測試

```text
主工作樹 pwsh -File scripts/verify-local.ps1 → 873/873 PASS
乾淨 worktree（無 .env）      → 873/873 PASS
git diff --check → clean
git check-ignore credential txt → MATCHED
```

## 6. 發布方案（鎖定，未執行）

Release Option: **B**；Target Branch: **release/auth-07c-sandbox**；
Push Main: NO；GitHub Pages Deployment: NO；Production Live Deployment: NO。
本階段未建立 branch、未 commit、未 push。

---

## Auth-07C.10A Result

```text
Auth-07C.10A Result:
Release Option: B
Target Branch: release/auth-07c-sandbox
Exact Included Files: 95 (94-line manifest at scripts/auth-07c10a-release/manifest.txt + this review; per-file listing therein)
Exact Excluded Files: 11 generated evidence (.jsonl/.out) + credential txt + supabase/.temp/cli-latest + Support-01 (4) + unrelated 05C/gift (11) + "=" + prompt files + pending SEC-01C review update
Reproducible Harness Sources Included: 20 (.cjs/.sql/.ps1 — all secret-scanned clean)
Generated Evidence Excluded: 11 (6 .jsonl + 5 .out; now gitignored)
Sensitive File Tracked: NO
Sensitive File In Git History: NO
Sensitive File Ignored: YES (git check-ignore MATCH)
Credential Rotation Required: NO (never entered history)
Clean Checkout Dependency Test: PASS (worktree at HEAD + manifest overlay, no .env → 873/873)
Full Tests: 873/873 PASS (main tree AND clean worktree)
Push Main: NO
GitHub Pages Deployment: NO
Commit Performed: NO
Push Performed: NO
Gate: READY_FOR_BRANCH_RELEASE
```

完成後停止。等待批准後才建立 `release/auth-07c-sandbox`、commit manifest 檔案並 push。
