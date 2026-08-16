# P2-AI-04 Lite-4 Review — 修正AI桌布中的偽繁體中文字

## 問題

Gemini 生成的桌布圖片內出現錯誤中文字、假書法落款及假印章（圖像模型生成的偽文字，非 UTF-8/CSS 字型問題）。

## 修正方案

**Gemini 只生成純淨、無任何文字的背景圖 → 前端 Canvas 疊加真正的繁體中文文字（一句話 oneLiner + 日期 + 品牌）→ 預覽與下載都使用同一張合成後的圖。**

## 修改內容

### 1. Prompt Builder（禁止文字生成）
- `js/services/prompt/wallpaper-prompt-builder.js` 與 Deno 雙生檔 `supabase/functions/_shared/lib/wallpaper-prompt-builder.ts`：移除 `Today's Blessing`／`Date Watermark` 兩行（不再要求 Gemini 畫日期/祝福文字）；`luckyTheme` 改為「氛圍/色調參考」用語，明講不可轉譯為畫面文字；新增明確禁止清單（text、Chinese/Japanese characters、letters、numbers、calligraphy、captions、signatures、logos、watermarks、stamps、seals、labels、plaques、writing-like symbols）；新增「Text-Safe Zone」指示，要求畫面下方保留乾淨無雜訊區域供後製疊字。
- 更新測試：`js/services/prompt/__tests__/wallpaper-prompt-builder.test.js`（新增/調整斷言，確認 blessing/date 不再出現在 prompt 文字中，且含 `STRICTLY NO TEXT`/`Text-Safe Zone`）、`js/services/prompt/__tests__/wallpaper-prompt-builder.gate3.test.js`（Test 2/Test 4 依新政策改為驗證「image contains no rendered text」，其餘 3 項不變）。

### 2. 前端 Canvas 合成模組（新增，純前端，無 `.ts` 雙生檔）
- `js/services/wallpaper/wallpaper-canvas-composer.js`：
  - 純函式：`sanitizeOneLiner`、`formatTaipeiDateFromIso`（用既有 `createdAt` 欄位轉 Asia/Taipei `YYYY.MM.DD`，缺值回傳 `null`，絕不猜測「現在」時間）、`buildFooterMetaLine`、`wrapTextByMeasurement`（中文逐字換行、英文單字換行、混合、特殊字元、超過 3 行加省略號）。
  - `createObjectUrlTracker()`：追蹤並自動 revoke 前一個 object URL（重複生成安全）；`.clear()` 供頁面卸載時清理。
  - `composeWallpaperImage()`：非同步直接回傳 `{ blob, previewUrl, width, height }`（不回傳 `dataUrl`/`toBlob`）；Canvas 尺寸完全沿用來源圖片 `naturalWidth`/`naturalHeight`（不乘 devicePixelRatio）；合成前等待 `document.fonts.load()` + `document.fonts.ready` 並以 `document.fonts.check()` 確認字型真的就緒，失敗則拋出 `FONT_LOAD_FAILED`，絕不用不確定字型靜默出圖；圖片載入失敗 → `IMAGE_LOAD_FAILED`；Canvas 不支援 → `CANVAS_UNSUPPORTED`；`toBlob()` 回傳 `null` → `BLOB_ENCODE_FAILED`（絕不產生空白圖下載）。
- 測試：`js/services/wallpaper/__tests__/wallpaper-canvas-composer.test.js`（22 個測試，涵蓋換行、特殊字元、空 oneLiner、object URL 生命週期、重複生成、字型/Canvas/圖片載入/toBlob 各種失敗情境）。

### 3. 自託管字型
- 取用 `@fontsource/noto-serif-tc`（OFL 授權）套件的 Regular 400 + Bold 700、`chinese-traditional` + `latin` 子集 WOFF2，存入 `fonts/noto-serif-tc/`，並保留 `OFL.txt` 授權檔。
- `css/pages/wallpaper.css` 新增對應 `@font-face` 宣告（`font-display: block`，避免文字用錯誤字型短暫閃現）。

### 4. 前端頁面流程
- `wallpaper.html`：新增 `#resultCompositing`（「圖片合成中...」狀態文字）；新增 `<script>` 載入 `wallpaper-canvas-composer.js`（位於 `wallpaper.js` 之前）。
- `js/pages/wallpaper.js`：
  - `showResult()` 改為 async 合成流程：先填入 provider/model/blessing 卡片文字 → fetch 原始圖 Blob（沿用既有 CORS pattern，簽名 URL 全程不進 console/log）→ 交給 `composeWallpaperImage()` 疊字（用 DTO 既有的 `createdAt`／`oneLiner`）→ 合成後 Blob 同時用於 `<img>` 預覽與下載。任一步驟失敗（圖片載入失敗、跨網域失敗、字型未就緒、Canvas 不支援）→ 顯示既有 `#errorBox` 的明確錯誤訊息，不顯示下載按鈕、不產生空白圖。
  - 原始 AI 圖僅保留在記憶體 `currentResult.rawImageUrl`（除錯用），不在畫面顯示、不提供下載、不寫入 log。
  - `handleDownloadClick()` 改為直接下載 `currentResult.compositedBlob`（不再重新 fetch 簽名 URL）。
  - 新增兩個 `createObjectUrlTracker()` 實例（raw / composited），並在 `window.beforeunload` 呼叫 `.clear()`。

### 5. 測試基礎設施
- `scripts/verify-local.ps1`：`Syntax Check` 區塊新增 `node --check js/services/wallpaper/wallpaper-canvas-composer.js`。

## 驗證結果

`.\scripts\verify-local.ps1` 全數通過：**247 / 247**（225 基準 + 22 個新增 Canvas 合成器測試），含更新後的 Gate 3 / prompt-builder 測試（39 個，全過）。

## 重要聲明（依需求第 9 點）

- Prompt Builder 的修改**只能降低** Gemini 產生偽文字的機率，**無法保證 100% 不產生** —— 這是影像模型本身的機率性限制。
- Canvas 疊字**保證的是後製文字本身正確**（真正繁體中文、使用自託管字型渲染），但**無法偵測或清除 Gemini 已經畫進背景像素中的偽文字**。本次修正沒有加入任何 OCR 或影像文字偵測/清除服務（依需求第 10 點不加入複雜 OCR 服務）。

## 未變更範圍（依需求確認）

- 未修改資料庫（未新增後端 `date` 欄位，改用既有 `createdAt` 於前端轉換）。
- 未啟動 P2-AI-05（Preview/重抽架構）。
- 未加入 OCR 或訂閱金流相關功能。
