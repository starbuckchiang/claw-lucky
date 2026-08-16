# P2-AI-04 Lite-4 修改計畫（修正AI桌布偽繁體中文字）

狀態：**尚未實作，待確認**

## 問題根因

`wallpaper-prompt-builder.js` 目前把 `luckyTheme`／`blessing`／`date` 都當成「要 Gemini 畫進圖片的文字」（`Today's Lucky Theme`、`Today's Blessing`、`Date Watermark` 三行），Gemini 影像模型無法正確生成繁體中文字形，因而產生偽文字、假書法、假印章。這不是 UTF-8 或 CSS 字型問題，而是圖像模型生成的偽文字。

## 修正策略

**Gemini 只生成純淨背景圖（不含任何文字）→ 前端 Canvas 疊加真正的繁體中文文字（oneLiner + 日期 + 品牌）→ 預覽與下載都使用合成後的圖。**

---

## 影響檔案清單

### A. Prompt Builder（禁止文字生成）

| 檔案 | 修改內容 |
|---|---|
| `js/services/prompt/wallpaper-prompt-builder.js` | 移除 `Today's Blessing`、`Date Watermark`（不再要求 Gemini 畫日期/祝福文字）；`luckyTheme` 保留但改為「氛圍／色調參考」用語且明講不可轉譯為畫面文字；新增明確禁止清單：text, Chinese/Japanese characters, letters, numbers, calligraphy, captions, signatures, logos, watermarks, stamps, seals, labels, plaques, writing-like symbols；新增「畫面下方保留安靜、乾淨、無雜訊的文字安全區（供後製疊字使用）」指示 |
| `supabase/functions/_shared/lib/wallpaper-prompt-builder.ts` | 與上述同步（Deno 雙生檔） |
| `js/services/prompt/__tests__/wallpaper-prompt-builder.test.js` | 更新斷言以符合新 prompt 內容 |
| `js/services/prompt/__tests__/wallpaper-prompt-builder.gate3.test.js` | **Test 2 / Test 4 目前斷言畫面中含 literal `Today's Blessing`／`Date Watermark` 文字，這與新政策衝突，需要修改斷言**（決定性、Character Identity、Validation 三項不變）。這是正式 Gate 3 驗收紀錄檔，修改前需確認可以動它。 |

`luckyTheme`／`blessing`／`date` 欄位本身**不會**從 `WallpaperPromptInput`／validator 移除（避免牽動 resolver/validator/generation-service 呼叫鏈），只是不再逐字出現在送給 Gemini 的 prompt 文字中。

### B. 新增：前端 Canvas 合成模組（無 `.ts` 雙生檔，純前端）

| 檔案 | 內容 |
|---|---|
| **新增** `js/services/wallpaper/wallpaper-canvas-composer.js` | 純函式：`wrapTextByMeasurement()`（CJK 逐字換行 + 特殊字元防呆，最多 3 行＋省略號）、`sanitizeOneLiner()`（空值/非字串防呆）、`buildDateBrandLine(dateText, brandText)`。DOM 邏輯：`composeWallpaperImage({ blobUrlImage, oneLiner, dateText, brandText, doc, fontFamily })` → 建立離屏 `canvas`、繪圖、輸出安全區文字（半透明底色確保可讀性）、回傳 `{ toBlob(), dataUrl }`。Canvas 不支援（`getContext` 回 `null`）與圖片載入失敗都會拋出明確可辨識的錯誤，不產生任何 Blob。 |
| **新增** `js/services/wallpaper/__tests__/wallpaper-canvas-composer.test.js` | 涵蓋：換行（中文逐字/英文單字/混合）、超過 3 行截斷+省略號、特殊字元（emoji、標點）、空 `oneLiner`（僅顯示日期＋品牌，不崩潰）、mock canvas context 模擬 `getContext` 回 `null` → 拋錯、mock 圖片載入失敗 → 拋錯不產生 Blob。 |

### C. 前端頁面流程

| 檔案 | 修改內容 |
|---|---|
| `wallpaper.html` | `<head>` 新增 Google Fonts `Noto Serif TC` `<link>`；新增 `<script>` 載入 `wallpaper-canvas-composer.js`；`<img id="resultImage">` 保留但其 `src` 改為合成後的圖 |
| `js/pages/wallpaper.js` | `showResult()` 改為 async 合成流程：① 顯示「圖片合成中...」狀態 ② `fetch(imageUrl, {mode:"cors"})` 取得原始圖 Blob（沿用現有 CORS pattern，簽名 URL 全程不進 console/log） ③ 建立 blob URL → `Image` 載入 ④ `await document.fonts.ready` + 明確 `document.fonts.load()` 確保 Noto Serif TC 就緒 ⑤ 呼叫 `wallpaperCanvasComposer.composeWallpaperImage()` 疊上 oneLiner（最多3行）＋日期（前端以 Asia/Taipei 計算）＋「Claw Lucky」品牌 ⑥ 合成成功：`resultImage.src` = 合成後 dataURL/blob URL，並把合成後 Blob 存進 `currentResult.compositedBlob` 供下載使用；原始 AI 圖僅保留在記憶體 `currentResult.rawImageUrl`（除錯用，不在畫面顯示、不提供下載）⑦ 任一步驟失敗（圖片載入失敗、跨網域失敗、Canvas 不支援）→ 呼叫既有 `showError()` 顯示明確錯誤，**不顯示下載按鈕、不產生空白圖**。`handleDownloadClick()` 改為直接下載已存好的 `currentResult.compositedBlob`（不再重新 fetch signed URL）。 |
| `css/pages/wallpaper.css` | 視需要新增「合成中」狀態文字樣式（可能沿用既有 class） |

### D. 測試基礎設施

| 檔案 | 修改內容 |
|---|---|
| `scripts/verify-local.ps1` | `== Syntax Check ==` 區塊新增一行 `node --check js/services/wallpaper/wallpaper-canvas-composer.js`；`__tests__` glob 已涵蓋 `js/services/wallpaper/__tests__/*.test.js`，新測試檔會自動被抓到，無需改 glob |

### E. 最終交付

| 檔案 | 內容 |
|---|---|
| **新增** `review/P2-AI-04-Lite-4-review.md` | 工作結果紀錄 |

---

## 需要確認的兩個決策點

1. **日期來源**：目前 DTO（`response-dto.js`/`progress-response-dto.js`）沒有回傳後端解析出的 `date` 欄位。為避免再次牽動 5 個後端檔案（`generation-service.js`→`response-dto.js`→`generation-query-repository.js`→`generation-query-service.js`→`wallpaper-result-presenter.js`），計畫**在前端用與後端相同的 Asia/Taipei 邏輯（`Intl.DateTimeFormat timeZone: "Asia/Taipei"`）即時計算日期**，而不新增後端欄位。極端邊界（跨午夜幾毫秒差）可接受。若需要日期必須與 prompt 產生當下完全一致（不容許任何時間差），需改為新增後端 `date` 欄位（會多動 5 個檔案+測試）。
2. **Gate 3 測試檔**：`wallpaper-prompt-builder.gate3.test.js` 的 Test 2 / Test 4 目前斷言畫面文字含 `Today's Blessing`/`Date Watermark`，這是正式驗收紀錄檔，計畫修改其斷言以符合新的「禁止文字」政策（其餘 3 項測試不受影響）。

其餘（原始圖僅供除錯不對外提供、跨網域失敗不下載空白圖、signed URL 不進 log、不動資料庫、不新增 Preview/重抽架構）均按原始需求原樣落實，無需額外確認。

修正版計畫（回應 10 項修正意見）
日期：已確認 wallpaper-result-presenter.js 的成功結果已含 createdAt（來自 response-dto.js/progress-response-dto.js）→ 不新增後端欄位，前端用 Intl.DateTimeFormat(timeZone:"Asia/Taipei") 把既有 createdAt ISO 字串轉成 YYYY.MM.DD，非「當下」時間。
不用 dataURL：composeWallpaperImage 內部用 canvas.toBlob() → URL.createObjectURL()；重新生成／頁面卸載時 revoke 舊的 raw 與 composited object URL。
自託管字型：改用 @fontsource/noto-serif-tc（OFL 授權，已確認存在）取出 Regular 400 + Bold 700 的 chinese-traditional + latin WOFF2，連同 OFL.txt 存進 repo fonts/noto-serif-tc/，@font-face 宣告在 wallpaper.css；合成前 document.fonts.load()+document.fonts.ready，載入失敗顯示錯誤、不靜默用不確定字型出圖。
composeWallpaperImage() 直接 async 回傳 { blob, previewUrl, width, height }，不回傳 dataUrl/toBlob。
Canvas 尺寸 = 原始圖片 naturalWidth/naturalHeight，不乘 devicePixelRatio。
新增測試：object URL 生命週期（revoke 呼叫次數/時機）、toBlob 回傳 null、字型載入失敗、重複生成（前一輪 URL 被 revoke）、頁面卸載清理。
Prompt Builder 維持全面禁止 text/numbers/calligraphy/signatures/seals/stamps/labels/writing-like symbols。
同意修改 Gate 3 中與 Today's Blessing/Date Watermark 衝突的斷言，測試名稱會註明新政策為 "image contains no rendered text"。
明確聲明：Prompt 修改只能降低 Gemini 產生偽文字的機率，無法保證 100% 不產生；Canvas 疊字保證的是後製文字本身正確（真正的繁體中文），但無法清除或修正 Gemini 已經畫進背景像素中的偽文字——這是影像模型的機率性限制，非後製流程能解決。
不修改資料庫、不啟動 P2-AI-05、不加入 OCR 服務。
現在依此修正版計畫開始實作。
