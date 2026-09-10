# review-auth-07C.2A-postgres-verification

Auth-07C.2A：Subscriptions migration／RPC **真實 PostgreSQL** 驗證（隔離本機 Docker）。

前置：`docs/0-review/review-auth/review-auth-07C.2-subscriptions-migration-rpc.md`

```text
Gate: PASS
```

```text
Database Target: LOCAL_ISOLATED
Remote Host Used: NO
Remote DB Changed: NO
PayPal Resources Created: NO
Functions Deployed: NO
Secrets Changed: NO
Payment Attempted: NO
Commit/Push Performed: NO
supabase db push: NO
```

---

## 1. 安全確認

| 項目 | 值 |
|---|---|
| Engine | Docker `postgres:16-alpine` container `claw-lucky-07c2a-pg` |
| Bind | **127.0.0.1:55432** only（非 0.0.0.0） |
| Credentials | 本機一次性 `postgres`／`localtest`（非 production／staging） |
| Supabase link / `--linked` | **未使用** |
| Remote Supabase host | **未連線** |

若 Docker 無法啟動 → 應判定 `BLOCKED_LOCAL_DB`；本次可啟動，故繼續。

Harness：`scripts/auth-07c2a-local-pg/`（bootstrap＋seed＋behavior SQL＋`run.ps1`）。  
驗證結束後已 `docker rm -f` 容器。

---

## 2. Migration 執行

1. Bootstrap：Supabase-like roles（`anon`／`authenticated`／`service_role BYPASSRLS`）、`request_user_key` 依賴之 JWT GUC、`storage.*` stub、production-shaped base tables（`users` 等，因 repo migrations 不建立這些表）。
2. 依檔名順序套用 **全部** `supabase/migrations/*.sql`（25 檔）。
3. 在 `20260821000200` 之後、`20260907000100` 之前插入 legacy `payment_orders`／`payment_webhook_events` seed。
4. 套用 `20260907000100_paypal_subscriptions_rpc.sql` → 成功。
5. **再執行一次** 同 migration → 成功（`IF NOT EXISTS`／`CREATE OR REPLACE`／policy DROP+CREATE 冪等）。
6. Legacy seed 行在行為測試與 re-run 後仍完整（`paid`／`processed`／wallet 100/7/33）。

---

## 3. 本 Gate 對尚未上線 migration 的修正

真實 RLS 測試暴露缺陷：authenticated **RESTRICTIVE `FOR ALL` + `USING (false)`** 會 AND 掉 owner SELECT。

已在 **同一未部署** migration 修正（不新增補丁 migration）：

- 改為 wallpaper 風格：`FOR INSERT`／`UPDATE`／`DELETE` 分開 deny
- `GRANT SELECT` 給 `authenticated`（三張新表）
- Shape test 同步更新

---

## 4. RPC／RLS 真實結果（34／34）

| 檢查 | 結果 |
|---|---|
| Concurrent same-user acquire（dblink 雙連線） | PASS → 一成功／一 `SUBSCRIPTION_SLOT_OCCUPIED` |
| Different-user acquire | PASS |
| Idempotent bind | PASS |
| Cross-user bind rejected | PASS |
| Duplicate PayPal ID rejected | PASS |
| Expired unbound released | PASS |
| Bound pending protected from TTL | PASS |
| Cancelled paid-through protected／due released | PASS |
| ACTIVE／SUSPENDED not released | PASS |
| Webhook event idempotency | PASS |
| Sale idempotency | PASS |
| Failed payment no extend | PASS |
| State regression protection | PASS |
| Refund／reversal access block + audit | PASS |
| Owner SELECT | PASS |
| Cross-user SELECT blocked | PASS |
| Anon／authenticated mutation blocked | PASS |
| RPC EXECUTE restricted；service_role allowed | PASS |
| SECURITY DEFINER `search_path=public, pg_temp` | PASS（5 mutation RPCs） |
| Legacy Orders + wallet untouched | PASS |

時間控制：以 `UPDATE ... checkout_expires_at`／`release_after`／`paid_through` 模擬，**未**依賴不穩定 sleep 作為通過條件。

---

## 5. SECURITY DEFINER／user_id 信任邊界（文件鎖定）

Mutation RPCs（`acquire_subscription_slot`、`bind_paypal_subscription`、…）接受 `p_user_id` 參數且僅 `service_role` 可 EXECUTE。

**不得**由 browser 直接呼叫。  
**必須**由 JWT 保護的 Edge Function 先核對 `auth.uid()`／official user，再傳入已驗證的 user id。  
本 Gate 不部署 Edge；此契約留給 07C.3+。

---

## 6. Schema 抽樣

- UNIQUE／CHECK／indexes 存在（subscriptions、transactions、webhook CHECK 含 `pending_resolution`）
- 舊 `processing_status='processed'` legacy 列仍合法
- `sanitized_payload` PII key 拒絕在 RPC 執行期驗證（非無法執行的 JSON schema 幻想）
- points／tickets／coins 全程未變

---

## Auth-07C.2A Result

```text
Auth-07C.2A Result:
Database Target: LOCAL_ISOLATED
Remote Host Used: NO
All Prior Migrations Applied: YES (25)
Subscription Migration Applied: YES
Legacy Seed Preserved: YES
Migration Re-run Handling: SAFE_IDEMPOTENT (re-applied successfully)
Concurrent Same-user Acquire: PASS
Different-user Acquire: PASS
Idempotent Bind: PASS
Cross-user Bind Rejected: PASS
Duplicate PayPal ID Rejected: PASS
Expired Unbound Released: PASS
Bound Pending Protected: PASS
Cancelled Paid-through Protected: PASS
Webhook Event Idempotency: PASS
Sale Idempotency: PASS
State Regression Protection: PASS
Refund/Reversal Audit: PASS
Owner SELECT: PASS
Cross-user SELECT Blocked: PASS
Anon Mutation Blocked: PASS
Authenticated Mutation Blocked: PASS
RPC Execute Restricted: PASS
Security Definer Search Path: PASS
Tests Passed: 34 (Postgres behavior) + shape suite
Tests Failed: 0
Migration Files Changed: YES (20260907000100 RLS FOR ALL→per-command + GRANT SELECT; shape test update)
Remote DB Changed: NO
PayPal Resources Created: NO
Functions Deployed: NO
Secrets Changed: NO
Payment Attempted: NO
Commit/Push Performed: NO
Gate: PASS
```

---

## 7. Stop

本 Gate 完成。**不得** `db push`／deploy／PayPal／commit。  
下一步屬 07C.3+（Edge session／confirm／webhook）。
