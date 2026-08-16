執行 P-AUTH-05C Account Merge Coins/Tickets最小補強。

不得重構Account Merge，不得處理Cart、Checkout、Gift或其他功能。
先只做本機migration與測試，不得db push或deploy。

目標：
finalize_account_merge必須在同一transaction中轉移：

- points
- coins
- tickets
- user_mascots

規則：

1. 讀取匿名帳號目前points/coins/tickets。
2. 使用既有安全ledger函式，不能直接UPDATE餘額：
   - apply_point_transaction
   - apply_coin_transaction
   - apply_ticket_transaction
3. 每種資產使用穩定且唯一的transfer idempotency key，必須由
   merge request/claim id衍生，不得每次重送產生新key。
4. 先從匿名帳號扣除，再加到正式帳號。
5. 成功後匿名帳號三種餘額均為0。
6. 正式帳號得到三種餘額的精確總和。
7. user_mascots維持既有move/dedup規則。
8. points/coins/tickets/mascot與account_merge_requests必須在同一交易。
9. 任一步失敗全部rollback。
10. 相同claim/idempotency key重送不得再次增加任何資產。
11. 不同UID不得使用他人的claim。
12. 不修改歷史上已套用migration，只能新增superseding migration。
13. 保留SECURITY DEFINER、固定search_path與service_role-only。
14. 不得在前端或request body接受資產數量。

處理溢位與異常：
- 不允許負餘額。
- bigint運算不得轉回integer。
- ledger reference/reason需標示account_merge。
- 不得吞掉ledger錯誤或做部分成功。

測試至少涵蓋：

1. anon coins=19、formal coins=20 → formal=39、anon=0。
2. anon tickets=1、formal tickets=0 → formal=1、anon=0。
3. points同樣正確轉移。
4. mascot正確move與dedup。
5. 同merge request重送，所有數值不再增加。
6. 任一ledger步驟失敗，全部資產與mascot不變。
7. 不同UID重用claim被拒絕。
8. 零餘額可以正常合併。
9. bigint邊界不溢位。
10. 完整verify-local通過。

輸出：
review-auth-05A.2-account-merge-wallet-assets.md

Gate：
- SAFE_TO_APPLY
- PARTIAL
- FAIL

完成後停止，不得db push、deploy或操作Production資料。


## 修正20260817001000_account_merge_wallet_assets.sql中最後一個型別問題。

限制：
- 00900已套用，不得修改。
- 01000尚未套用，可以直接修正01000。
- 不得新增其他migration。
- 不得db push、deploy或操作Production。
- 不得重構。

只修改Points合併區塊：

1. 將v_anon_points改為BIGINT，符合users.points實際型別。
2. 在呼叫apply_point_transaction前加入與coins/tickets相同的範圍檢查：
   v_anon_points > 2147483647時明確RAISE EXCEPTION。
3. transfer-out使用：
   (-v_anon_points)::INTEGER
4. transfer-in使用：
   v_anon_points::INTEGER
5. 零points正常略過。
6. 不得直接UPDATE users.points。
7. points、coins、tickets、mascot仍須維持同一transaction。
8. 任一步失敗全部rollback。
9. 相同merge request重送不得再次入帳。

新增測試：
- v_anon_points宣告為BIGINT。
- range guard在cast之前。
- 不存在INTEGER v_anon_points。
- points out/in順序正確。
- 超過INTEGER範圍時整筆merge失敗。
- 完整verify-local通過。

更新報告：
review-auth-05C-account-merge-all-hotfix.md

Gate：
- SAFE_TO_APPLY
- FAIL

完成後停止，不得db push或deploy。