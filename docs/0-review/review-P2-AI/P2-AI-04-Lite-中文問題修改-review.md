# P2-AI-04 Lite-4 工作階段存檔 — AI 桌布偽繁體中文字修正

## 問題描述

Gemini 生成的 AI 桌布圖片內出現錯誤中文字、假書法落款及假印章。這不是 UTF-8 或 CSS 字型問題，而是圖像模型本身生成的偽文字（fake glyphs）。

## 工作階段流程

### 第一輪：初版修改計畫

分析 `wallpaper-prompt-builder.js` 後確認根因：目前把 `luckyTheme`／`blessing`／`date` 都當成「要 Gemini 畫進圖片的文字」（`Today's Lucky Theme`、`Today's Blessing`、`Date Watermark` 三行提示詞）。提出策略：**Gemini 只生成無文字背景 → 前端 Canvas 疊加真正的繁體中文文字 → 預覽與下載共用合成後圖片**，並輸出初版計畫存至 [docs/development/reports/P2-AI-04-Lite-中文顯示修改計畫.md](../docs/development/reports/P2-AI-04-Lite-中文顯示修改計畫.md)，留下兩個待確認決策點（日期來源、Gate 3 測試修改）。

### 第二輪：使用者提出 10 項修正意見，計畫修正為

1. **日期來源**：確認 submit/status DTO 已含 `createdAt`（`response-dto.js`/`progress-response-dto.js`/`wallpaper-result-presenter.js` 都已回傳）→ 前端用既有 `createdAt` 轉 Asia/Taipei `YYYY.MM.DD`，**不新增後端欄位、不猜測「現在」時間**。
2. **不用 dataURL**：改用 `canvas.toBlob()` → `URL.createObjectURL()`；新增 `createObjectUrlTracker()` 管理生命週期，重新生成與頁面卸載時自動 revoke 舊的 raw／composited object URL。
3. **正式自託管字型**：取用 `@fontsource/noto-serif-tc`（OFL 授權）套件的 Regular 400 + Bold 700、`chinese-traditional` + `latin` 子集 WOFF2，存入 `fonts/noto-serif-tc/`，保留 `OFL.txt`；合成前等待 `document.fonts.load()` + `document.fonts.ready`，並以 `document.fonts.check()` 確認真的就緒，失敗即拋錯、不靜默出圖。
4. `composeWallpaperImage()` 改為直接非同步回傳 `{ blob, previewUrl, width, height }`，不回傳 `dataUrl` 或容易誤用的 `toBlob()`。
5. Canvas 尺寸完全沿用原始圖片 `naturalWidth`/`naturalHeight`，不乘 `devicePixelRatio`。
6. 新增 object URL 生命週期、`toBlob` 回傳 `null`、字型載入失敗、重複生成、頁面卸載等測試。
7. Prompt Builder 維持全面禁止文字/數字/書法/簽名/印章/落款/標籤/writing-like symbols。
8. 同意修改 Gate 3 中與 `Today's Blessing`／`Date Watermark` 衝突的舊斷言，測試名稱註明新政策為 *"image contains no rendered text"*。
9. **明確聲明**：Prompt 修改只能**降低** Gemini 產生偽文字的機率，**無法保證 100% 不產生**；Canvas 合成保證的是**後製文字本身正確**（真正繁體中文），但**無法清除 Gemini 已經畫進背景像素中的偽文字**——這是影像模型的機率性限制，非後製流程能解決。
10. 不修改資料庫、不啟動 P2-AI-05、不加入 OCR 服務。

## 實作內容

| 分類 | 檔案 | 內容 |
|---|---|---|
| Prompt Builder | `js/services/prompt/wallpaper-prompt-builder.js` + `supabase/functions/_shared/lib/wallpaper-prompt-builder.ts` | 移除 `Today's Blessing`/`Date Watermark`；`luckyTheme` 改為氛圍參考用語；新增 `STRICTLY NO TEXT` 禁止清單與 `Text-Safe Zone` 指示 |
| Prompt 測試 | `js/services/prompt/__tests__/wallpaper-prompt-builder.test.js`、`wallpaper-prompt-builder.gate3.test.js` | 更新斷言，確認 blessing/date 不出現在 prompt 文字、含新政策關鍵字；Gate 3 Test 2/4 依新政策重寫 |
| Canvas 合成模組（新增） | `js/services/wallpaper/wallpaper-canvas-composer.js` | 純函式（`sanitizeOneLiner`/`formatTaipeiDateFromIso`/`buildFooterMetaLine`/`wrapTextByMeasurement`）+ `createObjectUrlTracker()` + `composeWallpaperImage()`（含 `IMAGE_LOAD_FAILED`/`FONT_LOAD_FAILED`/`CANVAS_UNSUPPORTED`/`BLOB_ENCODE_FAILED` 明確錯誤碼） |
| Canvas 測試（新增） | `js/services/wallpaper/__tests__/wallpaper-canvas-composer.test.js` | 22 個測試：換行（中文/英文/混合/特殊字元）、截斷省略號、object URL 生命週期、重複生成、字型/Canvas/圖片載入/toBlob 失敗情境 |
| 自託管字型（新增） | `fonts/noto-serif-tc/*.woff2` + `OFL.txt` | 取自 `@fontsource/noto-serif-tc`，Regular 400 + Bold 700，`chinese-traditional` + `latin` 子集 |
| CSS | `css/pages/wallpaper.css` | 新增對應 `@font-face` 宣告（`font-display: block`） |
| 前端頁面 | `wallpaper.html` | 新增 `#resultCompositing` 狀態文字；載入 `wallpaper-canvas-composer.js` |
| 頁面控制器 | `js/pages/wallpaper.js` | `showResult()` 改為 async 合成流程；原始 AI 圖僅存於記憶體 `currentResult.rawImageUrl`（除錯用，不顯示/不下載/不記錄）；`handleDownloadClick()` 改為下載 `currentResult.compositedBlob`；新增兩個 object URL tracker 並在 `beforeunload` 清理 |
| 測試基礎設施 | `scripts/verify-local.ps1` | 新增 `node --check js/services/wallpaper/wallpaper-canvas-composer.js` |

## 驗證結果

`.\scripts\verify-local.ps1` 全數通過：**247 / 247**（225 基準 + 22 個新增 Canvas 合成器測試），含更新後的 Gate 3／prompt-builder 測試（39 個，全過）。

## 重要聲明（回應需求第 9 點）

- Prompt Builder 的修改**只能降低**Gemini 產生偽文字的機率，**無法保證 100% 不產生**——這是影像模型本身的機率性限制。
- Canvas 疊字**保證的是後製文字本身正確**（真正繁體中文、使用自託管字型渲染），但**無法偵測或清除 Gemini 已經畫進背景像素中的偽文字**。本次修正未加入任何 OCR 或影像文字偵測/清除服務。

## 未變更範圍（依需求確認）

- 未修改資料庫（未新增後端 `date` 欄位，改用既有 `createdAt` 於前端轉換為 Asia/Taipei 日期）。
- 未啟動 P2-AI-05（Preview/重抽架構）。
- 未加入 OCR 或複雜影像文字偵測/清除服務。
- 未加入訂閱金流。

## 相關檔案

- 初版計畫：[docs/development/reports/P2-AI-04-Lite-中文顯示修改計畫.md](../docs/development/reports/P2-AI-04-Lite-中文顯示修改計畫.md)
- 逐檔案詳細異動紀錄：[review/P2-AI-04-Lite-4-review.md](./P2-AI-04-Lite-4-review.md)
