整體方向正確，但目前計畫還不能保證「完全沒有偽文字」。建議修改後再實作。

評估結果
Gemini只產生背景、Canvas後製繁體中文：正確。
修改Gate 3測試：可以。
前端即時計算日期：不建議。
使用Data URL預覽：不建議。
Google Fonts外部載入：可以測試，但正式版不夠穩定。
缺少Blob URL記憶體釋放。
Prompt只能降低偽文字，不能保證Gemini不再畫出落款或印章。
必須調整的部分
1. 日期不要使用「下載當下時間」

若使用者在23:59生成、00:01才完成Canvas，可能發生：

店長內容屬於8月1日。
桌布卻顯示8月2日。

應優先使用生成紀錄既有的createdAt或created_at，轉成Asia/Taipei日期。先檢查目前status DTO是否已經有建立時間；有就直接使用，不必新增五層欄位。

只有完全沒有時間欄位時，才新增後端generatedAt。不要用前端new Date()代表生成日期。

2. 不要使用Data URL預覽

高解析桌布轉Data URL會：

增加約33%記憶體。
長字串常駐頁面。
行動裝置更容易記憶體不足。

應改成：

canvas.toBlob()
→ URL.createObjectURL(compositedBlob)
→ resultImage.src = objectURL

下載直接使用同一個compositedBlob。

重新生成或離開頁面時必須：

URL.revokeObjectURL(previousPreviewUrl);
URL.revokeObjectURL(rawBlobUrl);
3. 字型最好放在專案內

正式版本建議把授權允許的Noto Serif TC WOFF2放進專案，例如：

assets/fonts/noto-serif-tc-regular.woff2

再以@font-face載入。這樣可以避免：

Google Fonts被封鎖。
離線或網路不穩。
Canvas合成時外部字型尚未完成。
不同裝置fallback字型結果不同。

合成前仍應執行：

await document.fonts.load('48px "Noto Serif TC"');
await document.fonts.ready;

如果字型載入失敗，應停止正式合成，不能靜默改用不確定的fallback字型。

4. Prompt不能保證完全移除偽文字

即使加入no text，浮世繪、海報、古畫等風格仍可能自動產生印章與落款。

第一版最小處理可以是：

強化禁止文字Prompt。
不要求Gemini產生任何文字。
Canvas只負責正確文字。
成功畫面增加「背景含異常文字，重新生成」按鈕。
這個按鈕只重新執行原本生成流程，不建立P2-AI-05 Preview／重抽架構。
異常版本不應成為正式下載檔。

若要全自動偵測，需要OCR或視覺模型檢查，會增加成本及誤判，目前不建議加入。

兩個決策答案
日期來源：不接受前端即時計算；先使用生成紀錄createdAt，沒有才新增後端generatedAt。
Gate 3測試：同意修改。因產品政策已由「要求模型畫文字」正式改成「禁止模型畫文字」，舊斷言本來就應該更新。