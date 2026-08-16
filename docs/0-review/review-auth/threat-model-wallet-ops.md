# Threat Model — Gacha / Gift / Wallet-Ops Secure Write APIs

**狀態：本文件由 P-AUTH-05B-2A Hotfix 建立（第一版），並由 P-AUTH-05B-2A.1 Hotfix 更新（T7/T11）。**
涵蓋 `wallet-ops` Edge Function（`ensure-user`／`gacha-draw`／`gift-redeem`）與其背後的 SECURITY
DEFINER RPC 的攻擊面。之後任何對這個攻擊面的變更（例如 05B-2B Cart/Orders、未來的 watch-ad 驗證
機制）都應該回來更新本文件，而不是另開一份新文件。

## 資產（Assets）

- 使用者的 `points`／`tickets`／`coins` 餘額（含其 ledger：`point_transactions`／
  `ticket_transactions`／`coin_transactions`）。
- 使用者的吉祥物收藏（`user_mascots`，含 `obtain_count`）。
- 禮物庫存（`gifts.stock`）與兌換紀錄（`redeem_history`）。
- 冪等紀錄表（`gacha_draw_requests`／`gift_redemption_requests`）本身（防止重放/重複執行）。

## 角色（Actors）

- **一般使用者**：透過瀏覽器（含匿名 Auth Session）操作前端 UI，只能透過 `wallet-ops` Edge Function
  呼叫，永遠帶有自己的 JWT。
- **惡意使用者**：擁有合法帳號/匿名 Session，但直接用 devtools／curl 呼叫 Edge Function，嘗試傳送
  不同於 UI 正常流程的 request body（例如自訂 `mascotId`、`pointsDelta`、別人的 `user_id`）。
- **未認證攻擊者**：沒有任何有效 Session，嘗試直接呼叫 Edge Function。

## 威脅與對應防護

| # | 威脅 | 情境 | 防護（本次/既有） |
|---|---|---|---|
| T1 | **Owner ID 偽造** | 惡意使用者在 request body 塞入 `userId`/`user_id`/`ownerId`/`owner_id`，企圖操作別人的帳號。 | 所有路由的身份一律來自 `resolveAuthenticatedUser(req)`（JWT 驗證），**絕不**讀取 body；body 額外用 allowlist 明確拒絕這四個欄位（400），即使欄位值等於自己的真實 id 也一樣拒絕（不開特例）。 |
| T2 | **業務權威竄改（本次 Hotfix 核心修正）** | 惡意使用者直接呼叫 `gacha-draw` 並自訂 `mascotId`（例如永遠指定最高稀有度）、或自訂 `pointsEarned`/`ticketsEarned`/`isNew`；或呼叫舊版 `gift-redeem` 自訂 `pointsCost:0`。 | **Gacha**：`mascotId`/reward/rarity 完全不是 request body 的合法欄位（allowlist 只有 `idempotencyKey`）；`claim_gacha_draw` RPC 自己用權重亂數決定稀有度、自己在稀有度池內隨機挑一隻吉祥物，客戶端無法指定或影響結果。**Gift**：成本/名稱一律從 `gifts` 表（鎖定的列）查出，從未讀取呼叫端提供的值。 |
| T3 | **任意餘額調整（本次 Hotfix 移除）** | 舊版 `adjust-balance` 路由允許任意 `pointsDelta`/`ticketsDelta`/`coinsDelta`——即使身份驗證正確，仍可能被用來無限加值（例如透過某個看似無害的呼叫點被重放/濫用）。 | **整條路由與底層 RPC 已刪除**——沒有任何管道可以送出任意數值的餘額調整。每種真正的獎勵都必須是專屬、伺服器定義金額的 operation（`gacha-draw`／`gift-redeem`，未來若有其他需求需各自新增專屬 RPC）。 |
| T4 | **未經授權的吉祥物寫入** | 舊版 `upsert-mascot` 路由允許任何呼叫端把任意吉祥物塞進任意（自己的）收藏，且沒有與扣款/紀錄綁定，可被單獨呼叫刷收藏。 | **整條路由已刪除**——`upsert_user_mascot_obtain()` 現在只能被 `claim_gacha_draw()` 在同一筆交易內部呼叫，沒有獨立對外入口。`Api.upsertUserMascot()` 前端方法變成一律拋錯的 deprecated stub。 |
| T5 | **未經驗證的廣告獎勵領取** | `js/ui/ad-modal.js` 的「影片播放完成」訊號純粹是瀏覽器端 JS 狀態（`<video>` 的 `ended` 事件），可被輕易偽造（例如直接在 devtools 呼叫 `window.AdModal.close()`，完全不播放影片）。舊版流程據此訊號直接加幣，任何人都可以無限次「假裝看完廣告」換幣。 | **本次 Hotfix 明確暫停**：`grantReward()` 不再呼叫任何伺服器端加幣操作，改為顯示「目前維護中」訊息。底層 `apply_generic_balance_adjustment` RPC 已整個移除（見 T3）。**這是一個明確、記錄在案的 blocker**：在有真正可驗證的廣告完成回呼（例如廣告聯播網的 server-to-server postback、簽章 token）之前，不應該恢復這個功能；若未來要恢復，必須是新的、金額固定的專屬 RPC + 自己的頻率限制（伺服器端，非 localStorage）+ 冪等紀錄，而不是重新啟用一個通用調整 API。 |
| T6 | **冪等金鑰重放跨帳號** | 攻擊者猜到/取得另一個使用者曾經用過的 `idempotencyKey`，用自己的身份重放，企圖讀到對方的抽獎/兌換結果，或觸發某種非預期行為。 | `claim_gacha_draw`/`redeem_gift_transaction` 的冪等查詢**在鎖定之後立刻比對** `cached.user_id` 是否等於呼叫者自己驗證過的 `p_user_id`，不符就丟例外；Handler 層把這個例外與其他「未知原因」的失敗**收斂成完全相同的通用錯誤**（狀態碼、代碼、訊息都相同），攻擊者無法從回應差異判斷猜測是否「差一點就成功」。 |
| T7 | **重複點擊／網路重試造成重複扣款發獎** | 使用者真的連續點擊兩次「轉一次」／「兌換」按鈕；或請求送出後網路中斷/收到 500/502/503/504，使用者不確定有沒有成功而重新點擊。 | 前端（`gacha.js`/`gift.js`）在單一操作**開始時**產生一次 `idempotencyKey`，並保存在頁面記憶體中；只有在該次操作明確完成（成功，或伺服器明確回傳 `retryable:false` 的確定性業務拒絕）後才清除——任何不確定/傳輸層級的失敗（`error.retryable === true`，見 T11 修正後的正確分類）會**保留同一把 key** 供下次點擊重用。伺服器端的冪等表（`gacha_draw_requests`/`gift_redemption_requests`）以此 key 為主鍵，重送只會回傳快取結果，不會二次扣款/發獎/寫入。真正的「兩次點擊 = 兩個不同 key」時（例如使用者刻意連續抽兩次），每個 key 各自視為獨立、合法的操作，不會被誤判成重複。 |
| T8 | **競態條件（同一時間兩個請求同時執行）** | 兩個併發請求同時嘗試扣同一個使用者的最後 1 枚好運幣，或同時兌換同一件商品的最後一件庫存。 | `users`/`gifts`/`user_mascots` 相關列在交易一開始就用 `SELECT ... FOR UPDATE` 鎖定，所有餘額/庫存檢查都在鎖定之後、任何 mutation 之前完成；真實 Postgres 併發行為無法在本機（無 Deno/Postgres）用靜態測試證明，**明確列為 05C Staging Gate 事項**。 |
| T9 | **敏感資訊外洩至伺服器日誌** | 若某個未來的 code path 不小心把 `user_id`/Email/JWT/完整 request body 印進 log，即使只是給維運人員看，也構成資料外洩風險。 | 每個路由的失敗處理只記錄 `correlationId` + 一個固定 allowlist 的 `reason` 代碼；已用「刻意在錯誤訊息裡塞入假 user id/Email」的測試驗證 defense-in-depth（即使某個底層錯誤訊息意外包含這類資訊，也不會出現在最終 log 輸出裡）。 |
| T10 | **依賴未套用的 migration 導致部署順序錯誤** | 若有人不小心先部署 `20260817000200`（依賴 `20260816000300` 的唯一約束）而沒有先套用 `20260816000300`，`ON CONFLICT (user_id, mascot_id)` 會直接報錯。 | 兩份文件都明確標註依賴關係與必要順序（`20260816000300` 需先 dry-run + 備份 + 套用），且**本次任務全部未套用任何 migration**，純粹是文件層級的部署順序警告。 |
| T11 | **客戶端 retryable 判斷錯誤，導致該重試的操作被誤判為「已完成」（P-AUTH-05B-2A.1 Hotfix 修正）** | P-AUTH-05B-2A 版的 `js/api.js`'s `invokeWalletOpsFunction()` 只要 `error.context` 存在（代表收到某種 HTTP 回應）就**一律**標記 `retryable:false`——即使那個回應其實是無法解析的 502 Bad Gateway 錯誤頁面（不是我們自己的 JSON 錯誤格式）、或伺服器其實有回傳 `retryable:true` 但客戶端沒有讀取。這會讓「資料庫其實已經 commit，但第一次 HTTP 回應在傳輸中遺失/損毀」的情境被前端誤判成「確定性失敗」，清除掉 `pendingDrawIdempotencyKey`/`pendingRedeemIdempotencyKey`，導致使用者下次點擊會產生**全新**的 `idempotencyKey`，讓伺服器端的冪等保護完全失效（因為冪等表是以 key 為主鍵，新 key = 全新操作，會真的再抽一次/再兌換一次/再扣一次款）。 | **修正**：`invokeWalletOpsFunction()` 現在只有在**成功解析**出這個應用程式自己的 `{ok:false, error:{...}}` JSON 主體、且該主體明確帶有 `retryable:false` 時，才判定為不可重試；其餘所有情況（HTTP 500/502/503/504 但主體不是我們自己的 JSON 格式、JSON 解析失敗、解析成功但沒有 `error` 欄位、解析成功但缺少 `retryable` 欄位、`FunctionsFetchError`/完全斷線）**一律預設 `retryable:true`**，永遠保留原本的 `idempotencyKey` 供下次點擊沿用。新增 `js/__tests__/api.test.js` 直接驗證「第一次回應是遺失/502，第二次用同一把 key 重試只回傳原本快取結果，底層『真的執行了幾次』的計數器停在 1」這個端到端情境。 |

## 已知殘留風險（Accepted / Out of Scope）

- **扭蛋動畫仍由前端播放**：伺服器決定結果後，前端只是把結果套進既有的 `GachaEngine`/`GachaUI`
  播放邏輯——這只是視覺呈現，不影響任何資料正確性（T2 已經封閉了「client 決定結果」的攻擊面）。
- **Postgres `random()` 非密碼學安全亂數**：這是遊戲機制的合理選擇（不是保密用途的亂數），攻擊者
  無法從客戶端影響或預測伺服器端的隨機序列，殘留風險視為可接受。
- **T5（廣告獎勵）目前是「暫停」而非「修復」**：真正修復需要串接一個有 server-to-server 驗證能力的
  廣告 SDK，超出本次 hotfix 範圍，列為明確 blocker（見上表）。
- **併發/真實 Postgres 行為未經真實驗證**（T8）：所有 `FOR UPDATE` 鎖定/交易語意都只能靠靜態 SQL
  結構測試佐證程式碼「看起來正確」，需要 05C Staging Gate 的真實驗證才能視為確認。

## 下次更新本文件的時機

- 05B-2B（Cart/Orders 安全寫入 API）完成時，補上對應的威脅列。
- 若未來真的要恢復 watch-ad 獎勵（T5），更新該列的防護狀態並記錄新 RPC 的設計。
- 05C Staging Gate 的真實驗證結果出來後，更新 T8/相關列的「已驗證」狀態。
- 若前端 `invokeWalletOpsFunction()`/idempotencyKey 生命週期管理邏輯再次變動，更新 T7/T11。
