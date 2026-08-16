我明確批准執行 P-AUTH-05C.4 Production Shop UUID Hotfix。

唯一授權目標：
production project ref：umtqpstacjdwxcvcirbl

唯一授權migration：
20260817000900_shop_uuid_type_hotfix.sql

禁止：
- 修改任何已套用migration
- 套用00900以外的migration
- 部署或刪除Edge Function
- 修改RLS
- 刪除production資料
- 透過HTTP建立持久化order
- 執行Gacha/Gift hotfix
- migration repair或rollback

一、套用前確認

立即執行並記錄：

1. linked project ref必須等於umtqpstacjdwxcvcirbl。
2. supabase migration list必須顯示：
   - 00900只有local、remote尚未套用。
   - 不得有其他pending migration。
3. verify-local必須655/655通過。
4. git diff確認：
   - 00900是唯一新的未套用migration。
   - 00400/00500及其他已套用migration未被本階段修改。
5. shop-ops必須ACTIVE、verify_jwt=true。

任何一項不符立即停止。

二、唯一允許的Production變更

執行一次：

supabase db push

執行前再次確認輸出只會套用：

20260817000900_shop_uuid_type_hotfix.sql

若CLI顯示其他migration，回答N並停止。

不得執行任何functions deploy命令。

三、套用後確認

唯讀確認：

- migration list顯示00900 local/remote一致。
- add_cart_item仍為SECURITY DEFINER。
- checkout_cart仍為SECURITY DEFINER。
- PUBLIC/anon/authenticated沒有EXECUTE。
- service_role具有EXECUTE。
- RLS及既有policy沒有變動。
- shop-ops仍為原版本、verify_jwt=true。

四、Cart HTTP smoke

只使用既有測試帳號：
5a706db8-3814-4687-a36a-0d9cd9ebb940

先唯讀選擇：
- enabled=true
- stock足夠
- required_mascot_id為NULL，或測試帳號已解鎖
的測試商品。

記錄測試前：
- 該帳號shop_cart筆數
- 商品stock
- orders/order_items筆數

執行：
1. 透過shop-ops/cart-add加入一次。
2. 確認HTTP成功且只新增該測試帳號的一列。
3. 確認product_id為正確UUID。
4. 確認商品stock未變動。
5. 透過shop-ops/cart-remove移除剛新增的cart item。
6. 確認shop_cart恢復測試前狀態。
7. 確認orders/order_items完全未增加。

不得操作其他使用者資料。

五、Checkout rollback-only SQL smoke

只能透過同一個明確交易執行，禁止HTTP checkout：

BEGIN;

- 使用測試帳號與符合條件的測試商品呼叫add_cart_item。
- 使用唯一throwaway idempotency key呼叫checkout_cart。
- 在交易內確認：
  - checkout回傳order_id。
  - orders正好建立一列。
  - order_items正好建立預期列數。
  - order_items.product_id為UUID且正確。
  - order_no已由trigger產生且非空。
  - status為pending。
  - shop_checkout_requests為completed。
  - shop_checkout_requests.order_id為對應order UUID的TEXT。
  - 商品stock只扣預期數量。
  - cart已清空。

ROLLBACK;

交易外再次唯讀確認：
- 測試cart恢復原狀。
- orders/order_items沒有新增。
- shop_checkout_requests沒有留下測試key。
- 商品stock完全恢復。
- 不得留下任何測試資料。

如果無法保證BEGIN與ROLLBACK在同一資料庫session：
- 不得執行Checkout smoke。
- 標記BLOCKED，不得改用HTTP checkout。

六、失敗處理

若migration apply失敗：
- 不得migration repair。
- 不得編輯已部分／已成功套用的00900。
- 記錄錯誤與remote migration狀態後停止。

若migration成功但smoke失敗：
- 不得刪除function或放寬RLS。
- 不得直接rollback函式。
- 提出新的forward-fix migration方案後停止。

七、輸出

建立：
review-auth-05C.4-production-shop-uuid-hotfix.md

包含：
- 套用前檢查
- db push實際輸出
- migration狀態
- function權限
- Cart HTTP smoke結果
- Checkout rollback-only結果
- 每張表測試前後差異
- 是否部署Edge Function（必須NO）
- 是否留下測試資料（必須NO）
- 失敗及殘留風險
- Gate結論

Gate只能為：
- PRODUCTION_CART_RECOVERED
- MIGRATION_APPLIED_CHECKOUT_TEST_BLOCKED
- SMOKE_FAILED
- MIGRATION_FAILED

完成後停止，不得開始其他hotfix或Production部署。