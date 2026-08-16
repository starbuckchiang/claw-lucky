先只讀：
#file docs/working-prompts/prompts-auth-04.3-hotfix.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。

執行 P-AUTH-04.3 Hotfix，修正 Gate 4 真實 E2E 發現的問題

完成後輸出修改檔案與測試結果至docs/0-review/review-auth/review-auth-04.3-hotfix.md。

1. OTP 實際可能為 6 或 8 位；移除 UI、驗證規則與測試中硬編碼的「6 位數」，輸入框須接受 6～8 位純數字，並交由 Supabase verifyOtp 驗證。
2. 既有 Email OTP 登入成功後，目前因匿名 UID 與正式 UID 不同而阻擋 Checkout。先盤點所有綁定 user_id 的資料表、FK、RLS、購物車、點數、兌換及桌布資料。
3. 禁止前端直接跨 UID 更新資料、使用 service-role key 或信任 localStorage UID。
4. 設計並實作具身分證明、可重試、冪等且交易化的安全合併流程；若現有架構無法安全證明舊匿名身分，先產出 ADR 與 migration/RPC 計畫，不得假裝合併成功。
5. 合併成功後重新取得 Session/auth state，保留 pendingPlan 並自動繼續原 Checkout；失敗時保留資料且顯示可恢復操作。
6. 補測 6/8 位 OTP、錯誤碼、既有帳號登入、合併成功/失敗/重試、重複執行及 pendingPlan。
7. 執行 verify-local.ps1，產出 review-auth-04.3-hotfix.md。沒有真實瀏覽器 E2E 證據不得宣告 Gate 4 PASS。
