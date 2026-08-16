先只讀：
#file docs/working-prompts/prompts-auth-05A-fix.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。
完成後輸出修改檔案與測試結果至docs/0-review/review-auth/review-auth-05A-fix.md。

修訂 P-AUTH-05A，不得部署。修正以下 Gate blockers：

1. Begin 必須驗證呼叫者 is_anonymous=true；target email 正規化後才雜湊。
2. Finalize 必須從已驗證的正式 Session 取得 user.id 與 user.email，確認 is_anonymous=false，並將其 Email 雜湊與 claim.target_email_hash 比對；禁止信任 request body 的 UID/Email。
3. 不得先獨立 consume claim。將 claim 驗證、FOR UPDATE 鎖定、Email 比對、冪等檢查、全部資料合併及標記 used 放入同一個 SECURITY DEFINER transaction RPC；失敗全部 rollback，claim 保持可重試。
4. account_merge_requests 記錄 idempotency key 與結果；同一 A→B 重送只能回傳原結果，不可重複加點或搬資料。
5. RLS migration 不得部署，直到 mascot、redeem、points、cart、orders 的安全寫入 RPC/Edge Function 已取代前端直接寫入並完成回歸測試。
6. 補上 user_mascots 去重與唯一約束 migration 前置清理方案。
7. Orders、subscriptions、logs 未決前，明確排除於第一版 merge，禁止默默改歸屬。
8. 更新 review-auth-05A-hotfix.md，列出修正後契約、部署順序、rollback、真實 PostgreSQL測試計畫；不得宣告 05A PASS 或開始 05B。

## 執行 P-AUTH-05A.1 Hotfix，修正 finalize_account_merge 的冪等授權問題。

1. Finalize API 不得接受前端提供的 anonymous UID、existing UID、Email hash 或 idempotencyKey；existing UID/Email 必須來自已驗證 Session。
2. RPC 不得在驗證 claim 前依呼叫端提供的 key 回傳結果。
3. RPC 先依 claim_token_hash SELECT FOR UPDATE 取得 claim；比對正式 Session Email hash後，由資料庫使用 claim.anonymous_user_id 與 existing_user_id 自行產生 canonical idempotency key。
4. 驗證 claim 與 Email 後才查 account_merge_requests；已完成則回傳原 mergeId/result，未完成且 claim 為 pending、未過期才執行合併。
5. claim 已 used 且存在相同 canonical request 時須安全回傳原結果；used 但不存在對應 request 視為資料不一致並拒絕。
6. 不得在 result_json 儲存 Email、token hash或不必要的個資。
7. 補測偽造 key、錯誤 token＋有效 key、Email 不符、完成後重送及併發重送。
8. 將 Gate 改為 05A Design Gate／05B Implementation／05C Staging Gate；本階段仍不得部署 Production。
9. 執行 verify-local.ps1，產出 review-auth-05A.1-hotfix.md。
