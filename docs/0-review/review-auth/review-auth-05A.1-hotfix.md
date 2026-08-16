# P-AUTH-05A.1 Hotfix — `finalize_account_merge` 冪等授權漏洞 — Review

**狀態：修正 P-AUTH-05A-fix 版 `finalize_account_merge` 的一個真實授權漏洞。本階段仍然只交付
schema／SECURITY DEFINER function／契約文件，未實作 Begin/Finalize Edge Function 本體，未部署任何
migration。**

**Gate 用語變更（需求 8）**：本功能（P-AUTH-05 系列）自本文件起，**不再使用**先前 P-AUTH-04.x 系列
沿用的泛用「Gate 4」說法（那原本是 P-AUTH-04 訂閱 E2E 流程專屬的用語，套用在資料合併的資料庫安全
基礎建設上並不精確）。改用三個明確分開的關卡：

- **05A Design Gate**：schema／RLS／SECURITY DEFINER function 的**設計**是否安全、自洽（本次
  `20260816000000`～`20260816000400` migration + 靜態結構測試涵蓋的範圍）。
- **05B Implementation**：實際撰寫 Begin/Finalize Edge Function 本體（依本文件契約）。**本次未開始**。
- **05C Staging Gate**：在真實／staging Supabase 專案上，實際執行「真實 PostgreSQL 測試計畫」。
  **本次未執行**。

正式環境（Production）部署，需要 05A → 05B → 05C **依序全部通過**。本次工作僅針對 **05A Design
Gate** 的一個具體缺陷做修正，**05B／05C 皆未開始/未執行**。

## 根因：`finalize_account_merge` 的「冪等檢查」本身是一個授權繞過

`review-auth-05A-hotfix.md`（P-AUTH-05A-fix）版的 `finalize_account_merge(p_claim_token_hash,
p_existing_user_id, p_existing_user_email_hash, p_idempotency_key)` 雖然已經修正了「Email 綁定」與
「單一交易原子性」兩個問題，但**冪等檢查的執行順序**本身仍是一個問題：

```sql
-- 舊版（有問題）：冪等檢查在驗證 claim/Email 之前就執行
SELECT * INTO v_existing_request FROM account_merge_requests WHERE idempotency_key = p_idempotency_key;
IF FOUND THEN RETURN v_existing_request; END IF;
-- 之後才鎖定/驗證 claim、比對 Email...
```

`p_idempotency_key` 是**呼叫端（最終追溯到 HTTP request）提供**的參數。只要呼叫端能夠提供／猜到／
重放一個**曾經成功過的** `idempotency_key`，這個函式會在**完全沒有驗證這次呼叫是否真的持有對應
claim、Email 是否相符**的情況下，直接把當初那次合併的結果回傳——這代表：

- 冪等機制本身變成一個可被利用的「未經授權查詢/重放」通道。
- 更嚴重的是，如果攻擊者能操控/猜到 idempotency key，也可能造成不同 claim/使用者對之間的結果互相
  「借用」，即使實際上並沒有持有合法的 claim。

## 修正方式：Idempotency Key 改由資料庫自行計算，且移到驗證之後

### 1. Finalize API 不得接受前端提供的四項欄位（需求 1）
契約層（見下方「修訂版 Begin/Finalize Contract」）明確重申：Finalize 的 HTTP request body **絕不**
包含 `anonymousUserId`、`existingUserId`、`emailHash`、`idempotencyKey` 這四個欄位。`existingUserId`
與 email 一律由 `resolveAuthenticatedUser()` 從**已驗證的 Session** 取得；`anonymousUserId` 一律由
資料庫從 claim 列本身取得（見下）；`idempotencyKey` **整個從 RPC 參數中移除**（見下），前端/Edge
Function 都無法再提供它。

### 2. RPC 不得依呼叫端提供的 key 在驗證 claim 前回傳結果（需求 2）
修改 [supabase/migrations/20260816000400_account_merge_requests_and_finalize.sql](../../../supabase/migrations/20260816000400_account_merge_requests_and_finalize.sql)：
- `finalize_account_merge` 的參數從 4 個（含 `p_idempotency_key`）改為 **3 個**：
  `(p_claim_token_hash TEXT, p_existing_user_id TEXT, p_existing_user_email_hash TEXT)`——
  `p_idempotency_key` **完全移除**，不是「加驗證」，而是「這個攻擊面直接消失，因為函式簽章上已經沒有
  這個參數可以被呼叫端控制」。

### 3. 資料庫依 `claim.anonymous_user_id` 與 `existing_user_id` 自行產生 canonical key（需求 3）
函式內部新增：

```sql
v_canonical_idempotency_key := 'merge:' || v_claim.anonymous_user_id || ':' || p_existing_user_id;
```

且**執行順序改為**：

1. `SELECT ... FOR UPDATE` 依 `claim_token_hash` 鎖定 claim（找不到就拒絕）。
2. 比對 `v_claim.target_email_hash` 與呼叫端（已驗證 Session）算出的 `p_existing_user_email_hash`
   ——**這個比對對 `pending`／`used` 兩種狀態的 claim 都會執行**，不會被狀態分支跳過。
3. **只有到這裡**才計算 canonical idempotency key，並用它去查 `account_merge_requests`。

也就是說：**驗證 claim 與 Email 之前，函式不可能回傳任何結果**——即使呼叫端知道別人的 canonical key
長什麼樣子也沒用，因為 canonical key 從來不是呼叫端可以直接提供的參數。

### 4. 驗證 claim 與 Email 後才查 `account_merge_requests`（需求 4）
承上，`account_merge_requests` 的查詢移到 Email 比對**之後**：
- 找到 -> 回傳原本的 `mergeId`/`result_json`（同一個 canonical pair 的合法重送）。
- 沒找到且 claim 為 `pending` 且未過期 -> 執行實際合併。
- 沒找到但過期／非 `pending` -> 拒絕（維持既有行為）。

### 5. `used` 但查無對應 request 視為資料不一致並拒絕（需求 5）
新增分支：

```sql
IF v_claim.status = 'used' THEN
    RAISE EXCEPTION 'finalize_account_merge: claim is marked used but no matching completed request was found (data inconsistency)';
END IF;
```

理由：這個函式是**唯一**會把 claim 標記為 `used` 的地方，而且**必定**與寫入
`account_merge_requests` 同一個交易——如果查無對應 request 但 claim 卻是 `used`，代表某個不變量被
破壞（可能是其他程式碼誤寫、資料被手動改動等），此時**拒絕並報錯**遠比「假裝沒事、重新跑一次合併」
安全。

### 6. `result_json` 不儲存 Email／token hash／不必要個資（需求 6）
`result_json` 維持只包含 `cartMerged`／`mascotsMerged`／`redeemHistoryReassigned`／
`pointsTransferred`／`excludedV1` 這五個欄位（本來就沒有 email/token/hash，本次新增靜態測試明確
斷言這件事，防止未來不小心加進去）。

## 修改哪些檔案

- [supabase/migrations/20260816000400_account_merge_requests_and_finalize.sql](../../../supabase/migrations/20260816000400_account_merge_requests_and_finalize.sql)：
  - `finalize_account_merge` 簽章從 `(TEXT, TEXT, TEXT, TEXT)` 改為 `(TEXT, TEXT, TEXT)`（移除
    `p_idempotency_key`）。
  - 函式本體重新排序：鎖定 claim → Email 比對（不分狀態）→ 計算 canonical key → 查
    `account_merge_requests` → （若無)檢查狀態/過期 → 執行合併 → 標記 used + 寫入
    `account_merge_requests`（皆用 canonical key）。
  - 移除舊版「先查 `anonymous_user_id` 是否已合併過」的獨立檢查區塊——這個保護現在由 canonical key
    的計算方式（`anonymous_user_id` 一律來自 claim，非參數）與
    `account_merge_requests.anonymous_user_id` 的既有唯一約束自然涵蓋，不需要額外的獨立查詢。
  - `REVOKE`/`GRANT` 語句同步改為 3 參數簽章，僅 `service_role` 可執行。
  - 檔案開頭註解重寫，說明根因、修正後的驗證順序、併發語意（`FOR UPDATE` 鎖 + MVCC 保證併發重送
    安全）、以及新的三關卡（05A/05B/05C）框架。
- `supabase/migrations/__tests__/rls-policy-shape.test.js`：
  - 更新既有 `finalize_account_merge` 測試以符合新的 3 參數簽章與 REVOKE/GRANT 斷言。
  - 新增：函式簽章**明確沒有** `p_idempotency_key`（結構上就不可能被前端提供 key）。
  - 新增：canonical key 計算公式的斷言（`'merge:' || v_claim.anonymous_user_id || ':' ||
    p_existing_user_id`）。
  - 新增：驗證程式碼順序——`FOR UPDATE` 鎖定 → Email 比對 → 計算 canonical key → 冪等查詢，四者
    的**先後順序**都用字串出現位置斷言（`indexOf` 比較），直接對應需求 2/3 的「順序」要求。
  - 新增：Email 比對發生在**任何** `status` 分支判斷之前（確保對 `pending`/`used` 均一致套用）。
  - 新增：`status='used'` 且查無對應 request 時會 raise 例外（資料不一致保護）。
  - 新增：合法重送（idempotency 查詢命中）在**任何合併工作開始之前**就 `RETURN`。
  - 新增：`result_json` 的 `jsonb_build_object(...)` 內容**不含**任何符合 `email`/`token`/`hash`
    字樣的鍵值（PII 最小化）。
- `js/services/auth/account-merge-service.js`／`subscription-entry-guard.js`：**未修改**——見下方
  「為何前端層 `idempotencyKey` 概念維持不變」的說明。

未修改：任何方案/價格設定、資料庫 schema（未實際套用任何 migration）、RLS、既有公開 API。

## 為何前端層 `idempotencyKey` 概念維持不變（刻意決定，非遺漏）

`js/services/auth/account-merge-service.js` 的 `mergeAnonymousIntoExistingAccount({ idempotencyKey
})` 與 `subscription-entry-guard.js` 的 `buildMergeIdempotencyKey(anonymousUserId, existingUserId)`
**本次未修改**。這是刻意的：

- 這兩個模組目前完全沒有連到任何真正的 RPC（`mergeRpcClient` 預設為 `null`，一律回傳
  `MERGE_NOT_SUPPORTED`），屬於**尚未連接**的前端骨架，不是本次「`finalize_account_merge` 冪等
  授權問題」的根因所在。
- 未來 05B 實作 Edge Function 時，前端層的 `idempotencyKey` 概念可以繼續存在，但意義改為「**HTTP
  重試追蹤用途**」（例如前端自己判斷「這次點擊是否為短時間內的重複點擊」），**與資料庫內部的
  canonical idempotency key 是兩個不同層級的概念，兩者不衝突**：無論前端傳什麼樣的 HTTP 層追蹤值
  給 Edge Function，Edge Function 都**不會**把它轉發進 `finalize_account_merge`（該函式現在根本沒有
  對應參數可以接收），資料庫永遠自己算 canonical key。
- 若之後 05B 的 Edge Function 設計認為前端層的 `idempotencyKey` 已經沒有存在意義，應該在 05B 的
  Review 中另外處理，不在本次 05A.1 範圍內臆測。

## 修訂版 Begin/Finalize Merge Contract

延續 `review-auth-05A-hotfix.md` 的契約，本次僅修改 Finalize 呼叫 RPC 的方式：

### Begin Merge — 不變
與 `review-auth-05A-hotfix.md` 相同：驗證 `is_anonymous === true`、正規化+雜湊 Email、產生
`claim_token_hash`、呼叫 `create_account_merge_claim(...)`。

### Finalize Merge（修訂）
1. `resolveAuthenticatedUser(req)` 解析呼叫者自己（已登入既有帳號）的 Session。
2. 確認 `user.is_anonymous === false`；不是就回傳 `403 MERGE_REQUIRES_OFFICIAL_SESSION`。
3. 取用**這個 Session 自己的** `user.email`（絕不讀取 request body），正規化+雜湊得到
   `existing_user_email_hash`。
4. 對 request body 的 `claimToken` 雜湊得到 `claim_token_hash`。
5. **（修正）** 以 `service_role` 呼叫 `finalize_account_merge(claim_token_hash, existing_user_id,
   existing_user_email_hash)`——**只有這 3 個參數**，不再產生或傳遞任何 `idempotencyKey` 給這個
   RPC；canonical idempotency key 完全由資料庫內部計算。
6. 任何例外（claim 不存在／Email 不符／非 pending／已過期／`used` 但無對應 request 的資料不一致）
   一律翻譯成統一、不洩漏細節的錯誤碼，絕不重試/猜測。
7. 成功回傳 `{ ok: true, data: { merged: true, mergeId, result } }`（`result` 即
   `result_json`，不含 Email/token/hash）。

## 執行 `.\scripts\verify-local.ps1`

```
== Syntax Check ==  全數通過
== Unit Tests ==
ℹ tests 381
ℹ suites 0
ℹ pass 381
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
Verification Complete
```

新增/修改測試（`supabase/migrations/__tests__/rls-policy-shape.test.js`，均通過）：
- `finalize_account_merge: NEVER accepts a caller-supplied idempotency key — the function has
  exactly 3 parameters (no p_idempotency_key)`
- `finalize_account_merge: computes the canonical idempotency key itself from
  claim.anonymous_user_id + p_existing_user_id`
- `finalize_account_merge: locks the claim AND checks the email BEFORE computing/looking up the
  idempotency key`
- `finalize_account_merge: rejects when the caller's own email hash does not match ... applies to
  BOTH pending and used claims`
- `finalize_account_merge: treats status='used' with no matching account_merge_requests row as a
  data inconsistency and rejects`
- `finalize_account_merge: a resend for an already-completed canonical pair returns the stored
  request unchanged`
- `finalize_account_merge: result_json never stores an email, a token, or a token hash`
- （既有）`marks the claim used ... ONLY after every merge step`、`never touches
  orders/order_items/subscriptions/logs`、`transfers points via apply_point_transaction`、
  `uses ON CONFLICT (user_id, mascot_id)` 等維持通過。

**限制重申**：以上仍是靜態 SQL 文字結構斷言，不是真實 PostgreSQL 執行結果——見下方「05C Staging
Gate」測試計畫，本次尚未執行任何一項。

## 補測對照表（需求 7）

| 需求 7 情境 | 對應測試/設計 |
|---|---|
| 偽造 key | 函式簽章已無 `p_idempotency_key` 參數，結構上不存在「偽造」的空間——靜態測試
  `NEVER accepts a caller-supplied idempotency key` 直接斷言簽章只有 3 個參數。 |
| 錯誤 token + 「有效」情境 | 錯誤 `claim_token_hash` 在 `SELECT ... FOR UPDATE` 就會找不到列，直接
  `RAISE EXCEPTION 'claim not found'`，永遠不會走到 canonical key 計算或任何合併邏輯——由既有的
  「claim not found」行為與新的「鎖定必須在 email 比對/idempotency 查詢之前」順序測試共同覆蓋。 |
| Email 不符 | `rejects when the caller's own email hash does not match ... applies to BOTH pending
  and used claims` 測試涵蓋（新版明確不受 claim 狀態影響）。 |
| 完成後重送 | `a resend for an already-completed canonical pair returns the stored request
  unchanged` 測試涵蓋程式碼結構；真正的「兩次呼叫回傳完全相同 mergeId」需要 05C Staging Gate 的
  真實 PostgreSQL 測試（見下）才能實際驗證。 |
| 併發重送 | 併發安全性建立在 `SELECT ... FOR UPDATE` + Postgres MVCC 語意（第二個交易會等待、然後
  讀到第一個已提交的結果），這是資料庫執行期行為，**無法**用靜態文字測試證明，只能透過 05C Staging
  Gate 的真實併發測試驗證（見下）。 |

## 05C Staging Gate 測試計畫（本次未執行，需在真實/staging Supabase 專案上進行）

延續 `review-auth-05A-hotfix.md` 已列出的 9 項測試，本次額外/修訂：

1. **偽造/猜測 idempotency key 無效**：嘗試呼叫（假設性地）以任何方式影響 canonical key 的計算結果
   ——由於 05B 尚未實作，此測試需等 Edge Function 完成後，直接測試「無論 HTTP request body 放什麼
   `idempotencyKey` 欄位，Edge Function 都不應該將其轉發進 RPC」，可透過檢查 Edge Function 原始碼
   / 呼叫記錄確認，而非資料庫測試本身。
2. **錯誤 `claim_token_hash`**：帶一個不存在的 hash 呼叫 `finalize_account_merge`，確認拋出
   `claim not found`，且 `account_merge_requests`/`account_merge_claims` 完全沒有任何列被異動。
3. **Email 不符（包含對已使用 claim 的重放）**：
   a. 對一個 **pending** claim，用錯誤 Email 的既有帳號呼叫，確認拋出例外、claim 仍是 `pending`。
   b. 對一個**已經 `used`** 的 claim，用**另一個**（非原本完成合併的）既有帳號呼叫，確認同樣拋出
      Email 不符的例外，而不是意外回傳原本的合併結果。
4. **完成後重送（同一個既有帳號）**：完整跑一次成功合併後，用**同一個** existing_user_id 與
   **同一個** claim_token_hash 再呼叫一次，確認回傳的 `mergeId`/`result_json` 與第一次**完全相同**，
   且 `users.points`/`shop_cart`/`user_mascots`/`redeem_history` 均**沒有**被再次異動。
5. **人為資料不一致測試**：（僅限測試環境，直接用 `service_role` 手動）把某個 claim 的 `status`
   改成 `used` 但不建立對應的 `account_merge_requests` 列，再呼叫 `finalize_account_merge`，確認
   拋出「data inconsistency」例外。
6. **併發重送**：對同一個 `pending` claim 同時發出兩個 finalize 請求（兩個平行 `psql`/兩個平行
   HTTP 請求），確認恰好一次真正執行合併，另一次安全地拿到相同結果，資料庫中沒有任何欄位被異動
   兩次。
7. 其餘承襲 `review-auth-05A-hotfix.md` 的 RLS owner/跨帳號測試、user_mascots dedup dry-run 等，
   維持不變。

## 明確聲明（依需求 8）

- 本階段修正的是 **05A Design Gate** 範圍內的一個具體授權漏洞（`finalize_account_merge` 的冪等
  檢查順序），**未**觸及 Begin/Finalize Edge Function 本體（**05B Implementation 未開始**）。
- **05C Staging Gate 未執行**——「05C Staging Gate 測試計畫」列出的 7 項測試皆尚未於真實/staging
  專案跑過。
- 本階段**未**將任何 migration（含本次修改的 `20260816000400`）部署到正式或測試 Supabase 專案。
- `20260816000000_core_user_tables_owner_rls.sql` 依然**不得**部署，先決條件與
  `review-auth-05A-hotfix.md` 「部署順序」一節相同，未變更。
