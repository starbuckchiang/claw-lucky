修正AI桌布中的偽繁體中文字。

問題：
Gemini生成的圖片內出現錯誤中文字、書法落款及印章。
這不是UTF-8或CSS字型問題，而是圖像模型生成的偽文字。
目前日期由程式後製所以正確，但圖片內的中文字不正確。

請實作以下最小修正：

1. 更新Wallpaper Prompt Builder：
   - Gemini只生成無文字背景。
   - 明確禁止text、Chinese/Japanese characters、letters、numbers、
     calligraphy、captions、signatures、logos、watermarks、stamps、
     seals、labels、plaques及writing-like symbols。
   - 要求下方保留安靜的文字安全區。
   - 不將blessing或oneLiner要求Gemini直接畫入圖片。

2. 新增前端Canvas合成：
   - 載入生成圖片。
   - 等待document.fonts.ready。
   - 使用Noto Serif TC或專案既有繁體中文字型。
   - 將oneLiner以正確繁體中文繪製在下方安全區。
   - 最多3行，自動換行。
   - 加入日期YYYY.MM.DD及Claw Lucky品牌。
   - 不把完整blessing放進圖片。
   - blessing仍顯示在圖片下方的店長祝福卡。

3. 預覽與下載必須使用同一張合成後Canvas圖片。
4. 下載PNG不得再直接下載Gemini原始signed URL。
5. signed URL及token不得寫入console或log。
6. 圖片跨網域載入失敗時，顯示可理解的錯誤，不要下載空白Canvas。
7. 保留原始AI圖片供除錯，但不要提供給使用者作為正式下載版本。
8. 補上文字換行、特殊字元、空oneLiner及Canvas失敗測試。
9. 不新增Preview／重抽架構，不修改訂閱或資料庫。
10. 先輸出修改計畫與影響檔案，確認後再實作。

將工作結果存檔至review/P2-AI-04-Lite-4-review.md