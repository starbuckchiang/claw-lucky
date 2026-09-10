# review-auth-07A.3-final-hotfix

Auth-07A.3：Create-order concurrency + state-tests hotfix（依 07A.2 缺口）。

```text
Gate: READY_FOR_FINAL_PREFLIGHT
```

```text
Code/migration/config modified this Gate: YES (checkout handler JS+TS + tests only)
Migration 20260821000200 remote: NO (local-only confirmed)
db push: NO
functions deploy: NO
secrets set: NO
PayPal HTTP: NO
git add/commit/push: NO
```

即使 Gate 為 READY，本 Gate 要求**停止、不得部署或設定 secrets**。

---

## Preflight

| 檢查 | 結果 |
|---|---|
| `20260821000200` local-only | **PASS**（`migration list`：local 有、remote 空） |
| 未改六項 COMPLETED validation | PASS |
| 未改 webhook 驗簽／HTTP 200／503 | PASS |
| 未改 RPC grants、RLS、15 分 TTL | PASS（migration 未動） |
| 未碰 subscription-checkout／Auth／gift／gacha／wallet／merge／entitlements | PASS |
| JS／TS twin 一致 | PASS |
| `.\scripts\verify-local.ps1` | **746 / 746 passing** |

---

## 一、Create-order unique race

### 實作

- 新增統一 helper：`createPaymentOrderHandlingRace` + `isOneOpenUniqueViolation`
- **第一次**與 `:n:` 重試的 `createPaymentOrder` 皆走同一路徑
- one-open unique violation → 重查 fresh open：
  - 有 `paypal_order_id` → 安全 reuse（200）
  - 尚無 `paypal_order_id` → **`ORDER_INITIALIZING`**（409，`retryable: true`），**不**回 generic `DB_ERROR` 503
- 僅 `create_request_id` 持有者可呼叫 PayPal Create
- PayPal Create 失敗／無 order id → internal order `transitionStatus(..., "failed")`；後續可新 request id 再建單

### 測試

| 案例 | 判定 |
|---|---|
| A 建 internal → B 撞 unique → B 不呼叫 PayPal → A 只 Create 一次 → B 重試同 `paypal_order_id` → 僅一筆 open | **PASS** |
| PayPal Create 失敗 → failed；同 key 重試可建新單 | **PASS** |

**判定：PASS**

---

## 二、狀態測試（真實 transition，非固定 stub）

In-memory `processWebhookEvent` 走 `memoryRepo.transitionStatus`（對齊 RPC 禁止倒退／終態規則）：

| 要求 | 判定 |
|---|---|
| paid → `CHECKOUT.ORDER.APPROVED` 不倒退 | **PASS**（狀態仍 `paid`） |
| paid → `PAYMENT.CAPTURE.PENDING` 不倒退 | **PASS** |
| refunded → `PAYMENT.CAPTURE.COMPLETED` 不回 paid | **PASS** |
| reversed → COMPLETED 不回 paid | **PASS** |
| denied 不重用 | **PASS**（獨立 seed `denied`） |
| failed 不重用 | **PASS** |
| `fail_stale` 只影響指定 `user_id` + `plan_code` | **PASS**（他戶／他 plan 仍 `created`） |

**判定：PASS**

---

## 三、範圍確認

- COMPLETED 六項 validation、webhook verify／200 rejected／503 DB：未改
- TTL 15 分、one-open index、RPC grants、RLS：migration 未改
- 停止於此 Gate：無 deploy／secrets／commit

---

## Gate

```text
READY_FOR_FINAL_PREFLIGHT
```

下一步應為獨立 final preflight recheck（唯讀）；**本 Gate 不得部署**。
