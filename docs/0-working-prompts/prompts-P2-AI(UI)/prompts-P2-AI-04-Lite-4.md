修改計畫方向確認，但請先修正以下項目再實作：

1. 日期不得使用Canvas合成當下的前端時間。
   先檢查submit/status DTO是否已有createdAt或created_at。
   若有，使用該時間轉換為Asia/Taipei的YYYY.MM.DD。
   只有確定不存在時，才提出最小generatedAt後端欄位方案。

2. 不使用dataURL作為預覽。
   canvas.toBlob後建立object URL供resultImage與下載共用。
   重新生成及頁面卸載時，必須revoke舊的raw及composited object URL。

3. 正式字型優先改為專案內自託管的Noto Serif TC WOFF2。
   合成前等待document.fonts.load及document.fonts.ready。
   字型載入失敗時顯示錯誤，不得靜默產出不確定字型的桌布。
   確認字型授權檔一併保留。

4. composeWallpaperImage應直接非同步回傳：
   { blob, previewUrl, width, height }
   不回傳dataUrl，也不要回傳容易誤用的toBlob函式。

5. Canvas尺寸必須完全沿用原始圖片像素尺寸，不乘devicePixelRatio。

6. 加入object URL生命週期、toBlob回傳null、字型載入失敗、
   重複生成及頁面卸載的測試。

7. Prompt Builder仍須禁止所有文字、數字、書法、簽名、印章、
   落款、標籤及writing-like symbols。

8. 同意修改Gate 3中與Today's Blessing及Date Watermark衝突的舊斷言，
   並在測試名稱註明新政策為image contains no rendered text。

9. 請明確說明：Prompt只能降低Gemini產生偽文字的機率，
   Canvas可保證後製文字正確，但不能自動清除已生成在背景像素中的偽文字。

10. 不修改資料庫、不開始P2-AI-05、不加入複雜OCR服務。
完成修正版計畫後再開始實作。