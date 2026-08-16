開始實作 P2-AI-04 Lite：Wallpaper UI Refresh。

目標是今天先完成新版 UI，不實作 Preview／重抽架構。

背景：
- P2-AI-02 Prompt Builder 已部署
- P2-AI-03 Shopkeeper Context Agent 已部署並真實驗收 PASS
- 現在後端已會自行產生 luckyTheme、blessing、story、
  oneLiner、shopkeeperMessage
- 舊 UI 仍要求使用者手動填 luckyTheme／blessing，
  但這兩個值實際已被後端忽略

本次範圍：

1. wallpaper.html 移除：
   - luckyTheme input
   - blessing textarea

2. 使用者只選：
   - mascot
   - gift
   - wallpaperStyle

3. wallpaper.js 的 request 不再傳：
   - luckyTheme
   - blessing

4. 後端 request validation：
   - luckyTheme／blessing 不再是 required
   - 若舊前端仍傳入，暫時忽略，不得信任其內容
   - 保留現有後端自行呼叫 Shopkeeper Agent 的流程
   - 不修改 Prompt Builder／Shopkeeper Agent 核心

5. 成功 DTO 安全回傳：
   - luckyTheme
   - blessing
   - story
   - oneLiner
   - shopkeeperMessage

6. 確認 Shopkeeper 顯示欄位能通過：
   - wallpaper-generate response
   - wallpaper-status response
   - progress-response-dto
   - wallpaper-result-presenter
   - 前端 succeeded state

7. 新版 UI 顯示：
   - 選擇摘要
   - 生成中狀態
   - 今日幸運主題
   - 祝福
   - 小故事
   - 店長的話
   - 生成圖片
   - 正式下載按鈕

8. 下載採：
   fetch signed URL → Blob → object URL → click
   完成後 revokeObjectURL。
   不把 signed URL 或 token 寫入 logs。

9. 保持：
   - 手機版 390×844 正常
   - aria-live
   - 防止重複點擊
   - 原有 polling／錯誤處理
   - Claw Lucky 品牌風格

明確不做：

- shopkeeper-preview Function
- shopkeeper_previews table
- migration／RPC／advisory lock
- 生成前 Preview
- 再抽一次
- Preview 每日額度
- Kuromi 圖片修正
- P2-AI-02／03 核心重構

上述功能移到 P2-AI-05。

測試要求：

1. request 不再包含 luckyTheme／blessing
2. 缺少這兩欄仍可生成
3. 後端仍使用 Shopkeeper AI Context
4. 成功 DTO 包含五個安全顯示欄位
5. polling 後欄位不遺失
6. UI 不再出現手動 Prompt 欄位
7. 下載按鈕可產生 Blob download
8. 手機版正常
9. 既有 207 項測試不得回歸
10. 使用 Playwright MCP 做 localhost 驗收，但先不要真實生成

完成後輸出：
- 修改檔案
- 新 UI 流程
- 測試結果
- Playwright 截圖
- 是否 READY FOR DEPLOYMENT

不要 commit、push 或 deploy。