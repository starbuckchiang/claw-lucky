診斷 P2-AI-04 Lite localhost 真實生成失敗。

現象：
wallpaper.html 顯示：
[INVALID_REQUEST] Request validation failed.

已知：
1. 新版 js/pages/wallpaper.js 不再傳 luckyTheme 與 blessing。
2. P2-AI-04 Lite 已將 Node 與 Deno generation validator 的這兩個欄位改成非必填。
3. P2-AI-04 Lite review 顯示所有變更尚未 deploy。
4. localhost 目前呼叫已部署的 wallpaper-generate Edge Function。

請執行：
1. 檢查瀏覽器送出的 request payload。
2. 檢查已部署版本是否仍要求 luckyTheme、blessing。
3. 確認 Node CJS 與 Deno ESM validator 邏輯一致。
4. 執行完整 verify-local 測試。
5. 列出需要部署的 Supabase Function 與 shared files。
6. 部署 wallpaper-generate。
7. 部署後用不含 luckyTheme、blessing 的真實 payload 測試。
8. 確認取得 generationId，並完成 polling、祝福顯示與圖片下載。
9. 不修改資料庫、不新增 preview 架構、不開始 P2-AI-05。
10. 未經確認不要 commit 或 push。

請先回報根因與預計部署範圍，再執行部署。

完成後端部署並成功生成後，確認圖片下方實際顯示「店長今日祝福」卡片。

請檢查：
1. status response 是否包含 luckyTheme、blessing、story、oneLiner、shopkeeperMessage。
2. wallpaper-result-presenter.js 是否保留這5個欄位。
3. wallpaper.js 是否在 succeeded 狀態呼叫祝福卡渲染函式。
4. wallpaper.html 是否存在對應容器。
5. 容器是否因 hidden、display:none 或錯誤CSS而不可見。
6. blessing 必須使用 textContent，不使用 innerHTML。
7. 使用Playwright完成一次真實生成，保存成功畫面截圖。

若生成失敗，不得把空白祝福卡當作成功驗收。
不要開始P2-AI-05，也不要新增Preview或重抽功能。

P2-AI-04 Lite與Lite-2已完成真實驗證，授權進行版本控制收尾。

請執行：
1. git status，列出本次P2-AI-04 Lite相關變更。
2. 確認不包含.env、API Key、測試下載圖片或無關檔案。
3. 確認wallpaper-generate v29與wallpaper-status v15的本地原始碼都在commit範圍。
4. 執行完整verify-local，必須維持225/225通過。
5. commit本次P2-AI-04 Lite前端、後端及測試變更。
6. commit message：
   feat(wallpaper): deliver P2-AI-04 Lite result UI
7. push目前分支。
8. 等待GitHub Pages部署完成。
9. 部署後開啟正式網址，驗證新版UI載入。
10. 回報commit SHA、push結果、Pages部署狀態及正式網址。

不要修改資料庫，不要開始P2-AI-05，不要加入訂閱金流。