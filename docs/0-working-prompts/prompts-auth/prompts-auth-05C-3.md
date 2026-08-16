執行 P-AUTH-05C.3 Shop UUID Type Hotfix Preparation。

目前狀態：
- production project：umtqpstacjdwxcvcirbl
- shop-ops已部署，verify_jwt=true。
- add_cart_item因TEXT參數寫入UUID欄位而回42804。
- 本階段只准本機準備hotfix，不得db push、deploy、修改production資料或執行production checkout。

一、建立checkpoint

- 記錄git status及commit SHA。
- 不得修改任何已套用migration。
- 只能新增一個superseding migration。
- 不得重構shop-ops或前端。

二、完整型別盤點

以既有唯讀information_schema結果及migration內容，建立參數→欄位型別表，至少涵蓋：

- shop_products.id
- shop_cart.id
- shop_cart.user_id
- shop_cart.product_id
- orders.id
- orders.user_id
- order_items.id
- order_items.order_id
- order_items.product_id
- shop_checkout_requests.idempotency_key
- shop_checkout_requests.user_id
- shop_checkout_requests.order_id

檢查以下RPC的所有INSERT、UPDATE、WHERE、RETURN QUERY及jsonb轉換：

- add_cart_item
- update_cart_item_quantity
- remove_cart_item
- clear_cart
- checkout_cart

不得只修目前第一個42804後停止。

三、新增migration

新增：
supabase/migrations/20260817xxxxxx_shop_uuid_type_hotfix.sql

使用CREATE OR REPLACE FUNCTION修正已套用RPC，不得編輯20260817000400或00500。

要求：

1. 保留現有RPC公開signature，避免產生函式overload或破壞repository呼叫。
2. TEXT輸入在資料庫邊界安全轉為UUID。
3. p_product_id寫入或比較UUID欄位前必須轉型。
4. p_cart_id與UUID cart id比較時使用正確型別。
5. checkout從jsonb讀取product_id並寫入order_items.product_id時必須轉為UUID。
6. order_id寫入UUID欄位時維持正確型別。
7. user_id為production實際TEXT欄位，不得錯誤改成UUID。
8. 無效UUID不得暴露原始Postgres錯誤；應轉成確定性、non-retryable業務錯誤。
9. 保留：
- SECURITY DEFINER
- 固定search_path
- service_role-only EXECUTE
- JWT-derived ownership
- server-authoritative價格／庫存
- checkout idempotency claim-then-lock
- pending order status
- order_no trigger行為
10. 不得放寬RLS或恢復前端直接寫入。

四、鎖定順序

同一新增migration內評估能否以最小修改統一：

cart row → product row

目前add_cart_item為product → cart，與checkout相反。

若可以安全修正：
- add_cart_item先鎖定既有cart row，再鎖product row。
- 新cart row不存在時，確認並行INSERT由unique constraint或等效機制保護。
- 不得造成重複cart item。

若無法在本hotfix安全處理：
- 不要猜測修改。
- 明確列為後續blocker。

五、測試

新增靜態及模擬測試：

1. add_cart_item對product UUID使用明確安全轉型。
2. checkout寫入order_items.product_id前轉為UUID。
3. user_id仍維持TEXT。
4. 無效productId/cartId為non-retryable。
5. owner偽造仍被拒絕。
6. 價格、total、stock仍不能由request body控制。
7. 同checkout idempotency key仍只建立一張order。
8. SECURITY DEFINER與grant/revoke不退化。
9. 不修改已套用migration。
10. 完整verify-local全部通過。

六、準備Production驗證計畫，但不得執行

計畫分兩階段：

A. Cart HTTP smoke
- 使用既有測試帳號。
- cart-add一次。
- 查核只新增該帳號一列。
- cart-remove剛新增的列。
- 確認cart恢復原狀。

B. Checkout rollback-only SQL smoke
只能規劃，不得本階段執行：
BEGIN;
建立或加入測試cart；
呼叫checkout_cart；
驗證order、order_items、stock及order_no；
ROLLBACK;
確認交易外無任何資料變動。

不得透過HTTP建立持久化production訂單。

七、輸出

建立：
review-auth-05C.3-shop-uuid-hotfix-preflight.md

內容包含：
- 根因
- production型別矩陣
- 新migration內容摘要
- 修正的每個cast位置
- lock-order處理結果
- 測試結果
- 預計db push影響
- rollback方案
- Production驗證計畫
- Gate結論

Gate只能為：
- SAFE_TO_APPLY_UUID_HOTFIX
- BLOCKED_SCHEMA
- BLOCKED_CONCURRENCY
- FAIL

完成後停止。
不得db push、deploy、呼叫production checkout或刪除資料。