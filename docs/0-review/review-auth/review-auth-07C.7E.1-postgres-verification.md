# review-auth-07C.7E.1-postgres-verification

Auth-07C.7E.1：SALE Reconciliation Migration **真實 PostgreSQL** 驗證（隔離本機 Docker only）。

前置：`docs/0-review/review-auth/review-auth-07C.7E-sale-reconciliation-hotfix.md`

```text
Gate: PASS
```

```text
Database Target: LOCAL_ISOLATED
Remote Host Used: NO
Remote DB Changed: NO
Existing Real Subscription Changed: NO
Second Resend Performed: NO
Payment Attempted: NO
Subscription Cancelled: NO
Functions Deployed: NO
Commit/Push Performed: NO
supabase db push: NO
```

---

## 1. 安全確認

| 項目 | 值 |
|---|---|
| Engine | Docker `postgres:16-alpine` container `claw-lucky-07c7e1-pg` |
| Bind | **127.0.0.1:55433** only |
| Credentials | 本機一次性 `postgres`／`localtest` |
| Supabase link / `--linked` | **未使用** |
| Remote Supabase host | **未連線** |

Harness：`scripts/auth-07c7e1-local-pg/`（bootstrap＋legacy seed＋ACTIVE seed＋behavior SQL＋`run.ps1`）。  
驗證結束後已 `docker rm -f` 容器。

---

## 2. Migration chain

1. Bootstrap：Supabase-like roles、`request_user_key` 依賴、production-shaped base tables。  
2. 依檔名順序套用全部 `supabase/migrations/*.sql`（含至 `20260907000100`）。  
3. `20260821000200` 後插入 legacy Orders／Webhook seed。  
4. `20260907000100` 後插入 ACTIVE＋`paid_through=null` subscription seed（`I-RECON-1` 等）。  
5. 套用 `20260908000100_sale_reconciliation_hotfix.sql` → **成功**。  
6. **再執行一次** hotfix migration → **成功**（`IF NOT EXISTS`／`CREATE OR REPLACE` 冪等）。  
7. Legacy Orders／wallet（100／7／33）全程未變。

---

## 3. 本 Gate 對尚未部署 migration 的最小修正

真實 PG 暴露兩處缺陷，已直接修在未部署的 `20260908000100`：

1. **`finalize_paypal_webhook_event_failure`**：不得把已 `processed`／`duplicate`／`ignored` 倒退成 failed（回 `already_terminal`）。  
2. **`reconcile_paypal_subscription_sale`**：`RETURNS TABLE (... paid_through ...)` 與 `UPDATE ... paid_through = CASE WHEN paid_through ...` 名稱衝突 → 改 `UPDATE ... AS s` 並用 `s.paid_through`。

---

## 4. Behavior 結果（42／42）

| 區塊 | 結果 |
|---|---|
| ensure received + 同 event 冪等 | PASS |
| finalize failure 同列／error_code | PASS |
| finalize 不存在 event 不誤改 legacy | PASS |
| received → processed／failed | PASS |
| processed 不得 finalize／process 倒退 | PASS |
| reconcile success + next_billing → paid_through | PASS |
| duplicate sale／paid_through 只延長一次 | PASS |
| recon→webhook／webhook→recon 冪等 | PASS |
| 真實 webhook event 保留（duplicate） | PASS |
| synthetic `paypal_api_reconciliation:` 可區分；不偽造 webhook SUCCESS 列 | PASS |
| amount／currency mismatch 拒寫 | PASS |
| cross-subscription／owner mismatch | PASS |
| PII payload 拒絕 | PASS |
| anon／authenticated 無 EXECUTE；service_role 可 | PASS |
| Owner RLS／cross-user SELECT | PASS |
| SECURITY DEFINER `search_path` | PASS |
| Legacy Orders + wallet | PASS |

Harness 輸出：`scripts/auth-07c7e1-local-pg/last-run.out`／`behavior.out`。

---

## 5. verify-local

- Migration shape：含 finalize／ambiguity 斷言 → PASS  
- `scripts/verify-local.ps1` → **848／848** PASS  

---

## Auth-07C.7E.1 Result

```text
Auth-07C.7E.1 Result:
Database Target: LOCAL_ISOLATED (127.0.0.1:55433, postgres:16-alpine)
Remote Host Used: NO
All Prior Migrations Applied: YES
Hotfix Migration Applied: YES
Migration Re-run: YES (idempotent)
Legacy Seed Preserved: YES
Received Event Persist: PASS
Duplicate Event: PASS
Finalize Failure: PASS
Processed Event Regression: PASS (already_terminal)
Reconciliation Success: PASS
Duplicate Sale: PASS
Reconciliation Before Webhook: PASS
Webhook Before Reconciliation: PASS
Real Webhook Audit Preserved: PASS (duplicate status kept)
Synthetic Event Distinguished: PASS (paypal_api_reconciliation:{sale_id})
Paid-through Updated Once: PASS
Amount/Currency Mismatch: PASS
Cross-subscription Rejected: PASS
Pending/Failed Ignored: PASS (contract; no pending completed rows)
RPC Execute Restricted: PASS
Owner RLS: PASS
PII Protection: PASS
Postgres Tests Passed: 42
Postgres Tests Failed: 0
Verify-local: 848/848
Migration Changed: YES (undeployed 20260908000100 minimal fixes only)
Remote DB Changed: NO
Existing Real Subscription Changed: NO
Second Resend Performed: NO
Payment Attempted: NO
Subscription Cancelled: NO
Functions Deployed: NO
Commit/Push Performed: NO
Gate: PASS
```

完成後已停止；**不得** db push／部署，除非另開 Release Gate。
