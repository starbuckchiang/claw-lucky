先只讀：
#file docs/working-prompts/prompts-auth-05B-2B.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。
請執行 Auth / Security Gate 05B-2B：Cart 與 Orders 安全化。

重要限制：

1. 不得大規模重構現有程式。
2. 保留現有 UI、頁面結構及公開函式介面；必要時只能加入相容 adapter。
3. 不得部署 production。
4. 不得修改或新增 production RLS migration。
5. 不得把 service role key、資料庫密碼或其他 secret 放到前端。
6. 不得以「隱藏按鈕」或前端驗證作為安全邊界。
7. 05B-2A 的 Wallet/Gacha/Gift 行為不得退化。
8. 執行前先建立 git checkpoint。
9. 先盤點再修改，不得先猜測資料表結構。

目標：

將 Cart / Orders 的關鍵寫入改為 server-authoritative，防止使用者竄改 user_id、商品價格、數量、庫存、訂單總額或重送請求造成重複訂單。

一、盤點

盤點並記錄：

* `shop-api.js`
* `shop_cart.js`
* 商品頁、購物車頁、結帳頁相關 JavaScript
* 所有 cart / order / order_items 的直接 insert、update、delete
* 所有接受 `user_id`、price、subtotal、total、stock 的前端寫入
* 現有 Edge Function、RPC、資料表及欄位
* 現有登入、匿名 Auth 與 owner 判斷方式

建立完整 caller → API → DB 寫入表。

二、身份與 ownership

所有受保護操作必須：

* 從已驗證 JWT 取得使用者 UID。
* 不得信任 request body、query string 或 localStorage 傳入的 `user_id`。
* 確認 cart、cart item、order 的 owner 與 JWT UID 相符。
* 未登入、token 無效或 ownership 不符時 fail closed。
* 不得回退至舊的前端直接寫入。

三、Cart 寫入

將以下操作改為可信任後端路徑：

* add item
* update quantity
* remove item
* clear cart

後端必須自行驗證：

* product 是否存在。
* product 是否可販售。
* quantity 是否為允許的正整數及合理範圍。
* 商品是否有足夠庫存；若目前產品模型不在加入購物車時保留庫存，需清楚記錄並在 checkout 再次驗證。
* cart owner 是否為目前 JWT UID。

前端不得決定或寫入：

* 商品單價
* subtotal
* total
* owner UID
* 庫存結果
* 商品名稱或其他訂單快照欄位

若 cart 顯示價格，必須以後端／資料庫商品資料重新計算，不得把前端傳入價格當作真值。

四、Checkout / Order 建立

建立 server-authoritative checkout 邊界。

後端必須在交易或等效原子流程中：

1. 取得 JWT UID。
2. 鎖定或穩定讀取該使用者 cart。
3. 重新載入商品的正式價格、庫存及販售狀態。
4. 驗證每個品項與數量。
5. 以正式價格計算 subtotal / total。
6. 建立 order。
7. 建立 order_items，保存後端決定的商品快照與價格。
8. 依現有資料模型處理庫存；不得讓庫存變成負數。
9. 防止相同 checkout request 建立兩張訂單。
10. 完成後才清空或標記 cart。

如果目前沒有正式付款整合：

* 不得顯示「付款成功」。
* 訂單只能進入符合現況的 pending、draft 或 awaiting_payment 狀態。
* 不得自行發明 webhook 已完成或付款已確認。

五、Idempotency

checkout 必須支援穩定 idempotency key：

* 一次使用者 checkout intent 產生一個 key。
* timeout、502、斷線或未知結果後重試，必須沿用同一 key。
* 新的 checkout intent 才能產生新 key。
* 後端必須有唯一性約束或等效保護。
* 相同 UID + operation + idempotency key 只能產生一張 order。
* 若第一次已 commit 但 response 遺失，第二次必須回傳既有 order，不得重複扣庫存或建立 order。
* 只有成功或確定 non-retryable business error 才能清除 pending key。
* 未知網路錯誤、無 response、502/503、response 無法解析，必須保留 key。

Cart add/update/remove 若已有重試機制，也必須避免一次操作因網路重送而重複套用；不得把使用者兩次明確點擊錯誤合併成同一 intent。

六、錯誤分類

沿用 05B-2A.1 的原則：

* 後端明確回傳 `retryable: false` 的確定性業務錯誤，前端才可停止沿用 pending key。
* 無 response、非 JSON、格式錯誤、缺少 retryable、502/503 等不確定結果，預設視為 retryable。
* 不得因為存在 `error.context` 就直接判定 non-retryable。

七、測試

至少新增以下自動測試：

Cart：

1. request body 偽造另一個 user_id 時，仍只能操作 JWT owner 的 cart，或直接拒絕。
2. 前端偽造低價、subtotal、total 不會影響正式價格。
3. 無效商品、停售商品、quantity 0、負數、非整數及超量均被拒絕。
4. 使用者不能修改或刪除其他人的 cart item。
5. 後端失敗時不得 fallback 到直接寫資料庫。

Checkout：

6. 相同 idempotency key 重送只建立一張 order。
7. 第一次 DB commit 成功但 response 遺失，第二次同 key 回傳同一 order。
8. 上述情境庫存只扣一次。
9. 不同 idempotency key 可建立新的合法 checkout intent。
10. checkout 時價格已變動，訂單使用後端最新正式價格。
11. checkout 時庫存不足，整筆失敗，不得建立半成品 order。
12. order 與 order_items 不得使用 request body 偽造的 owner、價格或總額。
13. 並行 checkout 不得讓庫存為負數。
14. 未登入或 JWT 無效時 fail closed。
15. 不得錯誤宣告付款成功。

Regression：

16. 執行完整既有測試。
17. Wallet / Gacha / Gift 測試必須維持通過。
18. 記錄測試總數、通過數與失敗數。

八、輸出

建立：

`review-auth-05B-2B.md`

報告必須包含：

* git checkpoint
* 修改檔案
* caller → API → DB 寫入盤點
* Cart ownership 與價格安全邊界
* Checkout transaction 流程
* idempotency 設計
* retryable / non-retryable 規則
* 新增測試與完整測試結果
* 尚未完成項目
* 是否有 migration
* 是否有 deployment
* rollback 方法
* Gate 結論：PASS / PARTIAL / FAIL

完成後停止，不要部署，不要進入 05C。
