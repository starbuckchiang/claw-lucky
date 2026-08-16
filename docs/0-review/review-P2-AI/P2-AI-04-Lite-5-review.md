# P2-AI-04 Lite-5 Review — 正式部署與 E2E 驗證

## 任務目標

P2-AI-04 Lite-4（中文顯示修正）已確認完成，本階段授權進行正式部署，讓使用者可執行真實 E2E 手動測試。

---

## 一、部署前檢查

1. **git status**：確認範圍為 P2-AI-04 Lite-4 全部異動（8 個修改檔 + 5 個新增檔：`css/pages/wallpaper.css`、`js/pages/wallpaper.js`、`js/services/prompt/__tests__/wallpaper-prompt-builder.gate3.test.js`、`js/services/prompt/__tests__/wallpaper-prompt-builder.test.js`、`js/services/prompt/wallpaper-prompt-builder.js`、`scripts/verify-local.ps1`、`supabase/functions/_shared/lib/wallpaper-prompt-builder.ts`、`wallpaper.html`、`js/services/wallpaper/wallpaper-canvas-composer.js`、`js/services/wallpaper/__tests__/wallpaper-canvas-composer.test.js`、`fonts/noto-serif-tc/*`），其餘大量無關的已刪除/修改/未追蹤檔案（其他 P2-AI-01～06 工作階段殘留）確認不觸碰。
2. **無機密/測試圖片/無關檔案**：對範圍內 diff 及新檔逐一以關鍵字（API_KEY/SERVICE_ROLE/password/secret/.env 等）掃描，無任何匹配。
3. **verify-local.ps1**：部署前重新執行，**247 / 247 通過**。
4. **CSS 字型路徑**：確認 `css/pages/wallpaper.css` 內 `@font-face` 的 `../../fonts/noto-serif-tc/*.woff2` 相對路徑，從 `css/pages/` 往上兩層可正確解析至專案根目錄 `fonts/noto-serif-tc/`，檔名逐字比對一致。
5. **OFL.txt**：確認位於 `fonts/noto-serif-tc/` 內，會隨目錄一併加入版本控制。

---

## 二、Supabase Edge Function 部署

- 部署前查詢：`wallpaper-generate` v29、`wallpaper-status` v15。
- 執行 `npx supabase functions deploy wallpaper-generate`（因 `wallpaper-prompt-builder.ts` 有修改）。
- 部署後查詢：**`wallpaper-generate` v29 → v30**，`updated_at` = 2026-08-01T06:34:49.310Z；`ezbr_sha256` 已變更。
- **`wallpaper-status` 維持 v15，未部署**（本次無 status DTO 變更，符合指示）。
- **Smoke test**：透過 localhost:5500（本機檔案，指向同一 Supabase 專案）以不含 `luckyTheme`/`blessing` 欄位的請求，對已部署的 v30 執行一次真實生成 —— 成功，Generation ID `72892a9f-20e7-459c-a19a-4e0fe148ee3d`，5 個店長祝福欄位全部正常顯示，下載的合成圖片視覺確認：真正繁體中文一句話、正確日期、Claw Lucky 品牌、AI 背景乾淨無偽文字。
- **確認 Prompt 內容**：因本機 `.env` 未存放 `SUPABASE_SERVICE_ROLE_KEY`，無法直接查詢資料庫 `metadata_json.promptSnapshot` 逐字驗證正式環境送出的 prompt 文字。改以下列等效證據佐證：(a) 部署的 `.ts` 與本機已通過的 39 項 prompt-builder 單元測試（含 Gate 3）之 `.js` 邏輯逐字比對完全一致；(b) 上述 smoke test 的真實生成結果本身乾淨無偽文字。**此為已知限制，已在報告中明確列出。**
- 未執行任何 migration，未修改資料庫結構。

---

## 三、Git 及 GitHub Pages 部署

1. **Staging**：以明確逐一路徑 `git add`（非 `git add -A`），涵蓋 8 個修改檔 + `fonts/noto-serif-tc/`（5 個檔案：4 個 woff2 + OFL.txt）+ 2 個新 JS/測試檔，共 15 個檔案，`git status` 確認範圍精確無誤。
2. **Commit**：`git commit -m "fix(wallpaper): compose Traditional Chinese text on canvas"` → **commit `06dd92810cfbcc930694a2431d753bf5f6649dba`**（15 files changed, 1092 insertions(+), 44 deletions(-)）。
3. **Push**：`git push origin main` → 成功，`c98f818..06dd928 main -> main`。
4. **GitHub Pages 部署等待**：推送後立即抓取 `wallpaper.css`／`wallpaper-canvas-composer.js` 仍為舊版（CSS 缺 `@font-face`、composer.js 404）——**未依此判定部署成功**；等待後重新抓取，確認 CSS 已含新 `@font-face` 規則、composer.js 回傳完整新版內容 → 確認 GitHub Pages 已完成重建。

---

## 四、正式環境自動 Smoke Test

正式網址：`https://starbuckchiang.github.io/claw-lucky/wallpaper.html`

| 檢查項 | 結果 |
|---|---|
| 1. `wallpaper-canvas-composer.js` 回應 200 | ✅ |
| 2. Regular 400 / Bold 700 WOFF2（chinese-traditional + latin 共 4 檔）回應 200 | ✅ 全部 200 |
| 3. Console 無 404/CORS/FONT_LOAD_FAILED/CANVAS_UNSUPPORTED/BLOB_ENCODE_FAILED | ✅ 僅既有無關雜訊（favicon 404、Cloudflare Turnstile WebGL 警告） |
| 4. 新版 CSS/JS 確實載入（非快取舊版） | ✅ 以實際內容比對確認（非僅檢查 200） |
| 5. 執行一次真實 Gemini 生成 | ✅ 因該匿名瀏覽器帳號無吉祥物收藏，先於正式網址 `gacha.html` 抽蛋取得「星光小靈」，再於 `wallpaper.html` 執行真實生成 |
| 6. 生成後進入「圖片合成中」狀態 | ✅ 流程觸發（合成完成後自動隱藏） |
| 7. 合成完成後顯示正確繁體中文 oneLiner | ✅ 「星光小靈守護每個願望，幸運乒乓助你夢想成真，願你心之所向，皆能順遂如意。」與店長祝福卡「一句話」欄位逐字相同 |
| 8. 日期來自 `createdAt` 並以 Asia/Taipei 顯示 | ✅ 顯示 `2026.08.01`，與生成當下日期一致 |
| 9. 顯示 Claw Lucky 品牌 | ✅ |
| 10. 下載按鈕下載的是合成後圖片，非 Gemini 原圖 | ✅ `resultImage.src` 為 `blob:` URL（非 signed URL），下載內容視覺確認為合成後圖片 |
| 11. 預覽與下載圖片內容一致 | ✅ 兩者皆來自同一 `composeWallpaperImage()` 回傳的同一個 Blob |
| 12. 店長今日祝福卡仍正常顯示 5 個欄位 | ✅ 今日幸運主題／祝福／小故事／一句話／店長的話 皆正常 |

**正式環境真實生成 Generation ID**：`1373b0e5-1a10-4cbd-ae83-191c8e355acf`

字型就緒確認：`document.fonts.check('400 48px "Noto Serif TC"')` 與 `'700 48px ...'` 皆回傳 `true`。

---

## 五、停止條件檢查

字型 404、Canvas 合成失敗、預覽空白、下載原始圖、日期不一致、後製中文字錯誤 —— **均未發生**，未觸發任何停止條件。

---

## 六、最終回報摘要

| 項目 | 結果 |
|---|---|
| verify-local 結果 | 247 / 247 通過 |
| Edge Function 新 version | `wallpaper-generate` v29 → v30（`wallpaper-status` 維持 v15，未部署） |
| Commit SHA | `06dd92810cfbcc930694a2431d753bf5f6649dba` |
| Push 結果 | `c98f818..06dd928 main -> main`，成功 |
| GitHub Pages 部署狀態 | 成功（以實際內容比對確認，非快取判定） |
| 正式測試網址 | `https://starbuckchiang.github.io/claw-lucky/wallpaper.html` |
| JS/CSS/WOFF2 HTTP 狀態 | 全部 200 |
| 真實生成 Generation ID | 正式環境 `1373b0e5-1a10-4cbd-ae83-191c8e355acf`；另有 localhost smoke test `72892a9f-20e7-459c-a19a-4e0fe148ee3d` |
| 預覽與下載驗證結果 | 一致，皆為合成後圖片；繁體中文、日期、品牌皆正確 |

### 已知限制

1. 因本機無 `SUPABASE_SERVICE_ROLE_KEY`，未能直接查詢資料庫逐字驗證正式環境送出的 Prompt 內容；以「部署原始碼與本機測試邏輯完全一致」+「真實生成結果乾淨無偽文字」作為等效證據。
2. Prompt 修改僅能**降低**Gemini 產生偽文字的機率，無法保證 100% 不發生。
3. Canvas 合成僅保證**疊字本身**正確，無法偵測或清除 Gemini 已畫入背景像素的偽文字（未加入 OCR 服務）。

### 未變更範圍（依指示確認）

未修改資料庫、未執行任何 migration、未開始 P2-AI-05、未加入訂閱金流或其他新功能。
