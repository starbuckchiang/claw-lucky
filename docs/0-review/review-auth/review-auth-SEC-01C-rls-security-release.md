# review-auth-SEC-01C-rls-security-release

Auth-SEC-01C：RLS Security Hotfix Repository Release（SEC-01／01A／01B 成果保存至 Git）。

前置：

- `docs/0-review/review-auth/review-auth-SEC-01-public-rls-audit.md`
- `docs/0-review/review-auth/review-auth-SEC-01A-prompt-versions-rls-fix.md`
- `docs/0-review/review-auth/review-auth-SEC-01B-generation-cost-config-rls-fix.md`

```text
Gate: PASS
```

```text
Database Changed During Release: NO
Database Push Performed: NO
Functions Deployed: NONE
Secrets Changed: NO
Force Push Used: NO
```

---

## 1. Preflight

| 檢查 | 結果 |
|---|---|
| Repository | `claw-lucky`（origin = github.com/starbuckchiang/claw-lucky） |
| Branch | `main`（預期發布分支） |
| `git diff --check` | clean（exit 0） |
| Migration `20260910000100` | local = remote（一致） |
| Migration `20260910000200` | local = remote（一致） |
| Pending migrations | **0** |
| 完整測試（`pwsh -File scripts/verify-local.ps1`） | **868 pass / 0 fail** |
| Security Advisor 條件（DB catalog） | public schema RLS-disabled 一般資料表 = **0**（`rls_disabled_in_public` 條件已於資料庫層清除；Dashboard 顯示可能有掃描延遲，如實區分） |
| 本 Gate 未執行 `db push`、未改 remote DB | 確認（僅唯讀 catalog 查詢） |
| 其他工作樹修改 | 全部保留，未還原／覆蓋 |

## 2. 提交範圍（僅核准清單＋本 review）

實際檔案路徑與核准清單完全一致（無路徑差異）：

```text
supabase/migrations/20260910000100_prompt_versions_server_only_rls.sql
supabase/migrations/20260910000200_generation_cost_config_server_only_rls.sql
supabase/migrations/__tests__/prompt-versions-server-only-rls-shape.test.js
supabase/migrations/__tests__/generation-cost-config-server-only-rls-shape.test.js
docs/0-review/review-auth/review-auth-SEC-01-public-rls-audit.md
docs/0-review/review-auth/review-auth-SEC-01A-prompt-versions-rls-fix.md
docs/0-review/review-auth/review-auth-SEC-01B-generation-cost-config-rls-fix.md
docs/0-review/review-auth/review-auth-SEC-01C-rls-security-release.md   ← 本文件（commit 前建立並納入）
```

逐一 `git add -- <file>`（未使用 `git add .`／`-A`／`commit -a`）。

## 3. Staged diff 檢查

- `git diff --cached --name-only` = 上列 8 檔，無其他。
- 兩個 migration 內容僅 `ENABLE ROW LEVEL SECURITY` ＋ `REVOKE ... FROM anon, authenticated`；
  無資料 mutation、無 `CREATE POLICY`、無 `USING (true)`、無 GRANT 給 anon/authenticated、無停用 RLS。
- PII／secret 掃描（email／`eyJ` JWT／service-role key／known real UIDs／client secret／IP patterns）：**0 hits**。
- Auth-07C.8、Support-01、其他 Agent 的未完成修改（含 `.env.example`、`config.js`、
  `subscription.*`、`js/user.js` 等 modified 檔與大量 untracked 檔）皆**未**暫存。

## 4. Commit / Push

- Commit message：`fix: secure server-only wallpaper tables with RLS`
- Commit hash／push 結果／GitHub 驗證：見 Auth-SEC-01C Result（實際值於 commit/push 後補入最終輸出）。
- 未使用 force push；push 目標 `origin HEAD`（main）。

## 5. 聲明

1. 本 Gate 未執行 `supabase db push`（migration 早於 SEC-01A/01B Gate 經人工批准套用）。
2. 本 Gate 未部署任何 Edge Function。
3. 本 Gate 未修改任何 Secret。
4. 本 Gate 未修改任何資料列（僅唯讀 catalog 查詢）。
5. 工作樹其餘修改（Auth-07C 系列、Support-01 等）完整保留、未提交。
6. 本文件不含 Email、IP、JWT、token、Secret 或資料表內容。

## 6. Auth-07C.8

SEC-01 系列（audit → 01A → 01B → 01C release）全部完成後，**Auth-07C.8 可安全恢復**。
