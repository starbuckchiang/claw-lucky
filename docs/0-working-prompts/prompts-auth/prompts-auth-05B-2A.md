先只讀：
#file docs/working-prompts/prompts-auth-05B-2A.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。
執行 P-AUTH-05B-2A：Gacha & Gift Secure Write APIs。目標是在不重構既有UI與公開前端API的前提下，取代users、points、user_mascots、redeem_history的不安全前端直接寫入。

要求：
1. 先盤點gacha、gift、Api.adjustBalance、createUserIfNotExists、upsertUserMascot、redeemGift及所有users餘額寫入點；列出實際request/response與交易規則。
2. 建立薄Edge Function＋shared handler＋SECURITY DEFINER RPC；user_id只能從已驗證JWT取得，禁止request body/localStorage提供owner ID。
3. 抽扭蛋的扣款、獎勵、mascot累加及紀錄必須在單一交易內完成；重複請求使用伺服器端idempotency key，不能重複扣款或發獎。
4. 禮物兌換必須鎖定users與gift資料，驗證points/tickets/coins餘額，扣款、redeem_history及必要獎勵在單一交易完成；失敗全部rollback。
5. points異動只能走apply_point_transaction ledger。tickets/coins若尚無安全ledger，先提出最小相容migration與稽核規則，不得繼續用前端讀值後UPDATE。
6. mascot依(user_id, mascot_id)唯一規則安全upsert；不得在尚未dry-run/備份前部署00300 dedup migration。
7. 前端保留既有函式簽章，以adapter改接Edge Function；不得重做gacha.html、gift.html或改變使用者流程。
8. Edge Function失敗不得回退到舊的不安全直接寫入；錯誤訊息與log不得含JWT、Email、UID、token或完整request body。
9. 補齊owner偽造、跨帳號、餘額不足、重複點擊、併發、部分失敗rollback及既有成功流程測試。
10. 僅本機實作與測試，不部署Production、不套用00000 RLS。執行verify-local.ps1，產出review-auth-05B-2A.md及後續05B-2B cart/orders待辦。