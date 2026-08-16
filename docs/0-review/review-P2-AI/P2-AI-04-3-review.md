# P2-AI-04-3 Review — Preview 架構 v3 修訂（並行/額度/Finalize/冪等 正確性修正）

Source prompt: [docs/working-prompts/prompts-P2-AI-04-3.md](../docs/working-prompts/prompts-P2-AI-04-3.md)

**狀態：Analysis／Planning only。本次任務未修改任何功能程式碼、未新增 migration、未 commit、未 push、未 deploy。**

## Scope Delivered

依 Product Review 對 P2-AI-04 v2 分析報告提出的並行、額度預約、Preview finalize 與 Job 冪等問題，將以下三份文件修訂／新增至 v3：

- [docs/development/reports/P2-AI-04-analysis-report.md](../docs/development/reports/P2-AI-04-analysis-report.md)（v3，本次修訂重點）
- [docs/development/reports/P2-AI-04-product-decisions.md](../docs/development/reports/P2-AI-04-product-decisions.md)（新增 Decision #16：Gift 已兌換可重複使用，不消耗 `redeem_history`）
- [docs/development/reports/P2-AI-04-implementation-plan.md](../docs/development/reports/P2-AI-04-implementation-plan.md)（新增，7 階段實作計畫草案）

## v2 → v3 修正的四個核心問題

1. **並行安全問題**：v2「`SELECT count(*)` + `FOR UPDATE`」無法防止（a）同一使用者同時建立兩個全新 Session、（b）每日次數在邊界值（19/20）並發超額、（c）同一 Session 並發重抽超額，因為 `FOR UPDATE` 只鎖定已存在的列，無法阻擋另一筆交易並發插入尚未被計入的新列。
   - **修正**：改用 `pg_advisory_xact_lock`，鍵值以 MD5（而非 PostgreSQL 內建 `hashtext()` 的不穩定假設）衍生，分別序列化「同一使用者＋同一天」與「同一使用者＋同一 Session」。
   - 已針對三個情境逐一證明不會超額：daily count=19 兩個新 Session 並發、session count=2 兩個重抽並發、同一 request 因網路重送兩次。
   - 比較過獨立 quota counter table 方案，結論不採用（複雜度增加但無實質效能收益）。

2. **額度預約時機問題**：v2 未明確拆分「額度檢查」與「呼叫 Shopkeeper Agent」的順序，容易被誤寫成先呼叫 Gemini 才檢查次數。
   - **修正**：拆成 **Reserve → Generate → Finalize** 三階段。Reserve 完成額度檢查與佔位（不呼叫 Gemini）；Reserve 被拒絕時絕不呼叫 Gemini；Generate 呼叫既有 `shopkeeperContextAgent`（保證不拋例外）；Finalize 落地內容、轉換狀態為 `ready`、同一交易內失效化同 Session 的舊 `ready` Preview。

3. **Finalize／並發完成問題**：新增 Finalize 冪等語意（重複呼叫回傳同一份內容，不重複觸發失效化）與系統性失敗處理（reservation 標記 `failed`，不觸碰同 Session 其他 `ready` 的舊 Preview）。

4. **Confirm Consume 的前置條件問題**：v2 把「尚未存在的 `generationId`」當作 Consume 輸入，經逐檔查證 `generation-orchestrator.js` 真實執行順序（validateUser → checkDailyLimit → getGenerationCost → createJob → markRunning → generationService.createWallpaperGeneration → deduct/record on success）後確認 `jobId` 在 Consume 當下已存在，`generationId` 尚不存在。
   - **修正**：Consume RPC 改以既有 `jobId` 作為冪等鍵，設計四種情境（ready 且未消費→原子消費／同 jobId 重試→冪等回傳／不同 jobId→`PREVIEW_ALREADY_CONSUMED`／expired-invalidated-mismatch→拒絕），並收斂對外錯誤碼為 `PREVIEW_UNAVAILABLE`／`PREVIEW_EXPIRED`／`PREVIEW_ALREADY_CONSUMED` 三類，避免洩漏任意 `previewId` 是否存在。

## 狀態模型修訂

`shopkeeper_previews` 新增明確 `status` 欄位（`pending`／`ready`／`failed`／`consumed`／`invalidated`）取代 v2 單靠時間戳記推論狀態，並列出完整合法狀態轉移圖與對應 CHECK constraints（互斥終態、欄位存在性依狀態綁定、時序合理性等）。

## Job Retry 真實能力盤點（誠實評估，未誇大）

逐檔查證 `job-service.js`／`job-repository.js`／`generation-orchestrator.js` 後結論：**只有資料模型，尚無執行機制**——`retry_count`／`attempt_no`／`next_retry_at`／`locked_at`／`locked_by` 欄位存在於 schema，但從未被應用程式碼讀寫，也沒有任何排程器／worker。v2 報告「沿用既有 Job 失敗／重試機制」的敘述已修正為不準確並記錄真相。MVP 策略：Consume 成功後 Image 失敗，Preview 維持 `consumed` 不恢復；使用者的「重試」＝提交全新請求（消耗新 Preview 額度），不擴張為新的 Retry 子系統。

## 過渡期部署策略修訂

明確定義雙路徑並存規則（有 `previewId` 走新路徑／無則走 legacy，`luckyTheme`/`blessing` 過渡期內仍被忽略但不再必填）與 legacy path 移除條件（新增 `wallpaper_generate_legacy_path_used` 監控事件＋新前端上線後連續 7 天為 0＋確認無前端快取殘留，三者皆滿足才建立獨立清理任務），避免同一 release 讓舊版 UI 失效。

## Response DTO 傳遞鏈

逐層追蹤 submit response／status response／query repository／result presenter／前端渲染共 5 層，確認目前皆無 Shopkeeper 顯示欄位，並設計新增位置（明確排除 `source`／`shopkeeperVersion`／完整 Prompt／raw AI response），確保 Preview 與生成後顯示內容逐字一致（WYSIWYG）。

## 下載按鈕技術方案

確認 `wallpapers` bucket 為私有＋1 小時短效 Signed URL。比較 `<a download>`（跨網域不可靠）／fetch→Blob→object URL（**推薦**，涵蓋 GitHub Pages／localhost／主流行動瀏覽器，無需新增 Edge Function）／專用 download Edge Function（最可靠但需額外基礎設施）三種方案，並定義過期重試、檔名、object URL 釋放、錯誤訊息分類、不記錄 signed URL token 等細節。

## 新增產出：7 階段 Implementation Plan

[P2-AI-04-implementation-plan.md](../docs/development/reports/P2-AI-04-implementation-plan.md) 拆分為：Phase 1 Migration+Preview State/RPC、Phase 2 Shopkeeper Preview Function、Phase 3 Generate Confirm Compatibility Path（唯一觸碰已部署 `wallpaper-generate` 的階段）、Phase 4 Response DTO+Frontend State Machine、Phase 5 Download+Responsive UI、Phase 6 Local Integration+Regression Tests、Phase 7 Deployment Gates+Real E2E，每階段皆列出修改檔案／測試／Gate／回滾方式／是否觸碰已部署 Function／前後相容性。

## 是否 READY FOR IMPLEMENTATION

✅ READY FOR IMPLEMENTATION PLANNING——v2 遺留的四個正確性問題與 Gift 兌換語意問題（Product Decision #16）皆已在 v3 解決或定案。

## 尚存阻擋問題

1. `consume_shopkeeper_preview` RPC 對外錯誤碼的具體 UI 文案待撰寫。
2. Storage CORS 實際行為需在 Implementation Phase 5 以真實簽名 URL 環境驗證（本次基於 Supabase Storage 標準預設行為推論）。
3. RPC `GRANT EXECUTE ... TO service_role` 的角色名稱需在正式撰寫 migration 時對照專案實際角色設定二次確認。
4. 可選的 `client_request_id` 冪等加強欄位（避免網路重送浪費 Preview 額度）是否採用，需 Product Owner 決定，建議在 Phase 1 一併定案以避免日後再改 schema。

## 未做的事（明確邊界）

未修改任何 `.js`／`.ts`／`.sql`／`.html`／`.css` 功能檔案；未建立實際 migration 檔案（僅在報告中以程式碼區塊呈現草案）；未執行 `git commit`／`git push`；未呼叫任何 `supabase` 部署指令。
