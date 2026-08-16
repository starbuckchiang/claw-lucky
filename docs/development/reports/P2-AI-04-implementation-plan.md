# P2-AI-04 Implementation Plan（草案 v1，隨 v3 Analysis Report 一併產出）

**狀態：規格／規劃階段。本文件本身不包含任何程式碼變更，僅為未來實作提供可獨立驗收的階段拆分。實際實作、commit、push、deploy 需另行啟動並逐階段審核。**

本計畫依 [P2-AI-04-analysis-report.md](./P2-AI-04-analysis-report.md)（v3）與 [P2-AI-04-product-decisions.md](./P2-AI-04-product-decisions.md) 的架構設計拆分為 7 個階段。每個階段皆可獨立驗收、獨立回滾，並標明是否觸碰已部署的 Function。

---

## Phase 1：Migration + Preview State/RPC

**目標**：在資料庫層面建立完整的 Preview 狀態機基礎設施，尚不影響任何現有功能。

**修改檔案**：
- 新增 `supabase/migrations/<TBD>_create_shopkeeper_previews.sql`（分析報告第 18.1／18.3 節：表結構＋`status` 狀態欄位＋CHECK constraints＋索引＋RLS）
- 新增同一份或緊接的 migration：`consume_shopkeeper_preview`（第 19.3 節）與 Reserve／Finalize 用的 RPC（第 16／17 節，含 `pg_advisory_xact_lock` 邏輯）

**測試**：
- 直接對 migration 產生的 schema／RPC 撰寫 SQL 層級測試（例如透過 `supabase db test` 或以 Node 腳本呼叫 RPC）驗證：
  - CHECK constraints 阻擋不合法狀態組合（第 18.3 節逐條）
  - `consume_shopkeeper_preview` 的四種情境（consumed_now／already_consumed_same_job／PREVIEW_ALREADY_CONSUMED／各種拒絕原因）
  - 第 17.4 節三個並發情境的實際壓力測試（可用多個並行資料庫連線模擬）

**Gate**：SQL 測試全數通過；`supabase db push --dry-run` 顯示 migration 可乾淨套用；RLS policy 以測試帳號驗證「authenticated 角色完全無法直接讀寫 `shopkeeper_previews`」。

**回滾方式**：本階段只新增資料表與函式，不修改任何既有表。回滾＝撰寫對應的 DOWN migration（`DROP FUNCTION`／`DROP TABLE`），因為沒有任何現有功能依賴這張新表，回滾風險極低。

**是否觸碰已部署 Function**：否。

**前後相容性**：完全向後相容（純新增）。

---

## Phase 2：Shopkeeper Preview Function

**目標**：新增獨立的 `shopkeeper-preview` Edge Function，實作 Reserve／Finalize／Reroll 三個操作，串接 Phase 1 的 RPC 與既有 `shopkeeperContextAgent`。

**修改檔案**：
- 新增 `supabase/functions/shopkeeper-preview/index.ts`
- 新增 `supabase/functions/_shared/shopkeeper-preview-handler.js` + `.ts`（Node/Deno 雙軌，比照 `wallpaper-generate-handler` 慣例）
- 新增 `js/services/shopkeeper/shopkeeper-preview-repository.js` + Deno twin（封裝 RPC 呼叫）
- 新增 `js/services/wallpaper/mascot-ownership-repository.js`／`gift-redemption-repository.js` + Deno twins（第 12.3／Product Decision #16：查詢 `user_mascots`／`redeem_history`，不消耗）

**測試**：
- 單元測試：擁有權驗證失敗（`MASCOT_NOT_OWNED`／`GIFT_NOT_REDEEMED_OR_UNAVAILABLE`）、Reserve 次數上限、Reroll selections 竄改偵測、Finalize 冪等（第 16.5 節）、Finalize 系統性失敗不影響舊 Preview（第 16.6 節）
- 整合測試：完整 Reserve→Generate→Finalize 流程，含 Fallback 分支（Shopkeeper Agent timeout 時仍完整可用）

**Gate**：本階段新測試全數通過；既有 `verify-local.ps1` 207 項測試維持全數通過（本階段不修改任何既有檔案，理論上不會影響，但仍需重跑確認無誤觸）。

**回滾方式**：新 Function 可獨立下線／刪除（`supabase functions delete shopkeeper-preview`），不影響 `wallpaper-generate`（此時 Phase 3 尚未修改 Confirm 路徑，`wallpaper-generate` 完全不受影響）。

**是否觸碰已部署 Function**：否（僅新增一個全新的 Function，`wallpaper-generate`／`wallpaper-status` 不變）。

**前後相容性**：完全向後相容（新前端尚未上線，這個新 Function 目前沒有任何呼叫方）。

---

## Phase 3：Generate Confirm Compatibility Path

**目標**：修改 `wallpaper-generate` 的 Confirm 路徑，支援 `previewId`，同時保留 legacy path（分析報告第 20 節）。**這是唯一會修改已部署 Function 核心邏輯的階段，需最謹慎處理。**

**修改檔案**：
- `js/services/wallpaper/generation-validator.js`：`previewId` 改為可選（legacy 相容期）；`FORBIDDEN_FIELDS` 新增 `story`／`oneLiner`／`shopkeeperMessage`／`source`／`shopkeeperVersion`（第 20.3 節：這些欄位任何版本前端都不會送，可立即禁止）
- `supabase/functions/_shared/wallpaper-generate-handler.js`／`.ts`：新增「若請求含 `previewId`，走新 Consume 路徑；否則走 legacy 路徑」的分支（第 20.1 節）
- `js/services/wallpaper/generation-orchestrator.js`／`.ts`：在 `markRunning(jobId)` 之後、呼叫 `generationService` 之前，插入 Consume 呼叫（僅新路徑時觸發，第 19.2 節）
- `js/services/wallpaper/generation-service.js`／`.ts`：新增分支，接受「已消費的 `context_snapshot`」並跳過 `shopkeeperContextAgent.generate()`
- 新增 Observability 事件 `wallpaper_generate_legacy_path_used`（第 20.2 節，用 `generationLogger.logWarn()`）

**測試**：
- 新增測試：`previewId` 路徑（過期／已消費／owner 不符／selections 不符／正常成功）、legacy 路徑（無 `previewId`，行為與現行完全一致，回歸測試）
- **同時兩次 Confirm 只能成功一次**（第 13.1 第 8 項）：以並發呼叫模擬驗證 `consume_shopkeeper_preview` 的原子性
- **Confirm 不會再次呼叫 Gemini Text**（第 13.1 第 11 項）：mock `shopkeeperContextAgent.generate`，斷言新路徑下未被呼叫
- 既有 `verify-local.ps1` 207 項測試**必須逐一重新確認全數通過**（本階段直接修改核心編排邏輯，回歸風險最高）

**Gate**：新增測試全數通過＋既有 207 項測試全數通過＋以 Playwright 對「舊版前端（不帶 `previewId`）」實際跑一次端到端生成，確認 legacy path 行為與 P2-AI-03 Gate C 驗證結果一致（無回歸）。

**回滾方式**：`wallpaper-generate-handler` 的分支邏輯以「新增一個 if 分支」的方式實作，legacy 分支程式碼保持原樣不動；若新路徑出問題，可透過 feature flag／環境變數暫時關閉新路徑判斷（即：即使收到 `previewId` 也強制走 legacy 行為），或直接回滾部署到上一個版本（因為此階段是唯一真正修改 `wallpaper-generate` 的階段，需保留可快速回滾的部署版本）。

**是否觸碰已部署 Function**：**是**——這是全計畫中風險最高的階段，修改 `wallpaper-generate`（已通過 Gate A/B/C 驗證的既有 Function）。

**前後相容性**：向後相容（legacy path 保留），但這是**唯一允許先部署的後端變更**，因為它同時支援新舊兩種請求格式。

---

## Phase 4：Response DTO + Frontend State Machine

**目標**：讓 Shopkeeper 顯示內容能夠完整流過 Response DTO 五層，並讓前端狀態機支援 Preview/Reroll/Confirm 完整流程（尚不含下載按鈕與響應式 UI 細節，那屬於 Phase 5）。

**修改檔案**：
- `js/services/wallpaper/response-dto.js`：`createGenerationSuccessDto` 新增 5 個欄位（第 22.3 節）
- `js/services/wallpaper/progress-response-dto.js`：`createStatusSuccessDto` 新增同 5 個欄位
- `js/services/wallpaper/generation-query-repository.js`／`.ts`：從 `metadata_json.shopkeeperSnapshot` 抽取 5 個欄位（明確排除 `source`／`shopkeeperVersion`）
- `js/services/wallpaper/wallpaper-result-presenter.js`：`presentSuccess()` 透傳 5 個欄位
- `js/pages/wallpaper.js`：新增 Preview／Reroll 呼叫邏輯、第 10 節完整狀態機（`idle→selecting→previewLoading→previewReady→rerolling→generating→polling→succeeded/failed/previewExpired/previewLimitReached`）
- `wallpaper.html`：移除 `luckyTheme`／`blessing` 輸入欄位，新增「今日祝福卡」區塊（顯示 luckyTheme/blessing/story/oneLiner/shopkeeperMessage）、「再抽一次」／「確認生成」按鈕、剩餘次數顯示

**測試**：
- **Preview 與最終 Snapshot 完全一致**（第 13.1 第 10 項）：整合測試比對 Preview Response 與最終 `metadata_json.shopkeeperSnapshot`
- 前端狀態機的單元測試（若有既有前端測試框架）或至少手動測試腳本涵蓋所有狀態轉移
- 既有 207 項測試維持通過

**Gate**：DTO 傳遞鏈的整合測試全數通過；Playwright 走一次「選擇→產生祝福→重抽一次→確認→生成→顯示結果含文字內容」全流程，人工確認畫面文字與資料庫內容一致。

**回滾方式**：前端檔案（`wallpaper.html`／`wallpaper.js`）可直接回滾到 Phase 3 完成時的版本（此時後端仍同時支援新舊路徑，回滾前端不影響任何人使用 legacy path）；後端 DTO 新增欄位屬於「純增加欄位」，舊版前端會忽略不認得的欄位，回滾後端這幾個 DTO 檔案同樣安全。

**是否觸碰已部署 Function**：是（`wallpaper-status`／`wallpaper-generate` 的回應內容新增欄位，但屬於純增加，不影響既有欄位語意）。

**前後相容性**：向後相容（新增欄位，不刪除／不改變既有欄位）。

---

## Phase 5：Download + Responsive UI

**目標**：實作正式下載按鈕（第 23 節技術方案）與手機版 9:16 版面確認，維持既有暖色調品牌風格。

**修改檔案**：
- `js/pages/wallpaper.js`：新增下載按鈕的 fetch→Blob→object URL→click→revoke 邏輯（第 23.2／23.3 節）
- `wallpaper.html`：新增下載按鈕 UI 元素
- `css/pages/wallpaper.css`（或既有對應樣式檔）：確認手機版 9:16 預覽版面

**測試**：
- **下載按鈕可用**（第 13.1 第 12 項）：Playwright 模擬點擊下載按鈕，驗證觸發瀏覽器下載行為（或至少驗證 Blob／object URL 被正確建立）
- **手機版 9:16 顯示正常**（第 13.1 第 13 項）：Playwright 390×844 視窗截圖比對，確認無版面錯位
- 以**真實** Supabase Storage signed URL 手動驗證 CORS 行為（第 23.3 節「建議在 Phase 5 落地時以真實環境驗證」——本階段是兌現這個待驗證項目的時機）
- Signed URL 過期情境測試：模擬 403/410 回應，驗證自動重新整理 URL 後重試一次的邏輯

**Gate**：下載按鈕在 Chrome／Safari（含模擬 iOS）／Firefox 至少三種瀏覽器手動驗證可正常下載；手機版截圖人工確認無版面問題。

**回滾方式**：純前端檔案變更，直接回滾 `wallpaper.html`／`wallpaper.js`／CSS 到 Phase 4 完成時的版本即可，不影響後端。

**是否觸碰已部署 Function**：否。

**前後相容性**：不影響任何後端契約。

---

## Phase 6：Local Integration + Regression Tests

**目標**：在本地（`scripts/verify-local.ps1`）完整跑過所有新增與既有測試，確保沒有任何回歸，為部署做最後準備。

**修改檔案**：
- `scripts/verify-local.ps1`：新增本次所有新測試檔的 glob／`node --check`
- 補齊任何 Phase 1～5 執行過程中發現但尚未撰寫的測試（例如第 13.1 節逐項核對，確保 14 項新增測試全部有對應的自動化測試檔，而非僅在分析報告中列出）

**測試**：
- 執行 `scripts/verify-local.ps1`，確認**既有 207 項 ＋ 本次新增全部測試**皆通過（總數需在報告中明確列出，例如「207 + 新增 N 項 = 總計 M 項全數通過」）
- Import 圖檢查（比照 P2-AI-03 Deployment Preflight 慣例）：確認新增的 14 個 JS/TS 雙軌檔案（Node CommonJS + Deno ESM）皆存在且無未解析的 import

**Gate**：`verify-local.ps1` 全綠；Import 圖 0 未解析。

**回滾方式**：不涉及部署，純本地驗證階段，無需回滾（若測試失敗，退回對應 Phase 修正）。

**是否觸碰已部署 Function**：否（本地驗證）。

**前後相容性**：N/A（驗證階段）。

---

## Phase 7：Deployment Gates + Real E2E

**目標**：比照 P2-AI-03 的 Gate A/B/C 模式，實際部署並以真實 Gemini 呼叫驗證完整流程。

**建議子步驟**（比照既有 P2-AI-03 部署流程慣例，需另行申請執行）：
1. **Release Scope Review**：確認 Phase 1～6 的變更是否可視為單一部署單元，或需分批（例如 Phase 1／2 可先單獨部署因為零風險，Phase 3 需獨立更謹慎的部署窗口）。
2. **Migration Gate**：套用 Phase 1 的 migration（`supabase db push`），確認 `shopkeeper_previews` 表／RPC／RLS 皆正確建立。
3. **Function 部署 Gate**：部署 `shopkeeper-preview`（新）與 `wallpaper-generate`（修改，Phase 3 內容），確認版本號／sha256 變更符合預期。
4. **Post-deployment 真實 E2E**：以 Playwright 對正式環境跑一次「選擇→Reserve→Generate→Finalize→重抽→Confirm→Consume→真實 Gemini Image 生成→下載」全流程，確認：
   - `source` 欄位在 Observability 中可見（`ai` 或 `fallback`），但不外洩到前端
   - 第 17.4 節的三個並發情境在正式環境亦可用簡單腳本重現驗證（例如同時發送兩個 Reroll 請求，確認只有一個成功）
   - Legacy path 監控事件 `wallpaper_generate_legacy_path_used` 是否有被觸發（若此時新前端尚未上線，預期會看到 legacy 事件；待新前端上線後，比照第 20.2 節開始 7 天監控窗口）
5. **7 天監控期**（第 20.2 節）：新前端上線後，觀察 legacy path 事件連續 7 天為 0，才建立獨立的 legacy path 清理任務。

**Gate**：比照 P2-AI-03 Gate C 標準——HTTP 200、真實 `generationId`、`source` 可觀測、前端顯示正確、無新增 console 錯誤、Observability 事件完整。

**回滾方式**：
- Migration：因為是純新增表，回滾＝執行對應 DOWN migration（`DROP TABLE shopkeeper_previews CASCADE` 等），不影響既有表。
- Function：`supabase functions deploy` 可透過重新部署上一版本程式碼回滾；`shopkeeper-preview` 若有問題可直接刪除該 Function（不影響 `wallpaper-generate` legacy path 仍可運作）。

**是否觸碰已部署 Function**：是（`wallpaper-generate` 正式更新；`shopkeeper-preview` 首次上線）。

**前後相容性**：部署當下依然向後相容（legacy path 存在），直到第 20.2 節條件滿足才會有後續的清理任務（不在本計畫範圍內）。

---

## 階段相依關係總覽

```
Phase 1 (Migration+RPC) ──► Phase 2 (Preview Function) ──► Phase 3 (Confirm Compat) ──► Phase 4 (DTO+Frontend SM)
                                                                                              │
                                                                                              ▼
                                                                                        Phase 5 (Download+UI)
                                                                                              │
                                                                                              ▼
                                                                                        Phase 6 (Local Regression)
                                                                                              │
                                                                                              ▼
                                                                                        Phase 7 (Deploy+E2E)
```

Phase 1／2 可視為低風險、可提前完成的「基礎設施」工作；Phase 3 是整個計畫中唯一直接碰觸已部署 `wallpaper-generate` 核心邏輯的階段，建議獨立安排更長的 Review 時間；Phase 4／5 純屬前端／DTO 擴充，風險遞減；Phase 6／7 為最終驗證與正式上線。
