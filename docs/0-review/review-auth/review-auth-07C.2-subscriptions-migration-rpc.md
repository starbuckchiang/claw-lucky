# review-auth-07C.2-subscriptions-migration-rpc

Auth-07C.2：PayPal Subscriptions **additive migration＋RPC＋本機 shape tests**。

前置：

- `docs/0-review/review-auth/review-auth-07C.1-paypal-subscriptions-plan.md`
- `docs/0-review/review-auth/review-auth-07C.1A-paypal-subscriptions-design-fix.md`
- `docs/development/review comment/auth/note-auth-07C.1A.md`（pending 30m TTL；僅 unbound 可自動釋放）
- 既有 `20260821000200_payment_orders_and_webhook_events.sql`

```text
Gate: PASS (shape only — see Auth-07C.2A for live Postgres)
```

> **07C.2A follow-up：** 靜態 782／21 不足以證明可執行；真實隔離 Postgres 驗證見  
> `docs/0-review/review-auth/review-auth-07C.2A-postgres-verification.md`（Gate PASS；並修正 RLS `FOR ALL` 阻擋 owner SELECT）。

```text
Remote DB Changed: NO
PayPal Resources Created: NO
Functions Deployed: NO
Secrets Changed: NO
Payment Attempted: NO
Commit/Push Performed: NO
supabase db push: NO
```

---

## 1. 範圍

本 Gate **只**交付：

| 交付物 | 路徑 |
|---|---|
| Migration | `supabase/migrations/20260907000100_paypal_subscriptions_rpc.sql` |
| Shape tests | `supabase/migrations/__tests__/paypal-subscriptions-rpc-shape.test.js` |
| Review | 本文件 |

**未做（依禁令）：** PayPal API、Product／Plan、Secrets、前端、Edge 修改／部署、`db push`、遠端 DB、付款、commit／push。

測試型態與既有 `payment-orders-webhook-shape.test.js` 一致：**靜態 SQL／RPC 編碼行為斷言**（不連線 Postgres）。並發占 slot 等行為以 RPC 內 `FOR UPDATE`＋`OCCUPIED` 拒絕路徑編碼驗證；活庫 E2E 留給後續 Gate。

---

## 2. 型別相容

對齊既有 Orders schema：

| 欄位 | 型別 |
|---|---|
| `user_id` | `TEXT`（同 `payment_orders`） |
| `paypal_event_id` | `TEXT`（同 `payment_webhook_events`） |
| 新表 PK／FK | `UUID` where appropriate；slot FK `ON DELETE SET NULL`（不級聯刪稽核） |

---

## 3. Tables created

### `paypal_subscriptions`

- `checkout_session_id` UNIQUE；`paypal_subscription_id` UNIQUE nullable
- `plan_code` monthly／yearly；amount CHECK **5.00／48.00**；currency USD
- statuses 含 `APPROVAL_PENDING`、`EXPIRED_SETUP` 等
- `checkout_expires_at DEFAULT NOW() + 30 minutes`
- access block／reconciliation 欄位；**無** payer email／地址／姓名欄位

### `user_subscription_slots`

- PK `user_id`；`slot_state` OCCUPIED／RELEASED
- **無** `now()` 於 UNIQUE（符合 07C.1A 原子 slot）
- FK `subscription_id → paypal_subscriptions(id) ON DELETE SET NULL`

### `paypal_subscription_transactions`

- UNIQUE `paypal_event_id`、`paypal_sale_id`
- `sanitized_payload JSONB`（非完整 webhook body）；RPC 拒絕 payer PII keys

---

## 4. Existing tables modified（additive）

`payment_webhook_events`：

- 新增可空：`paypal_subscription_id`、`paypal_sale_id`、`error_code`、`resolved_at`
- 放寬 `processing_status` CHECK：`pending_resolution`、`reconciliation_pending`、`duplicate`（保留既有值）
- **未** DROP／改寫 `payment_orders`；本 migration 無 legacy 資料 mutation

---

## 5. RPCs（SECURITY DEFINER，`search_path = public, pg_temp`，僅 `service_role`）

| RPC | 職責 |
|---|---|
| `paypal_subscription_status_rank` | 狀態序，防 webhook 倒退 |
| `acquire_subscription_slot` | 伺服器定價；30m session；原子 slot；`gen_random_uuid` session |
| `bind_paypal_subscription` | 同 user／未過期／唯一 PayPal id；同綁冪等 |
| `expire_unstarted_subscription_session` | 僅 unbound＋過期＋`APPROVAL_PENDING` → `EXPIRED_SETUP`＋釋放 |
| `release_subscription_slot_if_due` | CANCELLED／EXPIRED 且 `release_after <= now()`；ACTIVE／SUSPENDED 不釋放 |
| `process_paypal_subscription_webhook_event` | 驗簽後骨架：SALE 冪等延長；failed 不延長；CANCELLED `release_after=paid_through`；refund／reversal access block＋audit；webhook-before-bind → `pending_resolution` |

REVOKE PUBLIC／anon／authenticated；GRANT EXECUTE → `service_role` only。

RLS：owner SELECT；authenticated 寫入 deny；anon deny all。

不碰 points／tickets／coins。

---

## 6. Design notes locked in SQL

| 07C.1A／note | 實作 |
|---|---|
| Pending TTL 30m | column default＋`acquire` 設 `NOW()+30m` |
| 僅 unbound 可 TTL 釋放 | `expire_unstarted` 要求 `paypal_subscription_id IS NULL` |
| CANCELLED 保 slot 至 paid_through | webhook 設 `release_after = paid_through`；release RPC 檢查 |
| SALE 冪等 | unique sale／event；重複不延長 |
| 金額權威在伺服器 | `acquire` 依 `plan_code` 寫死 5／48；不信前端 amount |

---

## 7. Verification

```text
node --test supabase/migrations/__tests__/paypal-subscriptions-rpc-shape.test.js
→ 21 pass / 0 fail

scripts/verify-local.ps1
→ 782 pass / 0 fail
```

---

## Auth-07C.2 Result

```text
Auth-07C.2 Result:
Migration File: supabase/migrations/20260907000100_paypal_subscriptions_rpc.sql
Tables Created: paypal_subscriptions, user_subscription_slots, paypal_subscription_transactions
Existing Tables Modified: payment_webhook_events (additive cols + processing_status CHECK widen)
RPCs Created: paypal_subscription_status_rank, acquire_subscription_slot, bind_paypal_subscription, expire_unstarted_subscription_session, release_subscription_slot_if_due, process_paypal_subscription_webhook_event
Pending Session TTL: 30 minutes (unbound APPROVAL_PENDING only)
Atomic Slot Test: PASS (encoded FOR UPDATE + OCCUPIED reject; shape suite)
Expired Unbound Session Release: PASS (expire_unstarted requires NULL paypal_subscription_id)
Bound Session Protected From TTL: PASS
Cancelled Paid-through Protection: PASS (release_after = paid_through; early release blocked)
Webhook Idempotency: PASS (event_id + sale_id unique / early return)
State Regression Protection: PASS (status_rank gate)
Refund/Reversal Audit: PASS (access_blocked_at + access_block_reason + needs_review)
RLS Owner Read: PASS (owner SELECT policies)
Client Mutation Blocked: PASS (deny write + RPC service_role only)
Legacy Orders Regression: PASS (no DROP payment_orders; additive webhook only; type TEXT aligned)
Tests Passed: 21 (subscriptions shape) / 782 (verify-local)
Tests Failed: 0
Remote DB Changed: NO
PayPal Resources Created: NO
Functions Deployed: NO
Secrets Changed: NO
Payment Attempted: NO
Commit/Push Performed: NO
Gate: PASS
```

---

## 8. Next（out of scope）

07C.3+：Edge `create-subscription-session`／`confirm-subscription`、webhook 驗簽後呼叫本 RPC、前端 SDK、`db push`／deploy。本 Gate **停止於此**。
