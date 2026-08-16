先只讀：
#file docs/working-prompts/prompts-auth-05B-2A-hotfix.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。

執行 P-AUTH-05B-2A Hotfix，修正 business-authority 漏洞，不改可見UI。

1. gacha-draw request不得接受mascotId、reward、points或tickets。RPC必須依伺服器端mascots目錄、權重與伺服器亂數決定抽中結果，並回傳mascot與獎勵；前端只播放動畫及顯示伺服器結果。
2. 移除對瀏覽器公開的任意adjust-balance能力。前端不得提供pointsDelta/ticketsDelta/coinsDelta。每種獎勵改為伺服器定義的明確operation。
3. 移除公開upsert-mascot路由；吉祥物只能由gacha或其他經授權的後端交易內部呼叫upsert_user_mascot_obtain。
4. watch_ad若沒有可驗證的廣告完成token/callback，暫停發幣或列為blocker；不得因「只影響自己」而允許任意加幣。若保留，必須固定伺服器獎勵、頻率限制及冪等紀錄。
5. idempotencyKey必須在一次使用者操作開始時建立，網路重試沿用同一key；按鈕請求期間鎖定。不得每次retry重新產生key。
6. gift-redeem與gacha-draw補測：竄改mascotId/reward/delta被拒絕、最高稀有度不能由前端指定、真實雙擊、回應遺失重試、不同key代表兩次明確操作。
7. 保留Api既有必要簽章時只能做相容adapter；已不安全且無合法用途的方法應明確deprecated並拒絕，不得fallback到直接資料庫寫入。
8. 更新threat model與review-auth-05B-2A-hotfix.md，執行verify-local.ps1。未完成真實staging驗證不得部署。