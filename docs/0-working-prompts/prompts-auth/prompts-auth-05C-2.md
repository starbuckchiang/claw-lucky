我明確批准執行 P-AUTH-05C.2 Production Cart Recovery。

授權範圍只限：
production project ref：umtqpstacjdwxcvcirbl
部署 Edge Function：shop-ops

禁止：
- db push
- 套用或修改migration
- 部署其他Edge Function
- 修改RLS
- 刪除資料
- 建立真實訂單
- 執行production checkout
- 部署wallet-ops、account-merge或subscription-checkout

一、部署前最後確認

執行並顯示：
- linked project ref必須為umtqpstacjdwxcvcirbl
- git diff只包含05C.1已審查的CORS/shop-ops修改
- supabase migration list不得有新的pending migration
- supabase functions list確認shop-ops尚不存在
- verify-local必須維持634/634通過

若任何結果不符，立即停止，不得部署。

二、唯一允許的部署命令

supabase functions deploy shop-ops

不得加入--no-verify-jwt。
不得執行任何其他deploy或db命令。

三、部署後唯讀／無訂單驗證

1. functions list確認：
- shop-ops ACTIVE
- version 1
- verify_jwt=true

2. OPTIONS：
從Origin http://localhost:5588呼叫shop-ops/cart-add：
- status 200/204
- Access-Control-Allow-Origin為http://localhost:5588

3. 無JWT POST：
- 必須回401
- 不得寫入任何資料

4. 不允許Origin：
- 不得回Access-Control-Allow-Origin
- JWT驗證仍有效

四、受控Cart smoke test

只可使用已標記的測試帳號及明確測試商品：

- 記錄測試前shop_cart筆數。
- 使用有效JWT加入購物車一次。
- 確認只新增／更新該測試帳號自己的cart。
- 移除剛建立的測試cart item。
- 確認測試後shop_cart恢復原狀。
- 不得操作其他使用者cart。
- 不得呼叫checkout。
- 不得建立orders/order_items。
- 不得扣減商品庫存。

若沒有可安全辨識的測試帳號或商品：
- 跳過寫入smoke test。
- 不得使用真實使用者資料代替。

五、失敗處理

若deploy失敗或shop-ops持續異常：
- 不得db push。
- 不得修改production schema。
- 不得恢復舊的不安全RLS。
- 記錄錯誤後停止。

只有在function本身造成明確新故障時，才提出：
supabase functions delete shop-ops

不得未經再次批准自行執行delete。

六、輸出

建立：
review-auth-05C.2-production-cart-recovery.md

內容包含：
- 部署前確認
- 精確部署命令
- function版本與verify_jwt狀態
- OPTIONS/CORS/401結果
- Cart smoke test或跳過原因
- production資料前後差異
- 是否建立order（必須為NO）
- 是否執行db push（必須為NO）
- rollback建議
- Gate結論

Gate只能為：
- PRODUCTION_CART_RECOVERED
- DEPLOY_FAILED
- FUNCTION_DEPLOYED_SMOKE_BLOCKED
- ROLLBACK_RECOMMENDED

完成後停止，不要進行checkout，也不要開始Gacha/Gift並行hotfix。