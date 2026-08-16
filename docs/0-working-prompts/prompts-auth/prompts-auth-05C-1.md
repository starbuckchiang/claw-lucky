執行 P-AUTH-05C.1 Production Cart Recovery Preflight。

背景：
- umtqpstacjdwxcvcirbl 已確認為 production。
- 14 個 migration 已套用。
- shop_cart/orders/order_items 已被安全 RLS 鎖定。
- shop-ops 尚未部署，因此 Production Cart/Checkout 目前故障。
- 預計採 forward-fix，但本階段不得部署、db push或修改production資料。

一、唯讀確認 orders schema

對 production 只執行 SELECT：

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='orders'
ORDER BY ordinal_position;

SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_schema='public' AND event_object_table='orders';

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid='public.orders'::regclass;

確認：
- order_no 是否 NOT NULL。
- 是否有 default或trigger自動產生。
- 是否有 unique constraint。
- checkout_cart目前不提供order_no時能否合法INSERT。

只能查schema，不得建立測試訂單。

二、檢查shop-ops CORS

檢查：
- OPTIONS必須在route/body/JWT解析前回200。
- http://localhost:5500與http://localhost:5588均允許。
- 所有成功及錯誤response均帶正確的request Origin。
- shop-ops每個jsonResponse呼叫是否傳入req。

若shop-ops未傳req：
- 僅做最小本機程式修正。
- 不得改business logic。
- 不得部署。
- 新增測試確認localhost:5588的OPTIONS與POST response均回傳：
  Access-Control-Allow-Origin: http://localhost:5588

對不允許的Origin：
- 不應回傳假的localhost:5500 Allow-Origin。
- 應省略Access-Control-Allow-Origin或明確拒絕。
- JWT/ownership仍是安全邊界。

三、離線／靜態部署準備檢查

確認：
- shop-ops verify_jwt預計維持true。
- JWT UID為唯一owner來源。
- service_role只存在Edge Function環境。
- 20260817000400與00500已存在production migration history。
- 不需要再次db push。
- 本次恢復應只有一次：
  supabase functions deploy shop-ops
- 列出將部署的檔案及預計function版本。
- 不得實際執行deploy命令。

四、既有風險

檢查並記錄：
- checkout_cart與cart add/update的鎖順序是否可能deadlock。
- 40P01是否會轉為retryable:true。
- 同checkout idempotency key重試是否保留相同key。
- 不得在本階段修改migration或production function。

五、輸出

建立：
review-auth-05C-1-production-cart-recovery-preflight.md

內容包含：
- order_no查核結果
- shop-ops CORS結果
- 本機修改檔案
- 測試結果
- 精確部署命令，但不得執行
- 預估影響
- rollback方式
- 是否SAFE_TO_DEPLOY_SHOP_OPS
- 尚存風險

Gate只能為：
- SAFE_TO_DEPLOY_SHOP_OPS
- BLOCKED_ORDER_SCHEMA
- BLOCKED_CORS
- BLOCKED_SECURITY

完成後停止，等待人工明確批准production部署。
不得deploy、db push、migration repair、rollback或刪除資料。