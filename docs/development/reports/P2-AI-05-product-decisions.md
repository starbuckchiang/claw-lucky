# P2-AI-04 Product Decisions（已確認，Product Review 定案）

**狀態：規格修訂階段，本文件與 [P2-AI-04-analysis-report.md](./P2-AI-04-analysis-report.md) 均為分析文件，未修改任何功能程式碼。**

以下 15 項為 Product Owner 對原分析報告（`P2-AI-04-analysis-report.md` 初版）提出的決策回覆，取代初版第 14 節「尚需 Product Owner 決定的問題」中的對應開放問題。本次修訂即依此 15 項重新設計架構、資料表、API 契約與流程。

| # | 決策 | 對應初版開放問題 / 影響 |
|---|---|---|
| 1 | 採用獨立 `shopkeeper-preview` Edge Function | 沿用初版推薦方案 A 的「獨立 Function」部分 |
| 2 | **不**採用純 Stateless previewToken | 推翻初版「stateless 簽章 token」設計（該設計無法滿足 #5/#8/#9，見分析報告第一節錯誤修正） |
| 3 | 新增 DB-backed `shopkeeper_previews` 短效紀錄 | 取代 stateless token，成為新的持久層 |
| 4 | 前端只取得 opaque `previewId`（不含完整 context 的可還原編碼） | 強化「前端無法竄改」的邊界 |
| 5 | 每個 Preview Session：首次 1 次＋最多再抽 2 次＝合計最多 3 次 | 回答初版「重抽應限制幾次？」 |
| 6 | 每位使用者每日最多 20 次 Preview | 回答初版「每日 Preview 呼叫總量上限？」 |
| 7 | Preview 有效期限 10 分鐘 | 回答初版「previewToken 有效期限？」 |
| 8 | 每個 Preview 只能成功 Confirm／Consume 一次 | 強化防重放，要求原子操作 |
| 9 | 重抽後，同 Session 的舊 Preview 立即 invalidated | 防止使用者保留多個 Preview 任選其一送出造成混淆／竄改風險 |
| 10 | Preview 與 Generate 都必須驗證 mascot 屬於使用者、Gift 已兌換且可用 | 回答初版「Preview 階段是否補強 mascotId/giftId 擁有權檢查？」→ **是** |
| 11 | 最終結果畫面保留顯示 luckyTheme／blessing／story／oneLiner／shopkeeperMessage | 回答初版「最終結果是否顯示店長內容？」→ **是** |
| 12 | 正式下載按鈕納入 P2-AI-04 | 回答初版「下載按鈕併入本次範圍？」→ **是** |
| 13 | Kuromi 占位圖片不納入，另案處理 | 維持初版排除範圍 |
| 14 | 不修改 P2-AI-02 Prompt Builder 核心 | 維持初版邊界 |
| 15 | 不修改 P2-AI-03 Shopkeeper Agent 核心 | 維持初版邊界 |

## v3 新增 Product Decision

| # | 決策 | 說明 |
|---|---|---|
| 16 | **Gift 已兌換後可重複用於桌布生成**；P2-AI-04 **不消耗、不修改** `redeem_history`；Preview／Confirm 只需驗證目前使用者至少存在一筆對應 Gift 的有效兌換紀錄；Gift 次數／庫存／一次性消耗**另立任務**，不在本次範圍 | 正式解答 v2 報告「尚存阻擋問題 #1」（Gift 兌換「可用性」語意未定義）——採用 v2 報告當時的暫定假設（存在即可用、不消耗）作為正式決策，不需要額外的消耗語意設計 |

詳見 [P2-AI-04-analysis-report.md](./P2-AI-04-analysis-report.md)（v3）第 16 節起的完整修訂：三階段 Preview 流程（reserve/generate/finalize）、並發安全的 advisory lock 設計、以 jobId 為冪等鍵的原子 Consume RPC、真實 Job Retry 能力盤點、過渡期部署與 legacy path 移除條件、完整 Response DTO 傳遞鏈、下載按鈕技術方案。另新增 [P2-AI-04-implementation-plan.md](./P2-AI-04-implementation-plan.md)（7 階段實作計畫）。

## 本次修訂對初版架構的關鍵影響

- 初版「方案 A：獨立 Function ＋ stateless 簽章 previewToken」的 **token 部分已被推翻**（決策 #2/#3）。新架構為「方案 A：獨立 Function ＋ **DB-backed** preview 紀錄」。
- 初版聲稱方案 A 對現有 `wallpaper-generate` **零風險** 的敘述**不準確**，已在分析報告第一節修正：Confirm 路徑仍需修改以支援 `previewId` 驗證與消費，只是修改範圍可被隔離、風險較低，並非零風險。
- 新增 mascot/gift 擁有權驗證（決策 #10）需要引用既有的 `user_mascots`（收藏關聯表）與 `redeem_history`（兌換紀錄表，`status` 欄位語意需與後端／產品確認，見分析報告第九節）。

詳細架構設計、Migration 草案、原子操作設計、API 契約、生成流程、UI 狀態機、測試與驗收標準，請見 [P2-AI-04-analysis-report.md](./P2-AI-04-analysis-report.md)（v2，本次修訂版）。


最後一項 Product Decision 我建議採用：

加入 client_request_id，避免瀏覽器網路重送導致重複 Preview、重複計次或多花 Gemini Text 額度。

規則：

前端每次使用者「明確點擊」產生／重抽時建立 UUID。
同一個網路請求重試沿用相同 UUID。
資料庫設定 UNIQUE(user_id, client_request_id)。
相同 ID、相同參數：回傳原 reservation，不重複計次。
相同 ID、不同參數：回傳 IDEMPOTENCY_CONFLICT。
已 ready：直接回傳既有內容，不再呼叫 Gemini。
pending：回傳 PREVIEW_REQUEST_IN_PROGRESS，不能再呼叫 Gemini。
failed：要求使用者重新點擊，建立新的 client_request_id。

這能補齊 v3 最後的網路重送漏洞。