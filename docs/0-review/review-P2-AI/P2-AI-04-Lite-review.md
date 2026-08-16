# P2-AI-04 Lite Review — Wallpaper UI Refresh（移除手動 Prompt 欄位、店長祝福顯示、下載按鈕）

Source prompt: [docs/working-prompts/prompts-P2-AI-04-Lite.md](../docs/working-prompts/prompts-P2-AI-04-Lite.md)

**狀態：實作完成。未 commit、未 push、未 deploy。**

## Scope Delivered

今天完成新版 UI（不含 Preview／重抽架構，該部分留待 P2-AI-05）：

- 移除 `wallpaper.html` 的 `luckyTheme` input／`blessing` textarea，使用者只選 mascot／gift／wallpaperStyle。
- `wallpaper.js` 的生成請求不再傳送 `luckyTheme`／`blessing`。
- 後端 Request Validation 將這兩欄改為非必填；若舊前端仍傳入，正規化但不信任其內容（沿用 P2-AI-03 既有的 Shopkeeper 覆蓋行為）。
- 成功 DTO 新增 5 個安全顯示欄位：`luckyTheme`／`blessing`／`story`／`oneLiner`／`shopkeeperMessage`，並確認可完整流過 submit response → status response → presenter → 前端顯示，不遺失。
- 新版 UI 顯示：選擇摘要、生成中狀態、今日幸運主題、祝福、小故事、店長的話、生成圖片、正式下載按鈕。
- 下載採 fetch signed URL → Blob → object URL → click → revokeObjectURL，不將 signed URL／token 寫入 logs。
- 保持手機版 390×844、aria-live、防止重複點擊、既有 polling／錯誤處理、Claw Lucky 品牌風格。

## 修改檔案清單

### 前端
- [wallpaper.html](../wallpaper.html)
- [js/pages/wallpaper.js](../js/pages/wallpaper.js)
- [css/pages/wallpaper.css](../css/pages/wallpaper.css)

### 後端（Node CJS + Deno ESM twin 各一對，邏輯保持一致）
- `js/services/wallpaper/generation-validator.js` + `supabase/functions/_shared/lib/generation-validator.ts`
- `supabase/functions/_shared/wallpaper-generate-handler.js` + `.ts`
- `js/services/wallpaper/response-dto.js` + `supabase/functions/_shared/lib/response-dto.ts`
- `js/services/wallpaper/generation-service.js` + `supabase/functions/_shared/lib/generation-service.ts`
- `js/services/wallpaper/progress-response-dto.js` + `supabase/functions/_shared/lib/progress-response-dto.ts`
- `js/services/wallpaper/generation-query-repository.js` + `supabase/functions/_shared/lib/generation-query-repository.ts`
- `js/services/wallpaper/generation-query-service.js` + `supabase/functions/_shared/lib/generation-query-service.ts`
- `js/services/wallpaper/wallpaper-result-presenter.js`（前端專用，無 `.ts` twin）

### 新增／更新測試（新增 18 項）
- 新增：`js/services/wallpaper/__tests__/generation-validator.test.js`、`response-dto.test.js`、`wallpaper-result-presenter.test.js`
- 擴充：`generation-service.test.js`、`generation-query-repository.test.js`、`supabase/functions/_shared/__tests__/wallpaper-generate-handler.test.js`
- 修正一項既有斷言：`generation-query-service.test.js` 的欄位清單測試（因新增欄位而更新，非回歸）

## 關鍵設計決策

- **安全欄位排除**：`source`（ai|fallback）與 `shopkeeperVersion` 全程不透出到任何一層 Response DTO——`response-dto.test.js` 專門測試「即使 record 上有這兩欄，DTO 也不會帶出」。
- **資料一致性**：成功 DTO 的 5 個欄位直接取自 `generation-service.js` 內已經在使用的同一個 `shopkeeperContext` 物件，保證顯示內容與實際用於生成 Prompt 的內容逐字一致。
- **下載機制選型**：`<a download>` 對跨網域（Supabase Storage 網域）簽名 URL 不可靠，改採 fetch→Blob→object URL→click→revoke，涵蓋 GitHub Pages／localhost／主流行動瀏覽器，且不需要新增 Edge Function。
- **向後相容**：`luckyTheme`／`blessing` 改為非必填而非直接禁止，允許舊版前端／舊請求仍可運作（值會被忽略，不信任內容）。

## 新版 User Flow

選擇吉祥物＋Gift＋風格 → 點擊「開始生成」→ 進度輪詢 → 成功後同時顯示：桌布圖片＋祝福卡（今日幸運主題／祝福／小故事／一句話／店長的話）＋正式下載按鈕 → 點擊下載按鈕觸發 fetch→Blob→object URL 下載流程，完成後釋放 object URL。

## 測試結果

`.\scripts\verify-local.ps1`：**225/225 全數通過**（207 既有 ＋ 18 新增，0 失敗，0 回歸）。

## Playwright 驗收（localhost，未做真實生成）

- 桌面截圖：`docs/development/reports/P2-AI-04-Lite-desktop.png`
- 手機（390×844）截圖：`docs/development/reports/P2-AI-04-Lite-mobile.png`
- 確認事項：
  - UI 上不再出現 Lucky Theme／祝福文字手動輸入欄位。
  - Console 僅既有、無關的 2 個錯誤（favicon 404、Kuromi 占位圖片載入失敗），無新增錯誤。
  - 手機版版面正常，無版面錯位。
  - 未點擊「開始生成」，因此下載按鈕實際下載行為與祝福卡「生成後顯示」尚未做真實截圖驗證——其正確性由 DTO 傳遞鏈的自動化測試（response-dto/progress-response-dto/generation-query-repository/wallpaper-result-presenter 四層）保證。

## 是否 READY FOR DEPLOYMENT

**⚠️ 尚未 READY。** 已完成的部分（欄位移除、DTO 傳遞、下載邏輯、測試）可視為已驗證，但缺一項關鍵確認：**真實生成的端到端驗證**（下載按鈕實際下載行為、祝福卡真實內容顯示、Signed URL 實際 CORS 行為），因任務明確要求本次不做真實生成。

## 建議下一步

1. 以真實帳號跑一次生成，人工確認：祝福卡內容正確顯示、下載按鈕實際觸發下載、檔名格式正確。
2. 確認 Supabase Storage 簽名 URL 的實際 CORS 行為與本報告的標準行為推論一致。
3. 通過以上確認後，即可安排 commit／push／deploy（本次任務範圍不包含這些操作）。

## 明確不做（移至 P2-AI-05）

`shopkeeper-preview` Function、`shopkeeper_previews` 資料表、migration／RPC／advisory lock、生成前 Preview、再抽一次、Preview 每日額度、Kuromi 圖片修正、P2-AI-02／03 核心重構。
