P2-AI-04 Lite-4中文顯示修正已確認，現在授權部署，讓使用者進行正式E2E手動測試。

請依下列順序執行：

一、部署前檢查
1. 執行git status，列出P2-AI-04 Lite-4全部異動。
2. 確認不包含.env、API Key、下載測試圖片、node_modules或無關檔案。
3. 執行.\scripts\verify-local.ps1，必須維持247/247通過。
4. 確認CSS內自託管字型路徑正確：
   css/pages/wallpaper.css必須能正確存取
   fonts/noto-serif-tc/*.woff2。
5. 確認OFL.txt包含於版本控制。

二、Supabase Edge Function
1. wallpaper-prompt-builder.ts已修改，因此重新部署：
   npx supabase functions deploy wallpaper-generate
2. 本次沒有status DTO變更，除非依賴檢查證明必要，否則不要部署wallpaper-status。
3. 部署後記錄wallpaper-generate的新version與updated_at。
4. 用不含luckyTheme及blessing輸入欄位的request做一次smoke test。
5. 確認生成Prompt不再包含：
   Today's Blessing
   Date Watermark
6. 不執行任何migration，不修改資料庫。

三、Git及GitHub Pages部署
1. 將P2-AI-04 Lite-4的前端、Prompt Builder、測試、字型及授權檔加入commit。
2. commit message：
   fix(wallpaper): compose Traditional Chinese text on canvas
3. push目前正式使用的分支。
4. 等待GitHub Pages部署完成。
5. 不使用舊快取結果判定部署成功。

四、正式環境自動smoke test
開啟GitHub Pages正式wallpaper.html並確認：
1. wallpaper-canvas-composer.js回應200。
2. Regular 400及Bold 700 WOFF2字型回應200。
3. Console沒有404、CORS、FONT_LOAD_FAILED、
   CANVAS_UNSUPPORTED或BLOB_ENCODE_FAILED。
4. 新版CSS及JS確實載入，不是瀏覽器快取舊版。
5. 執行一次真實Gemini生成。
6. 圖片生成後進入「圖片合成中」狀態。
7. 合成完成後顯示正確繁體中文oneLiner。
8. 日期來自createdAt並以Asia/Taipei顯示。
9. 顯示Claw Lucky品牌。
10. 下載按鈕下載的是合成後圖片，不是Gemini原圖。
11. 預覽與下載圖片內容一致。
12. 店長今日祝福卡仍正常顯示5個欄位。

五、停止條件
若字型404、Canvas合成失敗、預覽空白、下載原始圖、
日期不一致或後製中文字錯誤，立即停止，不宣告部署成功。

六、回報
完成後回報：
- verify-local結果
- Edge Function新version
- commit SHA
- push結果
- GitHub Pages部署狀態
- 正式測試網址
- JS/CSS/WOFF2 HTTP狀態
- 真實生成Generation ID
- 預覽與下載驗證結果
- 已知限制

不要開始P2-AI-05、訂閱金流、OCR或其他功能。