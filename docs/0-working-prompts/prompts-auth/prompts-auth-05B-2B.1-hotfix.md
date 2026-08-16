先只讀：
#file docs/working-prompts/prompts-auth-05B-2B.1-hotfix.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。
請執行 P-AUTH-05B-2B.1 hotfix。不得重構、不得部署、不得修改既有 migration，只能新增修正 migration 與必要測試。

目前 05B-2B 維持 PARTIAL，請修正以下問題：

1. Checkout 相同 idempotency key 的並行競態
目前流程先查 shop_checkout_requests，再鎖 cart。兩個並行同 key 請求可能同時查不到紀錄；第二個等待後得到 CART_EMPTY，而非回傳第一張訂單。

必須改成資料庫層真正序列化同一 checkout intent：
- 在處理 cart、扣庫存及建立 order 前，先原子 claim/lock `(user_id, idempotency_key)`。
- 相同 key 的第二個請求必須等待第一個 transaction。
- 等待結束後重新讀取該 idempotency record。
- 第一個成功時，第二個必須回傳相同 order/result。
- 第一個 rollback 時，第二個才可安全接手或重試。
- 不得以捕捉 unique violation 後直接回 CART_EMPTY 代替。
- idempotency key 必須綁定 UID；不同 UID 使用相同 key 不得取得他人訂單。

可使用 advisory transaction lock，或先建立 processing record 再 SELECT FOR UPDATE；請選擇最小、安全且能正確處理 rollback 的方案。

2. 確認 orders.order_no
盤點實際 schema、migration、default 或 trigger：
- 若 order_no 為 NOT NULL，確認 checkout INSERT 一定能產生合法且唯一的 order_no。
- 不得只假設 production 有未記錄的 trigger。
- 若 repo 無法證明其產生方式，標示 staging blocker，不能宣稱完成。

3. 補齊測試
至少新增：
- 兩個真正並行、相同 UID＋相同 key 的 checkout，只建立一張 order。
- 兩個回應取得相同 order_id。
- 庫存只扣一次。
- order_items 只建立一次。
- 第一個 transaction rollback 後，第二個不會取得半成品結果。
- 不同 UID 使用相同 key，不得洩漏或取得他人 order。
- 不同 key 的合法 checkout intent 行為保持正確。
- CART_EMPTY 不得覆蓋已完成的同 key checkout 結果。
- order_no 的 schema/default/trigger 結構測試。
- 完整 regression 測試。

若本機沒有真實 Postgres：
- 靜態測試不能標記並行行為為已驗證。
- 仍須設計可在 05C staging 執行的真實 concurrency integration test。
- 報告中分開標示 static PASS 與 runtime NOT RUN。

4. 檢查報告敘述
修正「migration 不修改任何 existing table」等可能誤導的敘述，明確區分：
- 新增 table/function
- 是否 ALTER existing schema
- 是否已 apply
- 是否已 deploy

輸出：
review-auth-05B-2B.1-hotfix.md

內容包含：
- 根因
- 修正前後 transaction 時序
- idempotency claim/lock 設計
- order_no 查核結果
- 測試結果
- migration/deployment 狀態
- staging blockers
- Gate 結論

完成後停止，不得部署，也不要進入 05C。