請將 P2-AI-04 Analysis Report 修訂為 v3，解決 Product Review
發現的並行、額度預約、Preview finalize 與 Job 冪等問題。

仍是 Analysis／Planning 階段。
禁止修改功能程式碼、migration、commit、push 或 deploy。

已確認 Product Decision：

Gift 已兌換後可重複用於桌布生成。
P2-AI-04 不消耗或修改 redeem_history。
只驗證目前使用者至少存在一筆對應 Gift 的有效兌換紀錄。
Gift 次數／庫存／一次性消耗另立任務。

一、修正 Preview 建立流程

目前設計不能在 Gemini 呼叫後才檢查額度。

改成三階段：

1. reserve
2. generate context
3. finalize

Reserve RPC 必須：

- 驗證每日 20 次上限
- 驗證 Session 合計 3 次上限
- 配置 previewId、sessionId、sequenceNo
- 建立 status = pending 的 Preview reservation
- 不使舊 ready Preview 失效
- 回傳 reservation 資訊

Generate：

- Reserve 成功後才呼叫 Shopkeeper Agent
- Reserve 被拒絕時不得呼叫 Gemini
- timeout/provider failure 仍沿用既有 Shopkeeper Fallback
- Agent 回傳完整 Context 後進入 finalize

Finalize RPC 必須：

- 驗證 reservation owner／status
- 寫入 context_snapshot、source、shopkeeperVersion
- 將 reservation 改為 ready
- 同一交易內 invalidated 同 Session 的舊 ready Preview
- 新 Preview ready 前，舊 Preview保持有效
- finalize 重複呼叫必須冪等
- finalize 系統性失敗時，reservation 標記 failed，
  不使舊 Preview 失效

二、解決並發上限

目前 SELECT count + FOR UPDATE 無法防止：

- 同一使用者同時建立兩個全新 Session
- 每日第 20／21 次並發
- 同一 Session 並發重抽

請設計可靠的 DB serialization。

優先評估：

- pg_advisory_xact_lock，以 userId + Taipei usage date
  序列化每日 Preview reserve
- 以 userId + sessionId 序列化 Session reserve
- UNIQUE(user_id, session_id, sequence_no)
- status／sequence_no CHECK constraints

確認 advisory lock key 的產生方式穩定、不碰撞且不依賴
PostgreSQL 內建 hash 的不穩定假設。

若建議使用獨立 quota counter table，也要比較優缺點。

證明以下並發情境不會超額：

1. daily count = 19，兩個新 Session 同時 reserve
2. session count = 2，兩個 reroll 同時 reserve
3. 同一 request 因網路重送兩次

三、修訂 shopkeeper_previews 狀態模型

至少評估欄位：

- id
- user_id
- session_id
- mascot_id
- gift_id
- wallpaper_style
- sequence_no
- status：pending / ready / failed / consumed / invalidated
- context_snapshot
- shopkeeper_version
- source
- created_at
- expires_at
- finalized_at
- consumed_at
- consumed_job_id
- invalidated_at
- failure_code

定義每一種合法狀態轉移，並用 CHECK constraints
避免不合法組合。

四、修訂 Confirm Consume

不要以 generationId 作為尚未存在的前置條件。

先確認現有 generation-orchestrator 的真實順序：

- 每日上限檢查
- 點數檢查
- Job 建立
- generation-service 呼叫
- wallpaper_generations 寫入
- 成功／失敗標記

使用現有 jobId 作為 Preview Consume 的冪等鍵。

設計原子 consume RPC：

輸入：
- previewId
- userId
- mascotId
- giftId
- wallpaperStyle
- jobId

行為：

1. ready 且未消費：
   - 原子設定 consumed_at
   - 設定 consumed_job_id = jobId
   - 回傳 context_snapshot

2. 已由相同 jobId 消費：
   - 視為冪等重試
   - 回傳同一份 context_snapshot
   - 不再次消費

3. 已由不同 jobId 消費：
   - PREVIEW_ALREADY_CONSUMED

4. expired / invalidated / selection mismatch / owner mismatch：
   - 拒絕

確認 RPC 僅授權 service_role，並避免用不同錯誤碼
對未授權使用者洩漏任意 previewId 是否存在。
對外可使用較少、較安全的錯誤分類；
內部 logs 再記錄詳細原因。

五、驗證現有 Job 重試能力

不得只因資料表存在 retry_count 就宣稱已有重試功能。

逐檔確認：

- 誰建立 job
- 誰標記 running／success／failed
- 是否存在 retry worker／scheduler
- retry_count 是否真的被讀寫
- 同一 jobId 是否會再次進入 generation-service
- Provider failure 後使用者目前能否手動重試
- 點數與每日額度在重試時如何避免重複扣除

結論分成：

- 已有完整 Job retry
- 只有資料模型，尚無執行機制
- 完全沒有 retry

若尚無完整 retry，不得把它列為 P2-AI-04 已有能力。
提出 MVP 失敗策略，但不要擴張成新的 Retry 子系統。

六、修正過渡期部署策略

新版後端先部署時：

- previewId 存在：
  使用新版 Preview Consume 路徑
- previewId 不存在：
  暫時保留目前已驗證的 legacy path：
  後端自行呼叫 Shopkeeper Agent
- legacy request 的 luckyTheme／blessing 繼續忽略，
  絕不信任客戶端內容
- 新版 UI 上線後，再另立清理任務移除 legacy path

定義 legacy path 的移除條件與監控事件。

不得在同一 release 中先讓舊版 UI 失效。

七、完整追蹤 Response DTO

逐一檢查並列出：

- wallpaper-generate submit response
- generation success DTO
- wallpaper-status response
- progress-response-dto
- wallpaper-result-presenter
- 前端 succeeded state

決定 Shopkeeper 顯示內容在哪些 response 中出現。

要求：

- Preview 階段顯示完整安全文字
- 生成成功後仍能顯示相同內容
- Polling 完成後不能遺失
- 不回傳 source、shopkeeperVersion、完整 Prompt 或 raw AI response
- 前端顯示值必須與 DB Snapshot 一致

八、下載按鈕技術分析

確認 Storage signed URL 的跨網域行為。

比較：

- <a download>
- fetch signed URL → Blob → object URL → click
- 專用 download endpoint

選擇能在 GitHub Pages／localhost／手機瀏覽器可靠工作的方案，
並處理：

- CORS
- signed URL 過期
- 檔名
- object URL revoke
- 下載失敗訊息
- 不把 signed URL token 寫入 logs

九、修訂 Migration／RPC／測試清單

更新：

docs/development/reports/P2-AI-04-analysis-report.md
docs/development/reports/P2-AI-04-product-decisions.md

新增 Implementation Plan 草案：

docs/development/reports/P2-AI-04-implementation-plan.md

Plan 必須拆成可獨立驗收的階段：

Phase 1：Migration + Preview state/RPC
Phase 2：Shopkeeper Preview Function
Phase 3：Generate Confirm compatibility path
Phase 4：Response DTO + Frontend state machine
Phase 5：Download + responsive UI
Phase 6：Local integration + regression tests
Phase 7：Deployment gates + real E2E

每一階段列出：

- 修改檔案
- 測試
- Gate
- 回滾方式
- 是否會觸碰已部署 Function
- 前後相容性

最後回報：

- v3 修訂摘要
- 並發安全證據
- Reserve／Finalize／Consume 狀態模型
- Job retry 真實能力
- 過渡部署策略
- DTO 傳遞鏈
- Download 方案
- 是否 READY FOR IMPLEMENTATION
- 是否仍有阻擋問題

完成後停止。
不要實作、commit、push 或 deploy。