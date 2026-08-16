開始 P2-AI-04：Wallpaper UI Workflow Integration。

背景：
- P2-AI-02 Prompt Builder 已完成並部署
- P2-AI-03 Shopkeeper Context Agent 已完成並部署
- wallpaper-generate version 28
- 真實生成與 source=ai、Snapshot、Observability 已驗收通過
- 目前 wallpaper.html 仍是舊版 UI
- 舊版仍要求使用者自行輸入 luckyTheme／blessing
- 本階段要把 UI 正式接到 Shopkeeper Context Agent

本次只能做 Analysis。
禁止修改任何檔案、commit、push、migration、db push、
secrets 或 Function deploy。

一、開始前必讀

1. AI Constitution
2. P2-AI-02 規格、Gate Review 與驗收文件
3. P2-AI-03 規格、Final Acceptance 與部署文件
4. P2-AI roadmap 中 P2-AI-04 的定義
5. wallpaper.html
6. js/pages/wallpaper.js
7. wallpaper-generation-client.js
8. wallpaper-polling-service.js
9. wallpaper-result-presenter.js
10. wallpaper-generate Edge Function 與 DTO
11. shopkeeper-context-agent
12. generation-service
13. prompt-context-resolver
14. wallpaper-prompt-builder

二、確認目前舊版 UI

使用 Playwright MCP 唯讀開啟：

http://localhost:5500/wallpaper.html

盤點：

- 吉祥物選擇
- Gift 選擇
- Style 選擇
- luckyTheme 輸入
- blessing 輸入
- 生成按鈕
- loading／polling／result／error 狀態
- 圖片結果
- 是否有正式下載按鈕
- 手機版版面
- Console／Network 問題

只觀察，不點擊真實生成，不修改資料。

三、P2-AI-04 目標流程

分析以下目標流程：

1. 使用者選擇吉祥物
2. 使用者選擇已兌換 Gift
3. 選擇桌布 Style
4. 呼叫 Shopkeeper Agent
5. 顯示：
   - luckyTheme
   - blessing
   - story
   - oneLiner
   - shopkeeperMessage
6. 使用者可以接受或「再抽一次」
7. 確認後交給 Prompt Builder
8. 呼叫 Gemini Image Provider
9. 顯示生成進度
10. 顯示結果與正式下載按鈕

四、必須分析的架構問題

目前 P2-AI-03 的 Shopkeeper Agent 位於
wallpaper-generate 內部，前端在送出完整生成前看不到結果。

請比較至少以下方案：

A. 新增獨立 Shopkeeper Preview Edge Function
B. 擴充 wallpaper-generate 支援 preview／confirm 兩階段
C. 維持單一生成請求，生成後才顯示 Shopkeeper 內容
D. 其他符合現有架構的最小方案

每個方案比較：

- 是否符合目標 UI
- 是否重複呼叫 Gemini
- 重抽一次的 API 成本
- 是否會重複查詢 Mascot／Gift
- 如何避免前端竄改 luckyTheme／blessing
- Snapshot 與版本如何保存
- preview context 如何在 confirm 時驗證
- 是否需要新增資料表或 migration
- JWT／RLS／使用者所有權
- timeout／rate limit／fallback
- idempotency
- 與現有 wallpaper-generate 的相容性
- 部署與回滾風險

五、前端 Contract 分析

確認並提出：

1. wallpaper.html 應移除哪些欄位
2. wallpaper.js createGenerationRequest() 應移除哪些 payload
3. 前端是否完全禁止傳入 luckyTheme／blessing
4. Shopkeeper Preview Request DTO
5. Shopkeeper Preview Response DTO
6. Confirm／Generate Request DTO
7. UI state machine：

idle
→ selecting
→ blessingLoading
→ blessingReady
→ generating
→ polling
→ succeeded / failed

8. 「再抽一次」：
   - 最多次數
   - loading 防連點
   - 是否消耗額度
   - 舊 Preview 是否失效
9. 錯誤與 Fallback 顯示方式
10. 頁面重新整理後是否恢復 Preview

六、UI／UX 分析

提出新版頁面結構，但不要實作：

- 吉祥物卡片
- Gift 卡片
- Style 選擇
- 店長對話／祝福卡
- 今日主題
- Story
- One-liner
- Shopkeeper Message
- 再抽一次
- 確認生成
- 生成進度
- 桌布結果
- 下載按鈕
- 手機版 9:16 預覽

保留現有 Claw Lucky 品牌風格，不要改成通用 AI Dashboard。

七、邊界

P2-AI-04 不得：

- 修改 P2-AI-02 Prompt Builder 的核心架構
- 讓前端自行組裝 Image Prompt
- 讓使用者手動輸入 luckyTheme／blessing
- 把完整 Prompt 或 AI 原始回應暴露到前端
- 信任前端傳回未驗證的 Shopkeeper Context
- 建立第二套 Prompt Registry
- 破壞目前已成功的 wallpaper-generate 流程
- 順便修正 Kuromi 資料或其他無關功能

八、輸出

產出分析報告：

docs/development/reports/P2-AI-04-analysis-report.md

內容包含：

1. 現況 UI 與程式呼叫鏈
2. 舊版 UI 問題
3. 目標 User Flow
4. 方案比較表
5. 推薦方案與理由
6. 前後端 DTO 草案
7. UI state machine
8. 需要新增／修改的檔案清單
9. Security／RLS／JWT 分析
10. 測試策略
11. 驗收標準草案
12. Migration 是否需要
13. 與 P2-AI-02／03 的相容性
14. 尚需 Product Owner 決定的問題

特別回答：

- 如何做到「先看祝福、可以重抽、最後才生成圖片」？
- 如何保證使用者無法竄改 AI 產生的祝福？
- Preview 是否需要暫存於資料庫？
- 重抽應限制幾次？
- 是否需要獨立 Edge Function？
- 如何避免每次選項變動都自動花 Gemini 額度？

最後只輸出：
- Analysis 摘要
- 推薦方案
- 阻擋問題
- Product Decisions
- 是否 READY FOR IMPLEMENTATION

完成後停止，等待 Product Review。
不要修改任何功能檔案。