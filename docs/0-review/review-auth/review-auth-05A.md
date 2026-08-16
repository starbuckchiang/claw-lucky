# P-AUTH-05A: Existing Account Merge Security Foundation — Review

**狀態：安全基礎建設（Schema + RLS + Claim 生命週期原語）。本階段未實作、未宣告完成任何實際跨帳號資料
合併，也未宣告 Gate 4 PASS。所有 migration 僅建立於本機檔案，未執行 `supabase db push`／未部署到任何
正式或測試 Supabase 專案。**

## 範圍與非範圍

本次（P-AUTH-05A）僅交付：

1. 為 `users`／`user_mascots`／`redeem_history`／`shop_cart`／`orders`／`order_items` 建立以
   `auth.uid()`（透過既有 `public.request_user_key()`）為準的 RLS。
2. 舊字串 ID／Auth UUID 相容性欄位（`users.legacy_user_id`，僅新增、不改動既有資料）。
3. `point_transactions` ledger 與唯一合法的寫入入口 `apply_point_transaction()`。
4. `account_merge_claims`（僅存 token hash／email hash，原始值不落庫）與其生命週期函式
   （`create_account_merge_claim`／`consume_account_merge_claim`／
   `expire_stale_account_merge_claims`）。
5. 各表合併規則定義與明確 Blocker 清單。
6. 靜態結構測試（見「測試證據與限制」）。
7. 給 P-AUTH-05B 的 begin/finalize merge 契約（本檔案最後一節）。

**明確不包含**：實際把某匿名使用者的資料搬到既有帳號（`merge_anonymous_account()` 本體）、任何
Edge Function 實作、任何前端呼叫變更、任何 migration 的實際部署。ADR-009 先前規劃的
`merge_anonymous_account()` RPC 與 Edge Function 仍待 P-AUTH-05B 實作。

## 資料表盤點方法與限制

此環境**沒有**可用的 Supabase CLI 資料庫連線（無 DB 密碼、無 `deno` 執行環境）、也沒有可查詢即時
`information_schema`／`pg_catalog` 的工具，因此**無法對正式 Supabase 專案做即時 schema/FK/RLS
內省**。本次盤點延續 ADR-009 的方法：**完整重新檢視前端／後端程式碼中每一個實際的 Supabase 查詢
呼叫**（而非僅重述 ADR-009 既有結論），確認以下事實：

| 資料表 | 確認到的欄位（來自程式碼實際查詢/insert shape） | 目前寫入路徑（anon key，無伺服器端驗證）|
|---|---|---|
| `users` | `user_id`, `nickname`, `points`, `tickets`, `coins`, `updated_at` | `js/api.js`：`getUser`/`createUserIfNotExists`/`adjustBalance` |
| `user_mascots` | `user_id`, `mascot_id`, `mascot_name`, `rarity`, `image`, `obtain_count`, `first_obtained_at`, `last_obtained_at` | `js/api.js`：`upsertUserMascot`/`getUserMascots` |
| `redeem_history` | `user_id`, `nickname`, `gift_id`, `gift_name`, `quantity`, `points_cost`, `tickets_cost`, `coins_cost`, `status`, `note`, `created_at`, `updated_at` | `js/api.js`：`addRedeemHistory`/`getRedeemHistory`/`redeemGift` |
| `shop_cart` | `id`, `user_id`, `product_id`, `quantity`, `selected`, `unlock_verified`, `created_at`, `updated_at` | `js/shop/shop-api.js`：`addToCart`/`getCart`/`updateCartItem`/`removeCartItem`/`clearCart` |
| `orders` | `id`, `order_no`, `user_id`, `total_amount`, `total_items`, `status`, `created_at`, `updated_at` | `js/shop/shop_cart.js`：`handleCheckout()` |
| `order_items` | `order_id`, `product_id`, `product_name`, `product_image`, `price`, `quantity`, `subtotal`, `created_at`（**無自己的 `user_id`**，僅透過 `order_id` 連到 `orders.user_id`）| `js/shop/shop_cart.js`：`handleCheckout()` |

**新發現（本次盤點新增，ADR-009 未提及）**：
- `js/user.js` 的 `initUser()` 目前**一律**用 `authUser.id`（Supabase Auth Session 的真實 UUID）呼叫
  `createUserIfNotExists({ userId: authUserId, ... })`，從未使用 `getOrCreateLegacyUserId()` 產生的
  `oss_u_xxx` 字串當作 `users.user_id`。也就是說，**目前所有透過現行程式碼建立的 `users` 列，`user_id`
  已經是真正的 Auth UUID**；「舊字串 ID」風險主要是「若有更早期版本遺留的資料」這個**理論上**的相容性
  問題，而非目前主要寫入路徑的行為。這是為何本次 migration 對「舊字串 ID 相容性」採用**新增可選欄位
  + 不強制回填/不刪除任何資料**的保守作法，而非重寫既有 `user_id` 值。
- `js/shop/shop-api.js` 的 `updateCartItem(cartId, updates)`／`removeCartItem(cartId)` 目前**完全沒有
  `user_id` 擁有權檢查**（查詢只用 `.eq("id", cartId)`）——換言之，在 RLS 補上之前，唯一擋住「使用者 A
  修改/刪除使用者 B 的購物車項目」的機制只是「UUID 不容易被猜到」，並非真正的授權檢查。這是本次補上
  `shop_cart` RLS 的直接證據，也是後續 Edge Function 必須重新做擁有權驗證的具體原因（見下方
  Blocker）。
- `js/shop/shop_cart.js` 的 `handleCheckout()` 已經有一個**前端自我檢查**：`sessionUserId !==
  userId` 時會丟出錯誤——但這只是 JS 邏輯層的檢查，任何人都能繞過（直接呼叫 Supabase REST API，不
  經過這段 JS），**不能取代 RLS**，僅供參考說明目前的防護意圖。
- `logs` 資料表（`js/api.js` 的 `DB.logs`，記錄點數/金幣異動歷程）**不在本次要求的表清單內**，本次
  未觸碰；若日後合併點數紀錄時仍會參考 `logs`，需另外評估（列為 Blocker，見下方）。

RLS/FK/unique constraint **實際部署狀態**：`users`／`user_mascots`／`redeem_history`／`shop_cart`／
`orders`／`order_items` 目前在 `supabase/migrations/**` 中**完全沒有**任何一筆 `CREATE POLICY`／
`ENABLE ROW LEVEL SECURITY` 紀錄（與 ADR-009 結論一致），這代表：**若正式環境從一開始就未曾手動在
Dashboard 加過 RLS，這些表目前對任何持有合法 anon/authenticated JWT 的呼叫者是完全開放讀寫的**。本次
migration 檔案本身即是「盤點」的具體產出，並非另外一份文件。

## 實際 SQL（本次新增的 migration 檔案）

均為**新檔案**，遵循 `supabase-migrations.instructions.md`（新增 migration、保留 RLS、`auth.uid()`
所有權、明確依 operation 定義 policy、避免破壞性變更、含 rollback/驗證備註）。**尚未執行、尚未部署**。

### [supabase/migrations/20260816000000_core_user_tables_owner_rls.sql](../../../supabase/migrations/20260816000000_core_user_tables_owner_rls.sql)
- `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS legacy_user_id TEXT`（僅新增、可為 NULL，不回填、
  不刪除、不改動任何既有列）。
- 對 `users`／`user_mascots`／`redeem_history`／`shop_cart`／`orders` 六張表（`order_items` 額外處理，
  見下）各自：
  - `ENABLE ROW LEVEL SECURITY`。
  - `p_<table>_select_owner`：`FOR SELECT TO authenticated USING (user_id::text =
    public.request_user_key())`——沿用既有 `20260712122000_rls_wallpaper_core.sql` 已定義的
    `request_user_key()`（從**已驗證的 JWT claim** 解析 `sub`/`user_id`，絕不信任任何請求參數）。
  - `p_<table>_deny_insert/update/delete_authenticated`：三個 `AS RESTRICTIVE` policy，`USING
    (false)`/`WITH CHECK (false)`，**完全擋掉** `authenticated` 對這些表的任何 INSERT/UPDATE/DELETE
    ——所有寫入必須改走 Edge Function/RPC（service-role），與既有 `wallpaper_generations` 等表的既有
    RLS 風格一致。
  - `order_items` 沒有自己的 `user_id`，改用 `EXISTS (SELECT 1 FROM public.orders o WHERE o.id =
    order_items.order_id AND o.user_id::text = public.request_user_key())` 判斷擁有權。
  - 所有 `user_id` 比對皆 `::text` 轉型，**不假設 `user_id` 實際型別**（無即時 schema 存取，採用與
    `20260712040000_create_wallpaper_core_tables.sql` 相同的保守慣例）。
  - 全程 `to_regclass(...) IS NOT NULL` 包裹，任何一張表在目標環境不存在時安全跳過（不報錯、可重複
    執行）。

### [supabase/migrations/20260816000100_point_transactions_ledger.sql](../../../supabase/migrations/20260816000100_point_transactions_ledger.sql)
- 新增 `public.point_transactions`（`id`、`user_id`、`delta`、`reason`、`reference_id`、
  `balance_after`、`created_at`），FK 指向 `users`（PK 欄位/型別以與
  `20260712040000_create_wallpaper_core_tables.sql` 相同的 `pg_index`/`pg_attribute` 動態偵測手法解決
  ——同樣因為沒有即時 schema 存取）。
- RLS：`authenticated` 僅能 `SELECT` 自己的紀錄；INSERT/UPDATE/DELETE 全部 `RESTRICTIVE ... (false)`
  ——ledger 只能透過下面的函式寫入，帳本本身不可被前端竄改。
- `public.apply_point_transaction(p_user_id, p_delta, p_reason, p_reference_id)`：**唯一**合法改變
  `users.points` 的入口——同一交易內先 `SELECT ... FOR UPDATE` 鎖定該使用者列、計算新餘額、拒絕變成
  負數、`UPDATE users.points`、寫入一筆 `point_transactions`，任何一步失敗全部回滾（帳本與餘額永遠
  一致）。
  - **強化（需求 6）**：`SECURITY DEFINER` + `SET search_path = public, pg_temp`（固定 search_path，
    避免 search_path 挾持攻擊）；`REVOKE ALL ... FROM PUBLIC/anon/authenticated`，僅
    `GRANT EXECUTE ... TO service_role`——前端**完全**無法呼叫，只有拿 service-role key 的 Edge
    Function 能呼叫。
- 一次性回填：對每個既有使用者，若尚未有 `reason = 'ledger_backfill'` 的紀錄，插入一筆等於其目前
  `users.points` 的開帳分錄，讓「舊帳號」的帳本加總從今以後對得上 `users.points`——**只新增
  `point_transactions` 列，完全不動 `users.points` 本身**。

### [supabase/migrations/20260816000200_account_merge_claims.sql](../../../supabase/migrations/20260816000200_account_merge_claims.sql)
- 新增 `public.account_merge_claims`：`claim_token_hash`（`UNIQUE`）、`anonymous_user_id`、
  `target_email_hash`、`status`（`pending`/`used`/`expired`/`revoked`）、`expires_at`、`used_at`、
  `created_at`、`updated_at`。**沒有任何欄位存原始 token 或原始 email**（`claim_token`/`target_email`
  這類欄名刻意不存在，已由靜態測試斷言）。同一 `anonymous_user_id` 同時最多一筆 `pending`
  （`uq_account_merge_claims_anon_pending` 部分唯一索引）。
- RLS：`ENABLE ROW LEVEL SECURITY` 且**沒有任何 permissive policy**（另加一條顯式 `RESTRICTIVE ...
  FOR ALL ... USING (false) WITH CHECK (false)` 供意圖說明）——`anon`/`authenticated` 完全無法碰這張
  表，僅 `service_role`（略過 RLS）或下列函式可存取。
- `create_account_merge_claim(p_anonymous_user_id, p_claim_token_hash, p_target_email_hash,
  p_ttl_seconds=900)`：建立新 claim 前先把該匿名使用者既有的 `pending` claim 標記 `revoked`
  （避免與唯一索引衝突，也符合「同時只有一個進行中的合併嘗試」）。
- `consume_account_merge_claim(p_claim_token_hash, p_existing_user_id)`：單一 `UPDATE ... RETURNING`
  同時完成「檢查 `pending` 且未過期」與「標記 `used`」，兩個並發呼叫不可能都成功。查無有效 claim 時
  `RAISE EXCEPTION`（由呼叫端 Edge Function 轉換成不洩漏細節的錯誤訊息）。
- `expire_stale_account_merge_claims()`：供排程（pg_cron 或定時 Edge Function，本次未建立排程本身）
  把過期但仍是 `pending` 的 claim 標記為 `expired`，純粹稽核用途。
- 三個函式**皆** `SECURITY DEFINER` + `SET search_path = public, pg_temp` + `REVOKE ALL ...
  FROM PUBLIC/anon/authenticated` + `GRANT EXECUTE ... TO service_role`。

## 各表合併規則與 Blocker（需求 5）

| 資料 | 合併規則 | 目前狀態 / Blocker |
|---|---|---|
| **Cart**（`shop_cart`） | 依 `product_id` 合併重複商品（數量相加，但不得超過商品庫存）；`unlock_verified` 取兩者的邏輯或（任一帳號已解鎖視為已解鎖）。 | **Blocker**：目前 `shop_cart` 的加入/修改/刪除全部走前端 anon key 直接查詢，`updateCartItem`/`removeCartItem` 連擁有權檢查都沒有。本次 RLS 會讓這些呼叫**全部失敗**，必須先有 Edge Function 取代（P-AUTH-05B 或另立任務），才能部署本次 migration。 |
| **Mascot**（`user_mascots`） | 依 `mascot_id` 去重；重複時取 `obtain_count` 較大者、`first_obtained_at` 取較早、`last_obtained_at` 取較晚。 | **Blocker**：目前無 `(user_id, mascot_id)` 的資料庫層級唯一約束（僅前端邏輯假設唯一），去重前需先確認/補上 unique constraint，否則合併時可能有重複列可供選擇但無法用 `ON CONFLICT` 語意處理，需在 P-AUTH-05B 明確設計。 |
| **Gift／兌換紀錄**（`redeem_history`） | 全部保留（不去重、不消耗）——與既有 Product Decision #16「已兌換可重複使用，不消耗 `redeem_history`」一致，合併只是把兩邊的歷史紀錄「攤平」成同一使用者名下，不需要衝突解決規則。 | 無已知 Blocker，但仍需先有 RLS/寫入路徑（Edge Function）才能安全執行 `UPDATE ... SET user_id = <existing>`。 |
| **Points**（`users.points` + `point_transactions`） | 絕不直接相加；必須各自透過 `apply_point_transaction()` 寫入一筆 `reason='account_merge'` 的分錄（來源帳號歸零並記錄轉出、目標帳號加上等額並記錄轉入），保留完整稽核軌跡。 | 本次已建立 ledger + RPC 基礎；實際「merge 時呼叫兩次 `apply_point_transaction`」的邏輯仍屬於 P-AUTH-05B 的 `merge_anonymous_account()`，本次不實作。 |
| **Orders／Order Items** | **不可重複、不可任意改歸屬**——訂單一旦建立即代表已完成的金流事件，合併時**只允許**把 `orders.user_id`/透過 `order_items.order_id` 間接歸屬**整批**改指到既有帳號（不得拆分/合併訂單內容），且必須先確認不違反任何未來的訂單唯一性規則（例如同一 `order_no` 不得跨帳號重複）。 | **Blocker（有疑義，列為待決）**：目前沒有金流/請款系統驗證訂單真實性，「把匿名帳號的訂單改標成既有帳號」是否會產生對帳/發票歸屬問題，需要產品/財務決策後才能在 P-AUTH-05B 設計實際 UPDATE 邏輯，本次不假設答案。 |
| **Subscription** | 一位使用者最多一筆有效訂閱；若雙方都有有效訂閱，合併必須失敗並要求人工處理（不得靜默取消其中一筆）。 | **Blocker（沿用 ADR-009）**：`subscriptions` 資料表本身還不存在（Checkout/Payment/Webhook 仍是佔位邏輯），本次未建立，待該功能實際上線後才能定義合併規則。 |
| **`logs`（點數/金幣異動歷程）** | 未在本次需求清單內。 | **Blocker（新發現）**：若之後合併點數時仍想保留 `logs` 的歷史脈絡，需要另外評估是否合併/如何合併，本次不處理。 |

## SECURITY DEFINER 強化總結（需求 6）

本次新增的 5 個函式（`apply_point_transaction`／`create_account_merge_claim`／
`consume_account_merge_claim`／`expire_stale_account_merge_claims`，以及沿用既有的
`request_user_key()`／`set_updated_at()`）全部遵守：

- `SECURITY DEFINER`：僅在明確需要「以定義者權限執行、繞過呼叫者原本沒有的資料表存取權」時使用。
- `SET search_path = public, pg_temp`：**固定** search_path，防止惡意呼叫者透過操縱 session
  search_path 讓函式誤解析到攻擊者控制的同名物件（SECURITY DEFINER 函式最經典的挾持手法）。
- `REVOKE ALL ... FROM PUBLIC` 再明確 `REVOKE ... FROM anon/authenticated`，最後**只**
  `GRANT EXECUTE ... TO service_role`——最小權限，前端（`anon`/`authenticated`）完全無法呼叫；本階段
  **沒有**把 service-role key 放進任何前端檔案（需求 3/6）。

## 測試證據與限制

執行 `.\scripts\verify-local.ps1`：

```
== Syntax Check ==  全數通過
== Unit Tests ==
ℹ tests 359
ℹ suites 0
ℹ pass 359
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
Verification Complete
```

新增 `supabase/migrations/__tests__/rls-policy-shape.test.js`（21 個測試，均通過），涵蓋：
- `core_user_tables_owner_rls`：6 張表皆 `ENABLE ROW LEVEL SECURITY`、皆有 owner-only SELECT（透過
  `request_user_key()`）、皆有三條 `RESTRICTIVE` deny policy 擋住 INSERT/UPDATE/DELETE；全檔案不存在
  `USING (true)`/`WITH CHECK (true)`；`legacy_user_id` 為新增/可為空/不刪除既有欄位。
- `point_transactions_ledger`：RLS 與 owner-only SELECT；`apply_point_transaction` 具備
  `SECURITY DEFINER`/固定 `search_path`/`REVOKE`+`GRANT` 到 `service_role`；從未授權
  `anon`/`authenticated`；負餘額會被拒絕。
- `account_merge_claims`：只存 token/email 的雜湊欄位（明確斷言不存在 `raw_token`/`claim_token`/
  `target_email` 這類欄名）；RLS 無任何 permissive policy；`claim_token_hash` 唯一；三個函式皆符合
  `SECURITY DEFINER`/固定 `search_path`/`REVOKE`+`GRANT service_role` 的強化模式；
  `consume_account_merge_claim` 是單一 `UPDATE ... RETURNING`（非「先讀再寫」的競態寫法）。

**重要限制（必須誠實揭露）**：此環境沒有本地 Postgres/`pg-mem` 測試工具，也沒有真實 Supabase 專案的
連線權限，因此上述測試**全部是對 migration SQL 文字本身的靜態結構斷言**，用來防止「日後不小心刪掉
RLS/改成 `USING (true)`/放寬 GRANT」這類回歸，**無法**證明一個真實 Postgres 執行這些 SQL 後，RLS 與
函式權限實際運作正確。部署前**必須**依下方「手動驗證步驟」在真實（或 staging）Supabase 專案上，用
兩個不同帳號實際測試 owner/跨帳號存取，才能視為驗證完成。

## 手動驗證步驟（部署後必做，本次未執行）

以下步驟需要一個真實/staging Supabase 專案、兩個測試帳號（帳號 A、帳號 B）。**在完成這些步驟前，不得
宣告本次 RLS/ledger/claim 基礎已驗證正確，更不得宣告 Gate 4 PASS。**

1. **套用 migration**：於 staging 專案執行 `supabase db push`（或等效方式）套用三個新 migration。
2. **Owner 讀取**：帳號 A 登入後，`select * from users where user_id = eq.<A的uid>` 應成功回傳 A
   自己的資料；改查 `<B的uid>` 應回傳空結果（而非錯誤，符合 RLS 語意）。對 `user_mascots`／
   `redeem_history`／`shop_cart`／`orders`／`order_items`（透過 `order_id` 間接）重複同樣測試。
3. **跨帳號寫入應被拒絕**：帳號 A 嘗試以 anon/authenticated 角色直接對 `users`/`shop_cart`/`orders`
   任一張表送出 INSERT/UPDATE/DELETE（無論目標是自己或 B 的列），皆應被 RLS 拒絕（PostgREST 回傳
   權限錯誤，而非成功）。
4. **既有功能預期會壞**：確認 gacha 抽卡（`upsertUserMascot`）、禮物兌換（`redeemGift`）、購物車
   （`addToCart`/`updateCartItem`/`removeCartItem`）、結帳（`handleCheckout`）在套用本次 migration
   後**確實會失敗**（這是預期行為，代表 RLS 生效；在對應 Edge Function 就緒前，不應該把這三個
   migration 部署到正式環境）。
5. **Points ledger**：以 `service_role` 呼叫 `select apply_point_transaction('<uid>', 10, 'test',
   null)`，確認回傳的 `point_transactions` 列與 `users.points` 同步更新；再以 `anon`/`authenticated`
   角色嘗試呼叫同一函式，應被拒絕（`permission denied for function`）。
6. **Merge claim 生命週期**：以 `service_role` 呼叫
   `create_account_merge_claim('<anon-uid>', '<token的sha256>', '<email的sha256>', 900)`，確認回傳
   `status='pending'`；再以同一 hash 呼叫 `consume_account_merge_claim(...)`，確認第一次成功、第二次
   （重放同一 hash）失敗（`RAISE EXCEPTION`）；確認 `select claim_token_hash from
   account_merge_claims` 這類查詢用 `anon`/`authenticated` 角色會回傳空結果（RLS 擋下）。

## P-AUTH-05B Begin/Finalize Merge Contract（本次僅定義契約，不實作）

本節定義 P-AUTH-05B 應該實作的 Edge Function 介面，讓下一階段可以直接依此設計，不需要重新盤點。

### Begin Merge（`POST /functions/v1/account-merge/begin`，草案）
1. 從 `Authorization` header 解析**呼叫者自己**（此時仍是匿名 session）的 JWT，透過
   `resolveAuthenticatedUser()`（沿用 `supabase/functions/_shared/supabase-clients.ts` 既有函式）取得
   `anonymous_user_id`——**絕不**信任 request body 裡的任何使用者 ID。
2. 產生一組高熵亂數 claim token（例如 32 bytes、`crypto.randomUUID()`+ 額外亂數或
   `crypto.getRandomValues`），以 SHA-256（或更強）雜湊後得到 `claim_token_hash`；**原始 token 只回傳
   給呼叫端，絕不寫入資料庫、絕不記錄進任何 log**。
3. 對目標 Email 做同樣的雜湊得到 `target_email_hash`。
4. 以 `service_role` 呼叫 `create_account_merge_claim(anonymous_user_id, claim_token_hash,
   target_email_hash, ttl_seconds)`。
5. 回傳 `{ ok: true, data: { claimToken, expiresAt } }`——`claimToken` 是**唯一**一次看得到原始值的
   地方，前端需要把它安全地帶到 Finalize 步驟（例如與既有的既有帳號登入 OTP 流程綁在一起，而不是另外
   顯示給使用者輸入）。

### Finalize Merge（`POST /functions/v1/account-merge/finalize`，草案）
1. 從 `Authorization` header 解析**呼叫者自己**（此時已是登入既有帳號後的 session）的 JWT，取得
   `existing_user_id`——同樣絕不信任 request body。
2. 對 request body 帶入的 `claimToken` 做**同樣的雜湊演算法**得到 `claim_token_hash`。
3. 以 `service_role` 呼叫 `consume_account_merge_claim(claim_token_hash, existing_user_id)`；失敗
   （claim 不存在/已用/過期）時回傳統一、不洩漏細節的錯誤（例如 `MERGE_CLAIM_INVALID`），**不得**嘗試
   猜測/繼續合併。
4. 驗證成功後取得 claim 回傳的 `anonymous_user_id`，呼叫（P-AUTH-05B 待實作的）
   `merge_anonymous_account(idempotency_key, anonymous_user_id, existing_user_id)`（沿用 ADR-009 的
   RPC 設計骨架，內部需依上方「各表合併規則」實作 Cart 去重、Mascot 去重、Points 透過
   `apply_point_transaction` 各記一筆轉出/轉入、Order 依產品/財務決策後定案的規則、Subscription
   衝突即失敗）。
5. 成功後回傳 `{ ok: true, data: { merged: true, mergeId } }`；前端（`subscription-entry.js`）拿到
   成功結果後，即可比照本次 `account-merge-service.js` 已經打好的介面
   （`mergeAnonymousIntoExistingAccount`）自動接續 `pending.checkoutContext` 進入 Checkout，
   **不需要再改** `subscription-entry-guard.js`。

### 與既有程式碼的銜接點（P-AUTH-05B 應該重用，而非重寫）
- `js/services/auth/account-merge-service.js`（P-AUTH-04.3）：`mergeRpcClient` 注入點即為呼叫上述
  Finalize Edge Function 的地方；成功/失敗/`retryable` 的回傳形狀已經設計好並有測試涵蓋。
- `js/services/auth/subscription-entry-guard.js` 的 `buildMergeIdempotencyKey(anonymousUserId,
  existingUserId)`：Finalize Edge Function 呼叫 `merge_anonymous_account()` 時應使用**同一組**
  idempotency key 規則（`merge:<anon>:<existing>`），與 `account_merge_claims`/
  `account_merge_requests`（ADR-009）維持一致的鍵值語意。
- ADR-009 的 `merge_anonymous_account()` RPC 骨架與 `account_merge_requests` 表：P-AUTH-05B 應該把
  ADR-009 的設計與本次的 `account_merge_claims`/`apply_point_transaction` 整合成單一實作，而不是
  各自獨立再造一遍。

## 明確聲明（依需求 8）

- 本階段**未**實作、**未**宣告完成任何「匿名帳號資料合併進既有帳號」的實際邏輯。
- 本階段**未**宣告 Gate 4 PASS——「手動驗證步驟」一節列出的測試皆尚未於真實/staging 專案執行。
- 本階段**未**將任何 migration 部署到正式或測試 Supabase 專案（僅建立本機檔案，等待審查）。
- 本階段**未**把 service-role key 加入任何前端檔案。
- 部署本次三個 migration 前，**必須**先確認/建立取代 `js/api.js`（`upsertUserMascot`/`redeemGift`/
  `adjustBalance`）與 `js/shop/shop-api.js`（`addToCart`/`updateCartItem`/`removeCartItem`）與
  `js/shop/shop_cart.js`（`handleCheckout`）目前直接讀寫這些表的 Edge Function/RPC，否則這些既有功能
  會在套用 RLS 後立即全部失效——這是本次刻意選擇的安全邊界（「Blocker」一節已列出），不是遺漏。
