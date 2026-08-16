# P-AUTH-05A Hotfix — Begin/Finalize Merge Gate Blockers — Review

**狀態：修訂安全基礎建設的設計缺陷（Gate blockers）。本階段仍然只交付 schema／SECURITY DEFINER
function／契約文件，**未**實作 Begin/Finalize Edge Function 本體、**未**部署任何 migration、**未**
宣告 P-AUTH-05A PASS、**未**開始 P-AUTH-05B。**

## 這次在修什麼：上一版契約的 Gate Blocker

`review-auth-05A.md` 原本把「Begin/Finalize Merge Contract」寫成**兩個獨立步驟**：
`create_account_merge_claim()`（Begin）與 `consume_account_merge_claim()`（Finalize，僅檢查
`pending`/未過期就標記 `used`）。實際審查後發現這個設計有多個可被利用的安全漏洞：

1. **Finalize 從未驗證「誰在消費這個 claim」**：`consume_account_merge_claim(p_claim_token_hash,
   p_existing_user_id)` 的 `p_existing_user_id` 是呼叫端傳入的參數，函式本身完全沒有拿它跟
   `account_merge_claims.target_email_hash` 比對。只要有人拿到（或猜到）一組有效的
   `claim_token_hash`，**任何**已登入的正式帳號都能呼叫這個函式把該 claim 標記為自己的、進而（在
   未來 05B 實作合併邏輯後）把別人的匿名資料併進自己帳號——這是一個嚴重的水平權限提升漏洞。
2. **「標記 used」與「實際合併」被拆成兩次呼叫**：如果 Finalize 呼叫 `consume_account_merge_claim`
   成功（claim 已標記 `used`），但後續實際合併資料的呼叫失敗，claim 已經燒掉、無法重試，且沒有任何
   資料真的被搬動——變成一個無法恢復的中間狀態。
3. **完全沒有冪等（idempotency）記錄**：同一個 A→B 合併請求被重送兩次，沒有任何機制阻止重複執行
   （例如重複轉移點數兩次）。
4. **`user_mascots` 沒有 `(user_id, mascot_id)` 唯一約束**：即使合併邏輯想用 `ON CONFLICT` 去重複，
   資料庫層級也無法保證正確性。
5. **Orders／Subscriptions／Logs 的合併規則從未定案**，卻沒有在契約裡明確排除，容易被之後的實作
   誤以為「連這些也要合併」。

本次修訂針對以上五點逐一修正，並將 RLS migration（`20260816000000`）的部署順序限制寫得更明確。

## 修改哪些檔案

### 1. Begin 必須驗證匿名身分；Email 正規化後才雜湊（需求 1）
- 新增 `js/services/auth/merge-claim-crypto.js`（純函式、Node/Edge-only，**沒有** `window` 匯出，因為
  這永遠只在伺服器端執行）：
  - `normalizeEmailForHash(email)`：`trim()` + `toLowerCase()`。
  - `hashClaimValue(value)`：SHA-256、小寫十六進位字串。
  - `hashNormalizedEmail(email)`：先正規化再雜湊——**這是修正的核心**：`"User@Example.com"`／
    `" user@example.com "`／`"USER@EXAMPLE.COM"` 現在會產生**完全相同**的雜湊值，避免使用者因為大小寫
    /空白差異導致自己合法的 claim 之後比對失敗。
  - 新增 Deno/Web Crypto 對應版 `supabase/functions/_shared/lib/merge-claim-crypto.ts`（同樣的正規化
    規則、同樣的雜湊演算法，供未來 05B 的 Edge Function 使用；`crypto.subtle.digest` 是非同步
    API，這是兩個版本間唯一被迫的執行環境差異）。
  - 新增 `js/services/auth/__tests__/merge-claim-crypto.test.js`（9 個測試）：正規化行為、大小寫/
    空白差異雜湊相同、不同輸入雜湊不同、雜湊格式（64 字元小寫 hex）。
- **契約層面**（見下方「P-AUTH-05B Begin/Finalize Merge Contract（修訂版）」）：Begin 必須先呼叫既有的
  `resolveAuthenticatedUser()`（`supabase/functions/_shared/supabase-clients.ts`）解析**呼叫者自己**
  的 Session，確認 `is_anonymous === true`，不符合就直接拒絕（`403
  MERGE_REQUIRES_ANONYMOUS_SESSION`），**絕不**信任 request body 裡的任何使用者 ID/狀態聲明。

### 2. Finalize 必須從已驗證的正式 Session 取得 email，並比對 `target_email_hash`（需求 2）
- 契約層面：Finalize 必須呼叫 `resolveAuthenticatedUser()` 解析**呼叫者自己**（此時是已登入正式帳號）
  的 Session，確認 `is_anonymous === false`，取用**該 Session 自己的** `user.email`（絕非 request
  body 帶來的 email/UID），用同一組 `normalizeEmailForHash`/`hashClaimValue` 雜湊後，當成
  `p_existing_user_email_hash` 參數傳給下面的 `finalize_account_merge()`。
- SQL 層面：`finalize_account_merge()`（見下）內部執行
  `IF v_claim.target_email_hash <> p_existing_user_email_hash THEN RAISE EXCEPTION ...`——比對**在
  資料庫交易內部**完成，不依賴 Edge Function 自己「記得」要比對；即使未來有人寫了另一個呼叫路徑，
  只要走這個函式就一定會被擋下。

### 3. Claim 驗證／鎖定／Email 比對／冪等檢查／合併／標記 used 全部放進同一個交易（需求 3）
- 新增 [supabase/migrations/20260816000400_account_merge_requests_and_finalize.sql](../../../supabase/migrations/20260816000400_account_merge_requests_and_finalize.sql)：
  - `public.finalize_account_merge(p_claim_token_hash, p_existing_user_id,
    p_existing_user_email_hash, p_idempotency_key)`：**單一** `SECURITY DEFINER` 函式，依序在**同一個
    交易**內完成：
    1. **冪等檢查最優先**（需求 4）：`SELECT ... FROM account_merge_requests WHERE idempotency_key =
       ...`，找到就直接 `RETURN` 原本的結果，完全不觸碰 claim/鎖定/合併。
    2. `SELECT ... FOR UPDATE` 鎖定 claim 列（依 `claim_token_hash`），確認 `status='pending'` 且未
       過期。
    3. 確認同一個匿名使用者沒有被合併過（`account_merge_requests.anonymous_user_id` 唯一約束的
       friendly 版本，提前擋掉更清楚）。
    4. Email 雜湊比對（需求 2，見上）。
    5. 實際合併 Cart／Mascot／Redeem History／Points（見下方「V1 合併範圍」）。
    6. **只有前面全部沒有 `RAISE EXCEPTION` 才會執行到**：把 claim 標記 `used`、寫入一筆
       `account_merge_requests`。
  - 任何一步 `RAISE EXCEPTION`，Postgres 函式在呼叫端交易中執行，例外會讓**整個交易**（包含這次呼叫
    做過的所有 UPDATE/INSERT）回滾——claim 的 `status` 永遠不會停留在「已標記 used 但沒真的合併」這種
    中間狀態，失敗後 claim 依然是 `pending`，可以安全重試。
  - `consume_account_merge_claim(TEXT, TEXT)`（上一版的不安全設計）已從
    [20260816000200_account_merge_claims.sql](../../../supabase/migrations/20260816000200_account_merge_claims.sql)
    **移除**（原檔案從未部署，故無需 `DROP FUNCTION`，僅刪除定義並留下說明註解）。

### 4. `account_merge_requests`：記錄 idempotency key 與結果（需求 4）
- 同樣在 `20260816000400_account_merge_requests_and_finalize.sql` 新增
  `public.account_merge_requests`：
  - `idempotency_key`（`UNIQUE`）——同一個 idempotency key 重送時，`finalize_account_merge()`
    在**任何鎖定/合併動作之前**就直接回傳這筆既有紀錄。
  - `anonymous_user_id`（額外 `UNIQUE`）——同一個匿名使用者**永遠**只能成功被合併一次，即使呼叫端
    不小心用了不同的 idempotency key 重送，資料庫層級的唯一約束也會擋下第二次。
  - `result_json`：記錄本次合併了多少筆 Cart／Mascot／Redeem History、轉移多少點數，以及
    `excludedV1`（見下）。
  - RLS：`ENABLE ROW LEVEL SECURITY` + 顯式 `RESTRICTIVE ... FOR ALL ... (false)`，`anon`/
    `authenticated` 完全無法碰，只有 `service_role`／`finalize_account_merge()` 能寫入。

### 5. RLS migration 部署順序限制（需求 5）— 見下方「部署順序」一節
`20260816000000_core_user_tables_owner_rls.sql` 本身**沒有任何程式碼變更**（原本的設計已經是正確的
owner-only RLS），本次修訂是把「**在哪些前提被滿足之前絕對不能部署這個 migration**」講得更明確、更
具體（見「部署順序」一節），並在 review 文件中列出每一個目前依賴 anon-key 直接寫入的呼叫點，作為
「未完成」的具體檢核清單，而不是只有一句話的警告。

### 6. `user_mascots` 去重 + 唯一約束（需求 6）
- 新增 [supabase/migrations/20260816000300_user_mascots_dedup_and_unique_constraint.sql](../../../supabase/migrations/20260816000300_user_mascots_dedup_and_unique_constraint.sql)：
  - **前置清理**：用 CTE 找出所有 `(user_id, mascot_id)` 重複的分組，保留最早建立的一列，把
    `obtain_count` **加總**（重複列代表同一使用者/吉祥物在競態情況下被分別記錄，不是同一次獲得的
    重複計數，因此用加總而非取代）、`first_obtained_at` 取最早、`last_obtained_at` 取最晚，其餘欄位
    取最近一次的值，然後刪除多餘的重複列。
  - 清理完成後才 `ADD CONSTRAINT uq_user_mascots_user_mascot UNIQUE (user_id, mascot_id)`。
  - **明確標示為破壞性、不完全可逆**：檔案內註解要求操作者在正式環境執行前**必須先備份**，並在本
    文件「手動驗證步驟」提供 dry-run 查詢，先預覽會合併多少組再決定是否套用。
  - `finalize_account_merge()` 的 mascot 合併邏輯依賴這個唯一約束（用 `ON CONFLICT (user_id,
    mascot_id) DO UPDATE`），因此**部署順序上，這個 migration 必須先於**
    `20260816000400_account_merge_requests_and_finalize.sql`（已透過檔名時間戳記保證順序，不得
    調換）。

### 7. Orders／Subscriptions／Logs 明確排除於第一版合併（需求 7）
- `finalize_account_merge()` 的合併範圍**只有** `shop_cart`／`user_mascots`／`redeem_history`／
  `users.points`（透過 `apply_point_transaction`）。函式內**完全沒有**任何一行觸碰
  `orders`/`order_items`/`subscriptions`/`logs`，並且回傳的 `result_json.excludedV1` 明確列出
  `["orders", "order_items", "subscriptions", "logs"]`，讓呼叫端/稽核可以直接看到「這次合併刻意
  沒有動哪些表」，而不是「忘記處理」。

### 測試
- 新增 `js/services/auth/__tests__/merge-claim-crypto.test.js`（9 個測試，見上）。
- 更新 `supabase/migrations/__tests__/rls-policy-shape.test.js`：
  - 移除對 `consume_account_merge_claim` 的斷言（函式已刪除）。
  - 新增對 `user_mascots_dedup` migration 的斷言：唯一約束存在且有防重複執行的 guard、
    `obtain_count` 用 `SUM`（不是取代）、檔案內明確標註「破壞性/需要備份」。
  - 新增對 `account_merge_requests`/`finalize_account_merge` 的斷言：RLS + 雙重唯一約束
    （`idempotency_key`、`anonymous_user_id`）；`SECURITY DEFINER`/`search_path`/`REVOKE`+
    `GRANT service_role` 強化模式；**冪等檢查的程式碼位置必須在鎖定/合併之前**（用字串出現位置的
    先後順序斷言，直接對應需求 3/4 的「順序」要求）；Email 雜湊比對存在；標記 `used`
    必須在所有合併步驟之後、且與寫入 `account_merge_requests` 同一批；從不觸碰
    `orders`/`order_items`/`subscriptions`/`logs`；用 `apply_point_transaction`（不是原始
    `UPDATE users SET points`）轉移點數；mascot 合併使用 `ON CONFLICT (user_id, mascot_id)`。
- `scripts/verify-local.ps1`：加入 `js/services/auth/merge-claim-crypto.js` 的 `node --check`。

## 執行 `.\scripts\verify-local.ps1`

```
== Syntax Check ==  全數通過（含新檔案 merge-claim-crypto.js）
== Unit Tests ==
ℹ tests 376
ℹ suites 0
ℹ pass 376
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
Verification Complete
```

**同樣的限制仍然成立**：以上全部是 `node --test`（含新的 SQL 靜態結構斷言），**不是**真實 PostgreSQL
的執行結果。以下「真實 PostgreSQL 測試計畫」列出部署前必須實際跑過的測試，本次尚未執行任何一項。

## P-AUTH-05B Begin/Finalize Merge Contract（修訂版）

延續 `review-auth-05A.md` 原本的草案，修正上述五個 Gate Blocker 後的完整契約：

### Begin Merge（`POST /functions/v1/account-merge/begin`）
1. 用 `resolveAuthenticatedUser(req)`（既有）解析呼叫者自己的 Session。
2. **（修正）** 確認 `user.is_anonymous === true`；不是就回傳 `403
   MERGE_REQUIRES_ANONYMOUS_SESSION`，絕不繼續。
3. 取得 request body 的目標 Email，先用 `normalizeEmailForHash()` 正規化，再用 `hashClaimValue()`
   雜湊得到 `target_email_hash`（**修正**：正規化必須發生在雜湊之前，且必須是與 Finalize 那邊
   完全相同的正規化規則，兩邊都呼叫同一份 `merge-claim-crypto` 模組，不得各自實作）。
4. 產生高熵亂數 claim token，雜湊得到 `claim_token_hash`；**原始 token 只回傳給呼叫端，絕不寫入
   資料庫、絕不記錄進任何 log**。
5. 以 `service_role` 呼叫 `create_account_merge_claim(anonymous_user_id, claim_token_hash,
   target_email_hash, ttl_seconds)`。
6. 回傳 `{ ok: true, data: { claimToken, expiresAt } }`。

### Finalize Merge（`POST /functions/v1/account-merge/finalize`）
1. 用 `resolveAuthenticatedUser(req)` 解析呼叫者自己（此時已登入既有帳號）的 Session。
2. **（修正）** 確認 `user.is_anonymous === false`；不是就回傳 `403
   MERGE_REQUIRES_OFFICIAL_SESSION`。
3. **（修正）** 取用**這個 Session 自己的** `user.email`（絕不讀取 request body 的 email/UID），
   同樣用 `normalizeEmailForHash()` + `hashClaimValue()` 得到 `existing_user_email_hash`。
4. 對 request body 的 `claimToken` 用 `hashClaimValue()` 得到 `claim_token_hash`（正規化規則對 token
   不適用，token 本身沒有大小寫問題）。
5. 產生（或沿用前端已提供的）`idempotencyKey`——建議延續既有
   `subscription-entry-guard.js`／ADR-009 的 `merge:<anonymousUUID>:<existingUUID>` 規則。
6. 以 `service_role` 呼叫 **單一** RPC：`finalize_account_merge(claim_token_hash, existing_user_id,
   existing_user_email_hash, idempotency_key)`。
7. 任何 `RAISE EXCEPTION`（claim 不存在/非 pending/過期/email 不符/該匿名使用者已合併過）一律翻譯成
   統一、不洩漏細節的錯誤碼（例如 `MERGE_CLAIM_INVALID`），**絕不**嘗試猜測/繼續合併、**絕不**重試
   別的邏輯。
8. 成功回傳 `{ ok: true, data: { merged: true, mergeId, result } }`；前端沿用既有
   `account-merge-service.js` 的 `mergeRpcClient` 注入點與 `subscription-entry-guard.js` 既有的
   `completeLoginAndResume()` 流程，成功後自動接續 `pending.checkoutContext`。

### 與既有程式碼的銜接點（不變）
- `js/services/auth/account-merge-service.js` 的 `mergeRpcClient` 注入點、
  `subscription-entry-guard.js` 的 `buildMergeIdempotencyKey()` 維持原設計，無需改動。

## V1 合併範圍（需求 7，明確排除清單）

| 資料 | 本次是否合併 | 說明 |
|---|---|---|
| `shop_cart` | ✅ 合併 | 依 `product_id` 加總數量、`selected`/`unlock_verified` 取邏輯或，並盡量以
  `shop_products.stock` 封頂（無法取得庫存時退回不封頂，Checkout 仍會重新驗證）。 |
| `user_mascots` | ✅ 合併 | 依 `(user_id, mascot_id)`（新唯一約束）`ON CONFLICT` 去重，`obtain_count`
  加總、時間戳取最早/最晚。 |
| `redeem_history` | ✅ 合併（僅改歸屬） | 直接把 `user_id` 改指到既有帳號，不去重、不消耗（沿用
  Product Decision #16）。 |
| `users.points` | ✅ 合併（透過 ledger） | 兩筆 `apply_point_transaction`（轉出/轉入），絕不直接
  相加欄位值。 |
| `orders`／`order_items` | ❌ **明確排除** | 金流/發票歸屬未決，禁止默默改歸屬（需求 7）。 |
| `subscriptions` | ❌ **明確排除** | 資料表本身尚不存在（ADR-009 既有結論），且「一人最多一筆有效
  訂閱」規則需要產品/財務決策後才能定案。 |
| `logs` | ❌ **明確排除** | 未在需求清單內，是否/如何合併需另外評估。 |

## 部署順序（本次未執行，僅規劃）

**在下列第 1-3 步完成並通過回歸測試之前，`20260816000000_core_user_tables_owner_rls.sql` 絕對不得
部署**（需求 5）：

1. 先建立取代下列直接前端寫入的 Edge Function/RPC，並完成端對端回歸測試：
   - `js/api.js`：`upsertUserMascot`／`addRedeemHistory`／`redeemGift`／`adjustBalance`／
     `createUserIfNotExists`。
   - `js/shop/shop-api.js`：`addToCart`／`updateCartItem`／`removeCartItem`。
   - `js/shop/shop_cart.js`：`handleCheckout`（建立 `orders`/`order_items`）。
2. 確認上述 Edge Function 都已改用 `service_role` 寫入、且各自重新驗證擁有權（尤其是
   `updateCartItem`/`removeCartItem` 過去完全沒做擁有權檢查，移植時**必須**補上，而不是原樣搬過去）。
3. 針對 gacha 抽卡、禮物兌換、購物車加入/修改/刪除、結帳，各自跑一次成功案例的回歸測試，確認改走
   Edge Function 後行為不變。
4. **此時**才部署 `20260816000000_core_user_tables_owner_rls.sql`。
5. 部署 `20260816000100_point_transactions_ledger.sql`（可與第 1-4 步平行或提前部署——純新增，不影響
   任何既有直接寫入路徑，因為它不對 `users` 加任何新的存取限制）。
6. 部署 `20260816000200_account_merge_claims.sql`（純新增，无相依）。
7. **在對正式資料做過「手動驗證步驟」中的 dry-run 查詢、並完成資料庫備份之後**，部署
   `20260816000300_user_mascots_dedup_and_unique_constraint.sql`。
8. 部署 `20260816000400_account_merge_requests_and_finalize.sql`（依賴第 7 步的唯一約束）。
9. 只有在第 1-8 步全部完成、且 P-AUTH-05B 的 Begin/Finalize Edge Function 依本文件契約實作、部署、
   通過「真實 PostgreSQL 測試計畫」後，才能開始讓真實使用者走既有帳號登入合併流程。

## Rollback（手動，本次未執行任何部署故無需真正回滾，僅記錄供未來使用）

依部署順序反向操作：

```sql
-- 20260816000400
REVOKE ALL ON FUNCTION public.finalize_account_merge(TEXT, TEXT, TEXT, TEXT) FROM service_role;
DROP FUNCTION IF EXISTS public.finalize_account_merge(TEXT, TEXT, TEXT, TEXT);
DROP POLICY IF EXISTS p_account_merge_requests_deny_all_authenticated ON public.account_merge_requests;
DROP TABLE IF EXISTS public.account_merge_requests;

-- 20260816000300 (資料本身無法用 SQL 復原，只能還原備份；唯一約束可單獨移除)
ALTER TABLE IF EXISTS public.user_mascots DROP CONSTRAINT IF EXISTS uq_user_mascots_user_mascot;

-- 20260816000200
REVOKE ALL ON FUNCTION public.expire_stale_account_merge_claims() FROM service_role;
DROP FUNCTION IF EXISTS public.expire_stale_account_merge_claims();
REVOKE ALL ON FUNCTION public.create_account_merge_claim(TEXT, TEXT, TEXT, INTEGER) FROM service_role;
DROP FUNCTION IF EXISTS public.create_account_merge_claim(TEXT, TEXT, TEXT, INTEGER);
DROP POLICY IF EXISTS p_account_merge_claims_deny_all_authenticated ON public.account_merge_claims;
DROP TABLE IF EXISTS public.account_merge_claims;

-- 20260816000100
REVOKE ALL ON FUNCTION public.apply_point_transaction(TEXT, INTEGER, TEXT, UUID) FROM service_role;
DROP FUNCTION IF EXISTS public.apply_point_transaction(TEXT, INTEGER, TEXT, UUID);
DROP POLICY IF EXISTS p_point_transactions_select_owner ON public.point_transactions;
DROP POLICY IF EXISTS p_point_transactions_deny_insert_authenticated ON public.point_transactions;
DROP POLICY IF EXISTS p_point_transactions_deny_update_authenticated ON public.point_transactions;
DROP POLICY IF EXISTS p_point_transactions_deny_delete_authenticated ON public.point_transactions;
DROP TABLE IF EXISTS public.point_transactions;

-- 20260816000000（重申：這步只有在已經部署過的前提下才需要 rollback）
ALTER TABLE IF EXISTS public.users DISABLE ROW LEVEL SECURITY;
-- ...（其餘同 review-auth-05A.md 原本列出的 ROLLBACK 段落）
ALTER TABLE IF EXISTS public.users DROP COLUMN IF EXISTS legacy_user_id;
```

## 真實 PostgreSQL 測試計畫（部署前必做，本次尚未執行）

需要一個真實/staging Supabase 專案，兩個測試帳號（匿名 A、既有帳號 B，B 有已知 Email）。

1. **Begin 拒絕非匿名呼叫者**：以帳號 B（已登入正式帳號）的 JWT 呼叫 Begin，預期
   `403 MERGE_REQUIRES_ANONYMOUS_SESSION`，且 `account_merge_claims` 沒有新增任何列。
2. **Email 正規化**：分別用 `"B@Example.com"`／`" b@example.com "`／`"b@example.com"` 呼叫 Begin
   建立 claim（各自視為獨立測試案例，每次都先清空/使用新的匿名 session），確認三次算出的
   `target_email_hash` 完全相同（可用 `service_role` 直接查表比對）。
3. **Finalize 拒絕非正式帳號呼叫者**：以另一個匿名 session 的 JWT 呼叫 Finalize，預期
   `403 MERGE_REQUIRES_OFFICIAL_SESSION`。
4. **Finalize 拒絕 Email 不符**：用帳號 C（真實存在，但 Email 與 claim 的 `target_email_hash` 不符）
   呼叫 Finalize，預期 `finalize_account_merge` 拋出例外、claim 的 `status` 仍是 `pending`（用
   `service_role` 直接查表確認)。
5. **Finalize 正常成功路徑**：帳號 A 建立 claim → 帳號 B（Email 與 claim 相符）呼叫 Finalize →
   確認：`account_merge_claims.status='used'`、`account_merge_requests` 新增一筆、
   `shop_cart`/`user_mascots`/`redeem_history` 的列已經改指到 B、A 的 `users.points`
   歸零且多了一筆 `reason='account_merge_transfer_out'` 的 `point_transactions`、B 的 `points`
   增加且多了一筆 `reason='account_merge_transfer_in'`、`orders`/`subscriptions`/`logs`
   完全沒有變動。
6. **冪等重送**：用**同一組** `idempotencyKey` 再呼叫一次 Finalize，確認回傳結果與第 5 步**完全相同**
   （同一個 `mergeId`），且 `users.points`／`point_transactions`／`shop_cart` 等**沒有**再被異動一次
   （用時間戳記/列數確認沒有新增重複紀錄）。
7. **併發 Finalize**：對同一個 claim 同時發出兩個 Finalize 請求（可用兩個平行 `psql`/兩個平行
   HTTP 請求模擬），確認**恰好一個**成功、另一個因 `FOR UPDATE` 鎖定 + `status<>pending` 檢查而失敗，
   且失敗那個沒有造成任何資料異動。
8. **user_mascots dedup dry-run**（在正式資料庫執行 migration 前）：
   ```sql
   SELECT user_id, mascot_id, COUNT(*) AS row_count, SUM(obtain_count) AS would_be_obtain_count
     FROM public.user_mascots
    GROUP BY user_id, mascot_id
   HAVING COUNT(*) > 1
    ORDER BY row_count DESC;
   ```
   先確認重複組數量與預期合理，並在**已備份**的前提下才套用
   `20260816000300_user_mascots_dedup_and_unique_constraint.sql`，套用後重新執行同一查詢應該回傳
   0 列。
9. **RLS owner/跨帳號測試**：延續 `review-auth-05A.md` 原本列出的 owner 讀取/跨帳號寫入拒絕測試，
   套用 `20260816000000` 之前，需先完成「部署順序」第 1-3 步。

## 明確聲明（依需求 8）

- 本階段**仍未**實作、**仍未**宣告完成任何「匿名帳號資料合併進既有帳號」的實際生產行為——本次修訂的
  是 SQL 層級的交易安全性與契約正確性，Begin/Finalize **Edge Function 本體**仍未撰寫（那是
  P-AUTH-05B 的範圍，本次**未開始**）。
- 本階段**未**宣告 P-AUTH-05A PASS——「真實 PostgreSQL 測試計畫」列出的 9 項測試皆尚未於真實/staging
  專案執行。
- 本階段**未**將任何 migration（含新增的 `20260816000300`/`20260816000400`）部署到正式或測試 Supabase
  專案。
- `20260816000000_core_user_tables_owner_rls.sql` 依然**不得**部署，直到「部署順序」第 1-3 步（安全
  寫入 RPC/Edge Function 取代前端直接寫入並完成回歸測試）完成為止——這是需求 5 的具體、可檢核的
  先決條件，不是空泛提醒。
