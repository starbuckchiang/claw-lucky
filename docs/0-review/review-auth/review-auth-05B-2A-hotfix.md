# P-AUTH-05B-2A Hotfix — Business-Authority 漏洞修正 — Review

**狀態：修正 P-AUTH-05B-2A 版 Gacha/Gift Secure Write API 的 business-authority 漏洞（前端仍可
決定/影響抽獎結果、仍存在通用任意餘額調整能力、仍存在獨立吉祥物寫入路由）。可見 UI／使用者操作流程
完全未變動。未部署 Production，未套用任何 migration（含既有與本次修改的全部檔案）。**

延續 P-AUTH-05 系列的三關卡框架：本文件仍屬於 **05B Implementation** 底下的 Gacha/Gift 子範圍
（**05B-2A**）。**Gate 狀態不變**：05B-2A（本次連同 hotfix）完成候選；05B-2B（Cart/Orders）尚未
開始；05C Staging Gate 完全未執行。

新增 [threat-model-wallet-ops.md](./threat-model-wallet-ops.md)（本次任務要求的「更新 threat
model」——這是這個攻擊面的**第一份**威脅模型文件，之後任何相關變更都應該回來更新它，而不是另開新檔）。

## 根因總覽

P-AUTH-05B-2A 完成後的實作雖然已經把「餘額寫入」「吉祥物寫入」「兌換」都改成 SECURITY DEFINER RPC
+ JWT 身份驗證，但有三個具體的 **business-authority**（業務權威）漏洞未被封閉：

1. **`gacha-draw` 仍接受呼叫端提供的 `mascotId`**——伺服器只是「誠實地」依照這個 client 指定的
   mascotId 查表給獎勵，但**抽中哪一隻吉祥物**這個決定本身仍在前端（`GachaEngine.drawOnce()`）做出。
   一個修改過的前端可以永遠回報最高稀有度吉祥物的 id，每次都拿到最高獎勵，完全繞過機率設計。
2. **存在通用的 `adjust-balance` 路由**，接受任意 `pointsDelta`/`ticketsDelta`/`coinsDelta`——即使
   身份驗證正確，這仍是一個「萬用餘額調整」入口，且其唯一實際呼叫端（觀看廣告獎勵）本身完全沒有
   任何可驗證使用者真的看完廣告的機制（見下）。
3. **存在獨立的 `upsert-mascot` 路由**——吉祥物寫入不需要跟扣款/紀錄綁定在同一次操作，可以被單獨
   呼叫，且與抽獎的原子性交易脫鉤。

## 修正內容（對應 8 項需求）

### 1. Gacha Draw 改為完全伺服器端決定結果（需求 1）

- `supabase/migrations/20260817000200_gacha_draw_secure_rpc.sql`：
  - 新增 `public.mascot_rarities` 設定表，權重與 `js/data/gacha-data.js` 既有的
    `rarities`（N:62／R:25／SR:10／SSR:3）完全一致——移動到伺服器端不改變實際機率。
  - `claim_gacha_draw(p_user_id, p_idempotency_key)`——**簽章從 3 個參數改為 2 個，完全移除
    `p_mascot_id`**。函式內部：依權重亂數（`random() * SUM(rate)`，逐一扣減 `rate` 直到餘數小於
    0）決定稀有度，再在該稀有度的啟用吉祥物中 `ORDER BY random() LIMIT 1` 隨機挑一隻（若該稀有度
    池剛好是空的，退而挑選任意啟用吉祥物，而不是直接讓抽獎失敗）。
  - `gacha_draw_requests` 新增 `mascot_name`/`rarity`/`image` 欄位，讓冪等重送可以完全依賴快取
    列本身回傳結果，不需要重新查 `mascots`（也不會因為之後目錄異動而讓重送結果變動）。
- `supabase/functions/_shared/wallet-ops-handler.js`／`.ts`：`validateGachaDrawRequestShape` 的
  allowlist**只剩 `idempotencyKey`**——`mascotId`/`pointsEarned`/`ticketsEarned`/`rarity`/`isNew`
  等欄位出現在 request body 就直接 `400 INVALID_REQUEST`（與 owner-id 偽造同一套拒絕邏輯），不是
  「忽略但繼續處理」。
- `js/services/wallet/wallet-ops-repository.js`／`.ts`：`claimGachaDraw({userId, idempotencyKey})`
  ——移除 `mascotId` 參數。
- `js/api.js`：`Api.claimGachaDraw({idempotencyKey})`——同樣移除 `mascotId`。
- `js/pages/gacha.js`：`handleDrawClick()` 不再呼叫 `GachaEngine.drawOnce()` 來「決定」抽獎結果
  ——改成直接呼叫 `Api.claimGachaDraw({idempotencyKey})`，再用伺服器回傳的
  `mascot_id`/`mascot_name`/`rarity`/`image`/`is_new`/`points_earned`/`tickets_earned` 組出既有
  UI 需要的 `result` 物件（`buildResultFromServerClaim()`——只從**本地目錄**補上 `title`/
  `description`/`silhouette` 這些純展示欄位，絕不用本地資料決定業務結果）。動畫/結果卡片/Topbar
  更新的**可見行為完全不變**，只是資料來源從「前端自己決定」變成「伺服器回傳」。

### 2. 移除通用 adjust-balance 能力（需求 2）

- `supabase/migrations/20260817000100_ensure_user_row_and_generic_balance_adjustment.sql`：
  **整個刪除** `apply_generic_balance_adjustment()` 函式（含其 REVOKE/GRANT），只保留
  `ensure_user_row()`。
- `supabase/functions/_shared/wallet-ops-handler.js`／`.ts`：移除
  `handleAdjustBalanceRequest`/`validateAdjustBalanceRequestShape`/
  `classifyGenericBalanceFailureReason`，`wallet-ops/index.ts` 移除 `/adjust-balance` 路由——
  整條 HTTP 路徑完全不存在。
- `js/api.js`：`Api.adjustBalance()` 改為**一律拋出例外**的 deprecated stub（見需求 7）。

### 3. 移除獨立 upsert-mascot 路由（需求 3）

- `upsert_user_mascot_obtain()` SQL 函式**保留**（`claim_gacha_draw` 內部仍需要呼叫它），但
  `wallet-ops-handler.js`／`.ts` 移除 `handleUpsertMascotRequest`/
  `validateUpsertMascotRequestShape`，`index.ts` 移除 `/upsert-mascot` 路由，
  `wallet-ops-repository.js`／`.ts` 移除 `upsertMascot()` 方法——**沒有任何 HTTP 入口**可以獨立
  呼叫這個函式。
- `js/api.js`：`Api.upsertUserMascot()` 改為**一律拋出例外**的 deprecated stub。

### 4. 暫停「觀看廣告獎勵」（需求 4）

確認 `js/ui/ad-modal.js`／`js/game/ad-reward.js` 的「影片播放完成」訊號**純粹是瀏覽器端 JS 狀態**
（`<video>` 的 `ended` 事件監聽），沒有任何伺服器可驗證的 token/callback（見
[threat-model-wallet-ops.md](./threat-model-wallet-ops.md) T5）。依需求 4 的第一個選項——「暫停
發幣」：

- `js/game/ad-reward.js`：`grantReward()` **不再呼叫任何伺服器加幣操作**，改為顯示
  「好運補給站目前維護中，暫不提供影片獎勵，敬請期待！」，`AdStorage` 的每日次數計數器也不再遞增
  （因為沒有真的發放獎勵）。
- 這是**明確記錄在案的 blocker**：唯有未來真的串接可驗證的廣告完成回呼（例如廣告聯播網的
  server-to-server postback）才應該恢復；届時應該是一個**全新的、金額固定**的專屬 RPC（例如
  `claim_watch_ad_reward(p_user_id, p_idempotency_key)`）+ 伺服器端頻率限制 + 自己的冪等紀錄表
  ——而不是重新啟用需求 2 已移除的通用調整 API。這個設計方向已寫進
  `20260817000100_ensure_user_row_and_generic_balance_adjustment.sql` 的檔案開頭註解。

### 5. Idempotency Key 生命週期修正（需求 5）

- **問題**：P-AUTH-05B-2A 原本讓 `js/api.js`'s `claimGachaDraw()`/`redeemGift()` 各自在函式內部
  用 `generateIdempotencyKey()` **每次呼叫都重新產生**一把新 key——代表「使用者點擊失敗後重新點擊」
  在當時的實作裡永遠被當成一個全新操作，而不是同一次操作的重試，讓「回應遺失後重試」這個情境完全
  沒有真正被冪等機制覆蓋到（即使底層 RPC/Handler 層邏輯是對的，前端從未真正重送過同一把 key）。
- **修正**：
  - `js/api.js`：`claimGachaDraw({idempotencyKey})`/`redeemGift({..., idempotencyKey})` 現在
    **要求呼叫端提供** `idempotencyKey`（缺少就拋錯），自己不再產生。
  - `js/pages/gacha.js`：新增 `pendingDrawIdempotencyKey` 頁面層狀態，`getOrCreateDrawIdempotencyKey()`
    在**操作開始時**（`handleDrawClick()` 最上層，早於任何非同步呼叫）產生一次；只有在該次操作
    **明確完成**（成功，或伺服器回傳 `retryable:false` 的確定性業務失敗）才清除；若是
    `error.retryable === true`（網路層失敗），保留同一把 key，等待使用者重新點擊時沿用。
  - `js/gift.js`：`handleRedeem(giftId)` 同樣新增 `pendingRedeemGiftId`/`pendingRedeemIdempotencyKey`
    ——同一個 `giftId` 的重試沿用同一把 key；不同 `giftId` 一律視為全新操作，產生新 key。
  - `js/api.js`：`invokeWalletOpsFunction()` 改為明確區分「有 HTTP 回應」（`error.context` 存在
    ——這是伺服器已經做出的業務決定，`retryable:false`）與「完全沒有收到 HTTP 回應」（無
    `error.context`——真正的網路層失敗，`retryable:true`）。
  - `supabase/functions/_shared/wallet-ops-handler.js`／`.ts`：每個錯誤回應現在都帶
    `retryable` 欄位——具體業務拒絕（餘額不足/庫存不足/找不到資料）一律 `false`；無法辨識的/RPC
    層級失敗（含跨帳號冪等金鑰重放，故意不特殊處理）一律 `true`（`GACHA_DRAW_FAILED`/
    `GIFT_REDEEM_FAILED`/`ENSURE_USER_FAILED` 的通用分支）。
  - 「按鈕請求期間鎖定」沿用既有的 `isDrawing`/`state.isRedeeming` 旗標（P-AUTH-05B-2A 就已存在），
    本次未變動。

### 6. 補測（需求 6）

`supabase/functions/_shared/__tests__/wallet-ops-handler.test.js` 新增/改寫：

- 竄改 `mascotId`/`rewardPoints`/`pointsEarned`/`ticketsEarned`/`rarity`/`delta`/`isNew`：全部
  被 allowlist 拒絕（400），從未觸及 repository。
- 「最高稀有度不能由前端指定」：`{idempotencyKey, mascotId:'legendary-mascot', rarity:'SSR'}` 直接
  400，repository 從未被呼叫。
- 真實雙擊（`Promise.all` 同一把 `idempotencyKey`）：gacha-draw／gift-redeem 各自的有狀態假
  repository 證明只真正「執行」一次。
- 回應遺失重試（循序重送同一把 `idempotencyKey`）：同上，回傳完全相同的快取結果。
- 不同 key 代表兩次明確操作：`k-1`/`k-2` 兩把不同 key 各自獨立套用，`appliedCount` 增加兩次，
  結果彼此不同（新增測試，gacha-draw／gift-redeem 各一個）。
- `retryable` 欄位正確性：具體業務拒絕一律 `false`；通用/未知失敗一律 `true`（新增測試）。
- 既有的 owner 偽造、跨帳號冪等重放、餘額不足、安全日誌測試沿用並調整為 3 條路由（移除
  adjust-balance／upsert-mascot 對應測試）。
- `supabase/migrations/__tests__/wallet-secure-write-rpcs-shape.test.js` 新增：`claim_gacha_draw`
  簽章只有 2 個參數且函式本體內不含 `p_mascot_id`；`mascot_rarities` 權重種子資料與 RLS；權重亂數
  roulette 選取邏輯的靜態文字驗證；`apply_generic_balance_adjustment` 已不存在的斷言。

### 7. Deprecated 方法明確拒絕，不 fallback 到不安全直接寫入（需求 7）

`js/api.js`：`Api.adjustBalance()`／`Api.upsertUserMascot()` 現在是**一律拋出例外**的 stub（中文
錯誤訊息說明已停用原因），**完全不呼叫網路、不觸碰資料庫**——不是「悄悄地什麼都不做」，也**絕對不會**
退回到 P-AUTH-05B-2A 之前那種瀏覽器 anon-key 直接寫入資料表的舊行為。`createUserIfNotExists`／
`redeemGift`／新的 `claimGachaDraw` 三個仍有合法用途的方法維持原本（或依需求 1/5 微調過的）呼叫
簽章，讓既有呼叫點（`js/user.js`、`js/gift.js`）不需要重寫整個呼叫方式。

### 8. Threat Model 與本文件（需求 8）

見 [threat-model-wallet-ops.md](./threat-model-wallet-ops.md)（新建立，涵蓋 T1～T10 的威脅/防護
對照表與已知殘留風險）。本文件（review-auth-05B-2A-hotfix.md）為對應的階段性 Review。

## 修改的檔案

| 檔案 | 變更 |
|---|---|
| `supabase/migrations/20260817000100_ensure_user_row_and_generic_balance_adjustment.sql` | 刪除 `apply_generic_balance_adjustment`；保留 `ensure_user_row`；更新檔頭說明。 |
| `supabase/migrations/20260817000200_gacha_draw_secure_rpc.sql` | `claim_gacha_draw` 簽章從 3 參數改 2 參數（移除 `p_mascot_id`）；新增 `mascot_rarities` 表 + 權重亂數選取邏輯；`gacha_draw_requests` 新增 `mascot_name`/`rarity`/`image` 欄位。 |
| `supabase/functions/_shared/wallet-ops-handler.js`／`.ts` | 移除 adjust-balance／upsert-mascot 處理；`gacha-draw` allowlist 改為只有 `idempotencyKey`；新增 `retryable` 欄位。 |
| `supabase/functions/wallet-ops/index.ts` | 移除 `/adjust-balance`／`/upsert-mascot` 路由。 |
| `js/services/wallet/wallet-ops-repository.js`／`.ts` | 移除 `adjustBalance`／`upsertMascot`；`claimGachaDraw` 移除 `mascotId` 參數。 |
| `js/api.js` | `adjustBalance`／`upsertUserMascot` 改為 deprecated 拋錯 stub；`claimGachaDraw`／`redeemGift` 要求呼叫端提供 `idempotencyKey`；`invokeWalletOpsFunction` 區分網路層/業務層失敗並標記 `retryable`。 |
| `js/pages/gacha.js` | 移除呼叫 `GachaEngine.drawOnce()` 決定結果；新增 `pendingDrawIdempotencyKey` 生命週期管理；新增 `buildResultFromServerClaim()`。 |
| `js/gift.js` | 新增 `pendingRedeemGiftId`／`pendingRedeemIdempotencyKey` 生命週期管理。 |
| `js/game/ad-reward.js` | `grantReward()` 暫停實際發幣，改為維護中訊息。 |
| `supabase/functions/_shared/__tests__/wallet-ops-handler.test.js` | 大幅改寫（見需求 6）。 |
| `js/services/wallet/__tests__/wallet-ops-repository.test.js` | 更新 `claimGachaDraw` 測試（2 參數），移除 adjustBalance／upsertMascot 測試。 |
| `supabase/migrations/__tests__/wallet-secure-write-rpcs-shape.test.js` | 更新/新增（見需求 6）。 |
| `docs/0-review/review-auth/threat-model-wallet-ops.md` | 新建立。 |

未修改：`supabase/migrations/20260816000000`～`20260816000400`、`20260817000000`（ticket/coin
ledger，未受影響）、`20260817000300`（gift redeem，未受影響）、任何 HTML 結構、`gacha.html`/
`gift.html` 的可見流程、任何方案/價格設定。

## 執行 `.\scripts\verify-local.ps1`

```
== Syntax Check ==  全數通過
== Unit Tests ==
ℹ tests 497
ℹ pass 497
ℹ fail 0
Verification Complete
```

（上一個查核點是 P-AUTH-05B-2A 完成時的 508/508；本次因移除 adjust-balance／upsert-mascot 對應
測試、同時新增更多針對性測試，淨變化為 497。）

## 05C Staging Gate（延續既有清單，補充本次相關項目）

除既有 `review-auth-05B-2A.md` 列出的項目外，本次新增：

1. **權重亂數分布驗證**：部署到 staging 後，實際跑幾千次抽獎，統計各稀有度出現比例是否貼近設計值
   （N:62%／R:25%／SR:10%／SSR:3%）——本次只能靜態驗證「選取邏輯的程式碼結構正確」，無法驗證真實
   分布。
2. **`mascot_rarities`/`mascots` 資料一致性**：若某個稀有度在 `mascots` 目錄裡完全沒有 `enabled=true`
   的列，確認 fallback（改選任意啟用吉祥物）在真實資料下確實觸發且行為合理。
3. **`retryable` 旗標的真實網路失敗驗證**：真的斷線/timeout 一次，確認 `invokeWalletOpsFunction`
   正確判斷為 `error.context` 不存在、標記 `retryable:true`，且前端确实保留同一把 `idempotencyKey`
   給下次點擊使用。

**在以上（含 `review-auth-05B-2A.md` 原有清單）全部通過之前，不得部署 `wallet-ops` Edge Function
或套用任何相關 migration 到 Production；`20260816000000` RLS migration 仍需等待 05B-2B 完成。**

## 明確聲明

- 本次任務**沒有**執行 `supabase functions deploy`（無論 staging 或 Production）。
- 本次任務**沒有**執行 `supabase db push` 或以任何形式套用任何 migration。
- 本次僅在本機執行 `node --check` 與 `node --test`（`.\scripts\verify-local.ps1`），全部通過
  （497/497）。
- 本文件**不**宣告「整體 05B 完成」——05B-2B（Cart/Orders）完全尚未開始。
