先只讀：
#file docs/working-prompts/prompts-auth-04.2-hotfix.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。
執行 P-AUTH-04.2 Hotfix。修正 subscription.html 使用既有 Email 時出現「already been registered」並中斷的問題。
完成後輸出修改檔案與測試結果至docs/0-review/review-auth/review-auth-04.2-hotfix.md。


要求：

1. 先追蹤 EmailOtpService、subscription-entry 與 Supabase Auth 現行流程及測試。
2. 未註冊 Email 維持匿名帳號升級；既有 Email 改走 OTP 登入（禁止建立重複帳號）。
3. 登入成功後保留 pendingPlan，重新解析 auth state，並自動繼續原訂閱 Checkout。
4. 匿名使用者既有資料不得遺失；沿用現有安全移轉機制，若尚無機制則停止自動 Checkout，記錄為 blocker，禁止自行做危險的跨 UUID 合併。
5. UI 顯示繁中友善訊息，不洩漏 Supabase 原始英文錯誤。
6. 不修改方案、價格、資料庫 schema、RLS 或既有公開 API。
7. 補齊新 Email、既有 Email、錯誤 OTP、重送及刷新狀態測試；執行 verify-local.ps1。
8. 產出 review-auth-04.2-hotfix.md，列出根因、修改檔案、自動測試結果及 Gate 4 手動 E2E 步驟。未完成真實瀏覽器驗證不得宣告 Gate 4 PASS。
