P-AUTH-05A 目前不能通過，也不能部署 migration。設計方向正確，但有三個關鍵安全問題。

Finalize 沒有驗證目標 Email
account_merge_claims 有 target_email_hash，但 Finalize 契約沒有把「登入後正式帳號的已驗證 Email」雜湊後與它比對。必須確認登入的 B 就是匿名 A 原先指定的 Email，否則 claim 可能被錯誤帳號拿去使用。
Claim 消耗與資料合併不是同一交易
目前流程是：
consume claim（先標記 used）
→ 再執行 merge

如果 merge 中途失敗，claim 已經失效，使用者無法安全重試。正確方式應由單一交易式 RPC 同時完成：

驗證 claim
→ 鎖定 claim
→ 驗證目標 Email
→ 合併所有資料
→ 標記 claim used
→ commit

任一步驟失敗都要 rollback，claim 仍可重試。

RLS 一部署就會讓現有功能失效
Review 已明確指出，部署後以下功能會全部壞掉：
抽卡／吉祥物写入
兌換
點數調整
購物車新增、修改、刪除
建立訂單

因此不能先把三個 migration push 到目前的 Production。必須先完成對應的安全 RPC／Edge Function，然後一起部署。

另外仍有未決項目：

user_mascots 缺少唯一約束。
Orders 是否移轉尚未定案。
logs 是否保留尚未定案。
目前只有 SQL 文字靜態測試，沒有真正 PostgreSQL 執行證據。

判定:
P-AUTH-05A：FAIL / Revision Required
P-AUTH-05B：暫時不可開始
Production migration：禁止部署
Gate 4：仍未 PASS

Hotfix 已修正大部分問題，但仍有一個高風險 blocker，不能直接進入 05B。

主要問題在 idempotencyKey：

契約允許沿用「前端提供」的 key。
RPC 在鎖定及驗證 claim 前，先用這個 key 查詢並回傳既有合併結果。
攻擊者若取得或猜到別人的 deterministic key，可能在沒有有效 claim、Email 不符的情況下取得合併結果。
RPC 也可能錯把不相關請求視為已完成。

正確做法：

用 claimToken 找到並鎖定 claim
→ 驗證 claim 與正式帳號 Email
→ RPC 自行用 claim.anonymous_user_id + existing_user_id 產生 key
→ 查詢是否已完成
→ 已完成則回傳原結果
→ 未完成才執行合併

idempotencyKey 不應由前端產生或傳入。

另外有一個流程相依問題：05A 說必須真實 PostgreSQL 測試後才能 PASS，但 RLS 又必須等 05B 的安全寫入 Edge Functions 完成才可部署。建議拆成：

05A Design Gate：設計與靜態測試通過。
05B Implementation：完成 Edge Functions及前端改接。
05C Staging Gate：整批部署 staging，執行真實 PostgreSQL、RLS及合併 E2E。

目前判定：P-AUTH-05A Hotfix 接近完成，但仍需一次小修正。

P-AUTH-05A.1 已封住前一版的冪等授權漏洞，可以判定：

05A Design Gate：PASS
05B Implementation：可以開始
05C Staging Gate：尚未開始
Production：仍禁止部署

通過理由：

前端不能再提供資料庫 idempotency key。
RPC 先鎖定並驗證 claim。
正式帳號 Email 比對通過後，資料庫才自行產生 canonical key。
合併、claim used、request 紀錄在同一交易。
完成後重送可回傳原結果。
錯誤 token、錯誤 Email及 used/request 不一致會拒絕。
result_json 不保存 Email 或 token。
自動測試 381/381 PASS。