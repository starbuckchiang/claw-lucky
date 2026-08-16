執行 P-AUTH-05C.3.1 Shop UUID Hotfix Completeness Review。

限制：
- 不得db push、deploy或操作production資料。
- 不得修改任何已套用migration。
- 20260817000900尚未套用，因此可直接修正該新migration。
- 不得建立第二個migration，除非00900已被套用；目前不得假設已套用。

一、修正遺漏的型別邊界

Production型別已確認：

- orders.id = uuid
- shop_checkout_requests.order_id = text

檢查checkout_cart內所有對shop_checkout_requests.order_id的：

- INSERT
- UPDATE
- WHERE
- SELECT INTO
- cached result lookup
- RETURN QUERY/jsonb result

若存在：

UPDATE shop_checkout_requests
SET order_id = v_order.id

必須改成明確安全型別，例如：

SET order_id = v_order.id::text

不得依賴Postgres隱式或assignment cast。

cached lookup必須使用相容比較，例如：

o.id::text = v_claim.order_id

不得把不可信TEXT直接cast為UUID。

二、完整檢查所有方向

建立「來源型別→目標型別」清單，至少確認：

- p_product_id TEXT → shop_cart.product_id UUID
- jsonb product_id TEXT → order_items.product_id UUID
- v_order.id UUID → order_items.order_id UUID
- v_order.id UUID → shop_checkout_requests.order_id TEXT
- p_user_id TEXT → orders.user_id TEXT
- p_user_id TEXT → shop_checkout_requests.user_id TEXT
- cart id UUID與p_cart_id TEXT比較
- order cached lookup的UUID/TEXT比較

每個INSERT、UPDATE及比較都必須逐一標示：
- 原生同型別
- 明確cast
- 不需修改及原因

三、檢查checkout idempotency完整流程

確認：

1. fresh claim允許order_id為NULL。
2. 完成時寫入order_id文字值。
3. 同key重送可透過文字order_id找到UUID order。
4. 不同UID同key不得取得他人order。
5. completed結果不能被CART_EMPTY覆蓋。
6. 不得因型別錯誤留下processing紀錄；交易失敗必須整體rollback。

四、測試

新增或擴充00900的結構測試：

- 明確斷言`shop_checkout_requests.order_id = v_order.id::text`。
- 明確斷言cached lookup使用型別相容比較。
- 禁止裸寫`order_id = v_order.id`。
- checkout所有UUID/TEXT邊界均被覆蓋。
- 00900仍保留SECURITY DEFINER、固定search_path及service_role-only。
- 00400/00500仍未被修改。
- 完整verify-local必須全部通過。

五、更新報告

建立：
review-auth-05C.3.1-shop-uuid-hotfix-completeness.md

包含：
- 遺漏是否成立
- 修正位置
- 完整來源→目標型別表
- checkout idempotency型別流程
- 測試結果
- 是否修改00900
- 是否執行db push（必須NO）
- Gate結論

Gate只能為：
- SAFE_TO_APPLY_UUID_HOTFIX
- BLOCKED_SCHEMA
- FAIL

完成後停止，不得db push、deploy或執行production smoke test。