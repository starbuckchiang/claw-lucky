# P-AUTH-05B-2A — Gacha & Gift Secure Write APIs — Review

**狀態：實作 + 本機測試完成。前端 UI／既有函式簽章／使用者操作流程完全未變動，僅將
`js/api.js` 內部實作從「瀏覽器 anon-key 直接寫入資料表」改為呼叫新的 `wallet-ops` Edge
Function。未部署 Production，未套用任何新 migration（含本次新增的四個），也未套用既有的
`20260816000000` RLS migration。**

延續 P-AUTH-05 系列的三關卡框架（`review-auth-05A.1-hotfix.md`）：本次是 **05B
Implementation** 底下的一個獨立子範圍（Gacha/Gift，稱 **05B-2A**）——05B-1（Account
Merge Begin/Finalize）已於前次任務完成候選；05B-2A（本次，Gacha/Gift）完成候選；
**05B-2B（Cart/Orders 安全寫入 API，見文末待辦）尚未開始**；05B 需要 2A/2B 全部完成才能
視為整體完成。05C Staging Gate（真實 Supabase 專案上的 PostgreSQL/併發驗證）本次同樣
**完全未執行**。

## 1. 盤點結果（需求 1）

| 函式 | 檔案 | 原本的寫入方式 | 具體漏洞 |
|---|---|---|---|
| `Api.createUserIfNotExists({userId, nickname})` | `js/api.js` | 瀏覽器 anon key，`.upsert({user_id:userId, ...defaults}, {onConflict:"user_id"})` | `userId` 完全未驗證，且是 **UPSERT**（非真正的 create-if-missing）——任何人只要知道/猜到別人的 `user_id`，呼叫這個函式就能把對方**現有帳號**的 `nickname`/`points`/`tickets`/`coins` 整個重設回預設值（0/0/20），屬於可直接利用的洗劫/惡搞漏洞。 |
| `Api.adjustBalance({userId, pointsDelta, ticketsDelta, coinsDelta, ...})` | `js/api.js` | 瀏覽器 anon key：`getUser()` 讀值 → 前端算新值 → `.update()` 寫回 | 沒有任何列鎖，兩個並發呼叫可能互相覆蓋（lost update）；`points`/`tickets`/`coins` 只是原始欄位 UPDATE，完全沒有稽核軌跡（`points` 這點已由 P-AUTH-05A 的 `point_transactions`/`apply_point_transaction` 部分解決，但 `tickets`/`coins` 完全沒有）。 |
| `Api.upsertUserMascot({userId, mascotId, ...})` | `js/api.js` | 瀏覽器 anon key，SELECT-then-INSERT-or-UPDATE（非原子） | **完全沒有 ownership 檢查**——任何人可以直接在 devtools 呼叫 `Api.upsertUserMascot({userId:'任意user_id', mascotId:'任意稀有吉祥物'})`，把任意吉祥物塞進任意帳號的收藏。 |
| `Api.redeemGift({userId, giftId, pointsCost, ticketsCost, coinsCost, giftName, ...})` | `js/api.js` | 瀏覽器 anon key，內部呼叫 `adjustBalance()`（非原子）再呼叫 `addRedeemHistory()`（另一次獨立 INSERT） | **`pointsCost`/`ticketsCost`/`coinsCost`/`giftName` 全部由呼叫端提供**——任何人可以直接呼叫 `Api.redeemGift({giftId:'高單價商品', pointsCost:0, ticketsCost:0, coinsCost:0})` 免費兌換任何商品。兩個步驟之間沒有交易保護，任一步失敗會留下不一致狀態（例如已扣款但沒有兌換紀錄）。 |
| `Api.decreaseGiftStock(giftId, quantity)` | `js/api.js` | 瀏覽器 anon key，讀庫存→前端算新值→`.update()` | 與 `redeemGift()` 是**兩個完全分開的呼叫**（頁面先呼叫 `redeemGift` 再呼叫這個），中間沒有鎖，兩個並發兌換同一件最後一件庫存的商品可能都「成功」（超賣）。 |
| `js/api.js` 的 `addLog`/`addRedeemHistory` | `js/api.js` | 瀏覽器 anon key 直接 INSERT | 內部工具函式，本身有把 `userId` 改成 `resolveAuthUserContext()` 解析出來的值（沒有直接信任呼叫端），但仍是**與 adjustBalance/redeemGift 分離的獨立寫入步驟**，不具原子性。 |

**唯一被使用的呼叫點**（已排除 `js/temp/**` 底下的舊草稿檔——這些檔案沒有被任何
`*.html` 的 `<script>` 引用，屬於已死程式碼，不在本次盤點範圍內）：
- `js/user.js`：`Api.createUserIfNotExists({userId: authUser.id, nickname})`（`initUser()` 流程，用**真實**已驗證的 Auth JWT id）。
- `js/pages/gacha.js`：`handleDrawClick()` 呼叫 `Api.adjustBalance()`（扣 1 coin + 加 points/tickets）再呼叫 `Api.upsertUserMascot()`（同步吉祥物）——**兩個分開呼叫**，且 `pointsDelta`/`ticketsDelta` 直接來自**前端** `GachaEngine.drawOnce()` 的結果（`js/game/gacha-engine.js`：`buildRewardResult()` 讀 `public.mascots` 的 `points`/`tickets`/`duplicate_bonus`；是否為「已擁有」則讀**瀏覽器 localStorage** 的收藏快取——這兩者都是**可被瀏覽器端竄改的資料來源**）。抽取哪隻吉祥物、扣 1 coin 這件事本身仍是 CLIENT-SIDE RNG（`Math.random()`），本次刻意保留（見下方「已知限制」）。
- `js/game/ad-reward.js`：`Api.adjustBalance({coinsDelta: config.adRewardCoins, actionType:"watch_ad"})`（觀看廣告獎勵）。
- `js/gift.js`：`handleRedeem()` 呼叫 `Api.getUser()`/`Api.getGiftById()`（讀取，本次未變動）→ `Api.redeemGift({pointsCost: latestGift.points_cost, ...})`（**成本值來自前端已讀到的 gift 物件，可被竄改**）→ 另外呼叫 `Api.decreaseGiftStock()`。

## 2. 新增的安全寫入基礎設施（需求 2/3/4/5/6）

### 資料庫 Migration（新增 4 個檔案，本次全部未套用，見「明確聲明」）

- [`supabase/migrations/20260817000000_ticket_coin_wallet_ledger.sql`](../../../supabase/migrations/20260817000000_ticket_coin_wallet_ledger.sql)（需求 5）：
  仿照 P-AUTH-05A 既有的 `point_transactions`/`apply_point_transaction`，新增
  `ticket_transactions`/`apply_ticket_transaction`、`coin_transactions`/`apply_coin_transaction`
  ——**同樣的**鎖定（`FOR UPDATE`）/負數餘額拒絕/`SECURITY DEFINER`+`search_path`
  pinning/`REVOKE ... GRANT ... TO service_role` 硬化模式，外加一次性回填既有餘額為
  `ledger_backfill` 列。刻意**不是**把既有 `point_transactions` 改造成「一個表+currency
  欄位」的通用設計——現有 points ledger 已被 `finalize_account_merge` 依賴，不在本次
  改動範圍。
- [`supabase/migrations/20260817000100_ensure_user_row_and_generic_balance_adjustment.sql`](../../../supabase/migrations/20260817000100_ensure_user_row_and_generic_balance_adjustment.sql)（需求 2）：
  - `ensure_user_row(p_user_id, p_nickname)`：真正的 create-if-missing（`ON CONFLICT
    (user_id) DO NOTHING`），**絕不**覆寫已存在使用者的 `nickname`/`points`/`tickets`/
    `coins`——修正了盤點表格中「重設他人餘額」的具體漏洞。
  - `apply_generic_balance_adjustment(...)`：非扭蛋/非禮物兌換的通用餘額調整（目前唯一
    呼叫端：觀看廣告獎勵），鎖定使用者列後依序呼叫三個 ledger 函式 + 寫入一筆
    `logs`，全部在同一交易內。
- [`supabase/migrations/20260817000200_gacha_draw_secure_rpc.sql`](../../../supabase/migrations/20260817000200_gacha_draw_secure_rpc.sql)（需求 3/6）：
  - `upsert_user_mascot_obtain(...)`：`ON CONFLICT (user_id, mascot_id)` 安全 upsert（**依賴**
    `20260816000300` 的唯一約束，見下方依賴聲明）。
  - `claim_gacha_draw(p_user_id, p_mascot_id, p_idempotency_key)`：**單一交易**內完成扣 1
    coin、從 `public.mascots`（伺服器端目錄表）查出**真正**的 `points`/`tickets`/
    `duplicate_bonus`、從**鎖定的** `user_mascots` 列判斷是否為「首次擁有」（不是前端
    localStorage 的快取判斷）、套用對應獎勵、呼叫 `upsert_user_mascot_obtain`、寫入
    `gacha_draw_requests` 冪等紀錄。冪等查詢**先**執行，但緊接著立刻檢查快取列的
    `user_id` 是否等於呼叫端自己的 `p_user_id`（P-AUTH-05A.1 教訓：冪等查詢本身不能變成
    未經授權就能讀到別人結果的管道）。
- [`supabase/migrations/20260817000300_gift_redeem_secure_rpc.sql`](../../../supabase/migrations/20260817000300_gift_redeem_secure_rpc.sql)（需求 4/6）：
  - `redeem_gift_transaction(p_user_id, p_gift_id, p_idempotency_key)`：鎖定 `users` 與
    `gifts` 兩張表的對應列，成本/名稱**一律**從鎖定的 `gifts` 列讀出（**絕不**接受呼叫端
    提供的 `pointsCost`/`ticketsCost`/`coinsCost`/`giftName`），依序驗證 stock>0 →
    points/tickets/coins 餘額足夠 → 扣款（ledger 函式）→ 扣庫存 → 寫入
    `redeem_history`（`status='completed'`，不再是舊版的 `'pending'`）→ 寫入
    `gift_redemption_requests` 冪等紀錄，全部在同一交易內；任何一步失敗，整個交易（含
    已執行的扣款）rollback。同樣有 idempotency-key 的 ownership 檢查。

### Node/Edge Function 層

- [`js/services/wallet/wallet-ops-repository.js`](../../../js/services/wallet/wallet-ops-repository.js)
  （+ Deno 雙生檔 [`supabase/functions/_shared/lib/wallet-ops-repository.ts`](../../../supabase/functions/_shared/lib/wallet-ops-repository.ts)）：
  五個 RPC 的薄呼叫層（`ensureUser`/`adjustBalance`/`upsertMascot`/`claimGachaDraw`/
  `redeemGift`），service-role client only。
- [`supabase/functions/_shared/wallet-ops-handler.js`](../../../supabase/functions/_shared/wallet-ops-handler.js)
  （+ `.ts` 雙生檔）：五條路由的請求驗證（**allowlist**，明確拒絕
  `userId`/`user_id`/`ownerId`/`owner_id` 出現在任何一條路由的 request body——需求 2）、
  身份一律取自已驗證的 `user` 物件、錯誤分類與 HTTP 狀態碼對應、安全日誌（需求 8，見下）。
- [`supabase/functions/wallet-ops/index.ts`](../../../supabase/functions/wallet-ops/index.ts)：
  薄 Deno 入口，依 URL 路徑後綴（`/ensure-user`、`/adjust-balance`、`/upsert-mascot`、
  `/gacha-draw`、`/gift-redeem`）分派，比照 `account-merge/index.ts` 慣例。**同樣無法在本機
  用 Deno 實際執行/驗證**（此環境沒有 Deno CLI）。

### 前端 Adapter（需求 7：既有函式簽章不變，使用者流程不變）

- `js/api.js`：
  - `createUserIfNotExists({userId, nickname})`：`userId` 參數保留（呼叫端 `js/user.js`
    不需要改）但**內部完全忽略、絕不送出**——身份改由 Edge Function 從 JWT 解析。
  - `adjustBalance({...})`：改呼叫 `wallet-ops/adjust-balance`；`userId` 同樣被忽略。
  - `upsertUserMascot({...})`：改呼叫 `wallet-ops/upsert-mascot`；`userId` 同樣被忽略。
  - `redeemGift({...})`：改呼叫 `wallet-ops/gift-redeem`，只送 `giftId` +
    自動產生的 `idempotencyKey`（`crypto.randomUUID()`）；`pointsCost`/`ticketsCost`/
    `coinsCost`/`giftName`/`nickname` 參數保留（呼叫端 `js/gift.js` 不需要改呼叫方式）但
    **完全不會被送到伺服器**——成本一律由 RPC 從 `gifts` 表查出。
  - 新增 `claimGachaDraw({mascotId})`：呼叫 `wallet-ops/gacha-draw`。這是**唯一**新增的
    公開方法（不在原本函式簽章保護清單內，因為它是全新能力，不是既有函式的替代）。
  - 移除 `addLog`/`addRedeemHistory`/`decreaseGiftStock`：改由對應 RPC 內部處理，這三個
    純內部工具函式移除後沒有任何殘留呼叫點（已 grep 確認）。
  - 新增 `invokeWalletOpsFunction(path, body)`：`window.supabaseClient.functions.invoke()`
    的錯誤處理包裝，比照 `subscription-entry.js`（P-AUTH-05B-1）已驗證過的模式解析
    `error.context.json()`。
- `js/pages/gacha.js`：`handleDrawClick()` 的**內部實作**（不是 HTML、不是可見流程）從
  「呼叫 `adjustBalance()` 再呼叫 `upsertUserMascot()`」兩個分開呼叫，改為**一個**
  `Api.claimGachaDraw({mascotId: result.id})` 呼叫（需求 3 的「單一交易」在前端呼叫層級
  也對應成單一 HTTP 呼叫）。移除了現在已無呼叫點的 `syncMascotToSupabase()` 輔助函式。
  使用者可見的行為（動畫、結果卡片、Topbar 更新）完全不變。
- `js/gift.js`：`handleRedeem()` 移除了 `redeemGift()` 之後**另一個獨立、非原子**的
  `Api.decreaseGiftStock(latestGift.id, 1)` 呼叫——庫存扣減現在是 `redeemGift()`（實際上是
  `redeem_gift_transaction` RPC）自己交易內完成的一部分，保留舊呼叫只會變成一次多餘、
  不安全、可能造成超賣競態的第二次寫入。使用者可見的行為（確認對話框、成功/失敗訊息、
  兌換紀錄刷新）完全不變。
- 所有載入 `js/api.js` 的頁面（`gacha.html`/`gift.html`/`good.html`/`index.html`/
  `luck_complete.html`/`mascot-collection.html`/`orders.html`/`product.html`/
  `shop_cart.html`/`subscription.html`/`wallpaper.html`）：`<script>` 的 cache-busting
  query string 已 bump 為 `?v=20260817-1`（本專案無 build step，見既有慣例）。

## 3. 安全日誌（需求 8）

`wallet-ops-handler.js`/`.ts`：每一條路由的失敗處理只記錄 `correlationId` + 一個固定的
allowlist `reason` 代碼（例如 `INSUFFICIENT_COINS`/`MASCOT_NOT_FOUND`/`GIFT_NOT_FOUND`/
`RPC_ERROR`/`UNKNOWN`）——**絕不**記錄 `user_id`/JWT/`Authorization`/Email/原始 error
message/完整 request body。特別地，「idempotency key 屬於別人」（跨帳號重放嘗試）這種
情況**刻意**被分類進與任何其他未知錯誤相同的 `UNKNOWN`，對外和對日誌都完全無法區分——
不讓攻擊者從回應差異或（假設性）日誌外洩中確認自己的重放嘗試「差一點就成功」。
`wallet-ops/index.ts` 最外層例外處理同樣只記錄 `correlationId` + 固定 `reason` +
錯誤的建構子名稱（例如 `"TypeError"`），不含訊息內容。已用測試（見下）以「刻意在錯誤
訊息裡塞入假 user id/Email」的方式驗證 defense-in-depth。

## 4. 已知限制

1. **扭蛋抽獎本身仍是 CLIENT-SIDE RNG**（`js/game/gacha-engine.js` 的 `Math.random()`），
   刻意保留、不在本次範圍——`claim_gacha_draw` 只確保「無論抽到哪隻吉祥物，獎勵/扣款/
   收藏都是伺服器端權威計算」，但**抽中哪隻吉祥物**這個決定本身仍在瀏覽器端做出。理論上
   一個惡意使用者可以修改瀏覽器端邏輯讓 `GachaEngine.drawOnce()` 永遠回傳最高稀有度的
   `mascotId`，然後把這個 `mascotId` 送給 `claim_gacha_draw`——RPC 會誠實地依這個
   `mascotId` 查表給出對應獎勵（沒有校驗「這個結果的機率是否合理」）。這是本次任務明確
   要求「不得改變使用者流程/不得重做 gacha.html」下的既有設計妥協，**若未來要完全杜絕
   這個風險，需要把 RNG 移到伺服器端**（獨立、更大範圍的任務，可能牽涉 UI 改版，
   建議另立任務評估，不建議放進 05B-2B）。
2. **`apply_generic_balance_adjustment`（非扭蛋/非禮物的通用餘額調整）沒有自己的
   idempotency ledger**——今天唯一呼叫端「觀看廣告獎勵」若在網路層被重送，理論上可能
   被重複加幣。風險評估：這是經濟性風險（多給獎勵幣），不是授權繞過/資料外洩，優先度
   低於 05B-2B；若未來需要，可仿照 `gacha_draw_requests`/`gift_redemption_requests` 的
   同一套模式加上。
3. **`claim_gacha_draw`/`upsert_user_mascot_obtain` 依賴
   `20260816000300_user_mascots_dedup_and_unique_constraint.sql` 的唯一約束**（需求 6
   明確要求）——這個既有 migration 本身**尚未**在任何環境套用過，其自身文件已要求
   「套用前必須先在真實資料的複本上 dry-run + 備份」。本次**沒有**執行任何 dry-run，也
   沒有套用它——這是 05C Staging Gate 的前置作業之一，見下方測試計畫。
4. **`redeem_history` 的 `status` 從舊版的 `'pending'` 改為新版 RPC 直接寫入
   `'completed'`**——這是有意的行為變更（既然現在是單一原子交易完成，沒有「之後才確認」
   的中間狀態），但若任何既有程式碼/報表依賴 `redeem_history.status === 'pending'` 的
   舊語意，需要在 05C 驗證時額外確認（本次 grep 未發現任何前端程式碼讀取這個欄位做邏輯
   判斷，只有顯示用途）。

## 5. 修改/新增檔案清單

| 檔案 | 狀態 |
|---|---|
| `supabase/migrations/20260817000000_ticket_coin_wallet_ledger.sql` | 新增 |
| `supabase/migrations/20260817000100_ensure_user_row_and_generic_balance_adjustment.sql` | 新增 |
| `supabase/migrations/20260817000200_gacha_draw_secure_rpc.sql` | 新增 |
| `supabase/migrations/20260817000300_gift_redeem_secure_rpc.sql` | 新增 |
| `supabase/migrations/__tests__/wallet-secure-write-rpcs-shape.test.js` | 新增 |
| `js/services/wallet/wallet-ops-repository.js` | 新增 |
| `supabase/functions/_shared/lib/wallet-ops-repository.ts` | 新增（Deno 雙生檔） |
| `js/services/wallet/__tests__/wallet-ops-repository.test.js` | 新增 |
| `supabase/functions/_shared/wallet-ops-handler.js` | 新增 |
| `supabase/functions/_shared/wallet-ops-handler.ts` | 新增（Deno 雙生檔） |
| `supabase/functions/_shared/__tests__/wallet-ops-handler.test.js` | 新增 |
| `supabase/functions/wallet-ops/index.ts` | 新增（Deno Edge Function 入口，無法本機測試） |
| `js/api.js` | 改寫（5 個函式的內部實作、移除 3 個死函式） |
| `js/pages/gacha.js` | 修改（`handleDrawClick` 改用單一原子呼叫，移除 `syncMascotToSupabase`） |
| `js/gift.js` | 修改（移除多餘的 `decreaseGiftStock` 呼叫） |
| `gacha.html`／`gift.html`／`good.html`／`index.html`／`luck_complete.html`／`mascot-collection.html`／`orders.html`／`product.html`／`shop_cart.html`／`subscription.html`／`wallpaper.html` | 修改（`js/api.js` cache-busting bump；`gacha.html`/`gift.html` 另外 bump 了自己的頁面腳本） |
| `scripts/verify-local.ps1` | 修改（新增 `node --check`/測試 glob 項目） |

未修改：`supabase/migrations/20260816000000`～`20260816000400`（既有 P-AUTH-05A/05A.1/
05B-1 的 migration，完全未觸碰）、任何方案/價格設定、`gacha.html`/`gift.html` 的 HTML
結構與使用者操作流程。

## 6. 執行 `.\scripts\verify-local.ps1`

```
== Syntax Check ==  全數通過
== Unit Tests ==
ℹ tests 508
ℹ pass 508
ℹ fail 0
Verification Complete
```

（上一個查核點是 P-AUTH-05B-1 hotfix 完成時的 421/421，本次淨增 87 個測試：Handler 層
65 個 `wallet-ops-handler.test.js` + `wallet-ops-repository.test.js`、SQL 靜態結構測試
22 個。）

## 7. 需求 9 測試情境對照表

| 情境 | 覆蓋方式 |
|---|---|
| Owner 偽造 | `wallet-ops-handler.test.js` 對**全部五條路由**參數化測試：request body 含
  `userId`/`user_id`/`ownerId`/`owner_id` 任何一個都直接 `400`，且從未呼叫到 repository。 |
| 跨帳號（idempotency key 重放） | gacha-draw 與 gift-redeem 各有一個測試，證明「idempotency
  key 屬於別人」與「完全隨機的未知錯誤」回傳**完全相同**的通用錯誤（狀態碼、代碼、訊息皆
  相同），不可區分。 |
| 餘額不足 | gacha-draw（`INSUFFICIENT_COINS`）與 gift-redeem（`INSUFFICIENT_POINTS`/
  `INSUFFICIENT_TICKETS`/`INSUFFICIENT_COINS`，三種各自獨立測試）皆有專屬案例，對應正確
  的 HTTP 狀態碼與錯誤碼。 |
| 重複點擊 / 併發 | 兩組「有狀態假 repository」（`appliedCount` 計數器）分別驗證 gacha-draw
  與 gift-redeem 在「循序重送（模擬回應遺失）」與「`Promise.all` 併發呼叫」下都只實際
  「執行」一次——與 P-AUTH-05B-1 hotfix 建立的模式一致，**明確聲明**這只證明 JS 層不會
  自行造成二次執行，無法證明真實 PostgreSQL `FOR UPDATE`/MVCC 併發行為（05C Staging
  Gate 事項）。 |
| 部分失敗 rollback | Handler 層測試證明「repository 拋出錯誤時，回應絕不包含任何
  `data` 欄位」（不會洩漏部分成功的狀態）；真正的交易 rollback 由 SQL 層的單一
  `SECURITY DEFINER` 函式（整個函式在同一個隱含交易內）保證，這是 05A/05A-fix 已建立、
  本次沿用的既有模式，靜態結構測試也驗證了「餘額/庫存檢查一律在任何 ledger 呼叫/寫入
  之前」的程式碼順序。 |
| 既有成功流程 | 五條路由各自的「成功回傳」測試（`ensure-user`/`adjust-balance`/
  `upsert-mascot`/`gacha-draw`/`gift-redeem`），驗證身份一律取自已驗證的 `user` 物件、
  資料正確轉發/回傳。 |

## 8. 05C Staging Gate — 尚待執行的真實驗證

以下項目**本次全部未執行**，需要一個真實（建議 staging，非 Production）Supabase 專案：

1. **部署順序**：`20260816000300`（mascot dedup + 唯一約束）必須先做 dry-run + 備份後
   套用，**才能**接著套用本次的 `20260817000200`（依賴該唯一約束）；`20260817000000`／
   `20260817000100`／`20260817000300` 彼此獨立，可以更早部署測試。`supabase functions
   deploy wallet-ops`（同樣限 staging）。
2. **Deno 型別/執行驗證**：`wallet-ops/index.ts` 與其 `_shared/*.ts` 雙生檔從未被 Deno
   實際執行/編譯過。
3. **真實併發驗證**：對同一個 `mascotId`/`giftId` + 同一個 `idempotencyKey`，用**真正
   不同的資料庫連線**同時送出多個請求，確認 `gacha_draw_requests`/
   `gift_redemption_requests` 各自只有一筆列、`point_transactions`/`ticket_transactions`/
   `coin_transactions` 的筆數與金額吻合（而不是只看 `users` 的最終餘額）。
4. **端到端功能驗證**：真實登入一個帳號，跑過「抽中新吉祥物」「抽中重複吉祥物（只拿
   duplicate_bonus）」「coins 不足時抽卡」「兌換禮物成功」「庫存剛好賣完時兌換」「點數/
   兌換券/好運幣個別不足時兌換」六種情境，確認 UI 顯示與資料庫狀態一致。
5. **回歸驗證**：確認 `js/user.js` 的 `initUser()`（呼叫 `createUserIfNotExists`）、
   `js/game/ad-reward.js`（呼叫 `adjustBalance`）在真實環境下行為正常，且既有使用者的
   `nickname`/餘額不會被 `ensure_user_row` 意外重設。

**在以上全部通過之前，不得將 `wallet-ops` Edge Function 或本次任何新 migration
部署/套用到 Production；`20260816000000` RLS migration 仍然需要等待
05B-2B（Cart/Orders）完成、前端改接、回歸通過後才能套用——這點本次未改變。**

## 9. 05B-2B 待辦（Cart / Orders 安全寫入 API）

本次任務明確排除購物車與訂單流程；下一階段（05B-2A 的姊妹任務）需要盤點並比照本次
模式（薄 Edge Function + shared handler + SECURITY DEFINER RPC + 前端 adapter，owner id
一律取自 JWT，`FOR UPDATE` 鎖 + 冪等 key）處理：

- `js/shop/shop-api.js`：`updateCartItem(cartId, ...)`/`removeCartItem(cartId)` **完全沒有**
  ownership 檢查（`.eq("id", cartId)` 而已，P-AUTH-05A 就已指出的既有具體漏洞）——需要一個
  安全的 Cart 寫入 API，確保只能操作 `cart.user_id === 呼叫者自己的 id`。
- `js/shop/shop_cart.js` 與結帳流程：需要盤點目前實際的 `orders`/`order_items` 寫入路徑
  （本次未盤點，之前的 P-AUTH-04.3 分析標記為「待 05B-2 盤點」）——很可能可以直接複用
  `subscription-checkout` Edge Function 已建立的 thin-entrypoint + shared-handler 模式。
- 加購物車/建立訂單是否也需要冪等 key（防止重複點擊「加入購物車」造成數量重複疊加、或
  重複送出結帳造成重複訂單）——需要在盤點階段確認實際的使用者互動節奏後決定。
- 完成 05B-2B 且前端全部改接、回歸通過後，才是 `20260816000000` RLS migration 真正可以
  排入部署計畫的時間點（見上方「05C Staging Gate」與 `review-auth-05B-1-hotfix.md`）。

## 明確聲明

- 本次任務**沒有**執行 `supabase functions deploy`（無論 staging 或 Production）。
- 本次任務**沒有**執行 `supabase db push` 或以任何形式套用本次新增的四個 migration，也
  沒有套用既有的 `20260816000000`（RLS）或 `20260816000300`（mascot dedup + 唯一約束）。
- 本次僅在本機執行 `node --check` 與 `node --test`（`.\scripts\verify-local.ps1`），全部
  通過（508/508）。
- 本文件**不**宣告「整體 05B 完成」——05B-2B（Cart/Orders 安全寫入 API）完全尚未開始。
