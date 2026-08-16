請依 Product Review 修訂 P2-AI-04 Analysis Report，
目前仍是規格修訂階段，不得修改功能程式碼。

已確認 Product Decisions：

1. 採用獨立 shopkeeper-preview Edge Function。
2. 不採用純 Stateless previewToken。
3. 新增 DB-backed shopkeeper_previews 短效紀錄。
4. 前端只取得 opaque previewId。
5. 每個 Preview Session：
   - 首次產生 1 次
   - 最多再抽 2 次
   - 合計最多 3 次
6. 每位使用者每日最多 20 次 Preview。
7. Preview 有效期限為 10 分鐘。
8. 每個 Preview 只能成功 Confirm／Consume 一次。
9. 使用者重抽後，同 Session 的舊 Preview 立即 invalidated。
10. Preview 與 Generate 都必須驗證：
    - mascot 屬於目前使用者
    - Gift 已由目前使用者兌換且可使用
11. 最終結果畫面保留顯示：
    - luckyTheme
    - blessing
    - story
    - oneLiner
    - shopkeeperMessage
12. 正式下載按鈕納入 P2-AI-04。
13. Kuromi 占位圖片不納入，另案處理。
14. 不修改 P2-AI-02 Prompt Builder 核心。
15. 不修改 P2-AI-03 Shopkeeper Agent 核心。

一、修正原分析中的錯誤敘述

明確說明：

- Stateless HMAC token 無法自行做到一次性消費
- Stateless token 無法立即使舊 Preview 失效
- Stateless token 無法可靠執行每日／Session 次數限制
- 方案 A 仍會修改 wallpaper-generate 的 Confirm 路徑，
  因此不是零風險，只是風險較低且可隔離

二、設計 shopkeeper_previews 資料表

提出 migration 草案，至少包含：

- id uuid primary key
- user_id uuid not null
- session_id uuid not null
- mascot_id
- gift_id
- wallpaper_style
- context_snapshot jsonb
- shopkeeper_version
- source
- created_at
- expires_at
- consumed_at nullable
- invalidated_at nullable

同時設計：

- 必要 indexes
- RLS policies
- 不允許前端直接 INSERT／UPDATE context_snapshot
- Preview Function 使用可信後端寫入
- 使用者只能讀取必要且屬於自己的 Preview
- 過期資料清理策略
- Asia/Taipei 每日 20 次計算邊界

三、設計原子操作

必須避免兩個同時 Confirm 都成功。

提出資料庫 RPC 或等效原子更新：

- user_id 必須相符
- preview 未過期
- consumed_at IS NULL
- invalidated_at IS NULL
- selections 必須相符
- 成功時原子設定 consumed_at
- 只有一個請求能成功
- 其他請求回傳 PREVIEW_ALREADY_CONSUMED

設計重抽時原子 invalidation：

- 將相同 user_id + session_id 的舊 active previews
  設定 invalidated_at
- 檢查 session 總次數不得超過 3
- 檢查每日總次數不得超過 20
- 再建立新 Preview

四、修訂 API Contract

Preview Request：

首次：
{
  mascotId,
  giftId,
  wallpaperStyle
}

重抽：
{
  mascotId,
  giftId,
  wallpaperStyle,
  sessionId
}

Preview Response：

{
  previewId,
  sessionId,
  expiresAt,
  remainingRerolls,
  luckyTheme,
  blessing,
  story,
  oneLiner,
  shopkeeperMessage
}

Generate Request：

{
  mascotId,
  giftId,
  wallpaperStyle,
  previewId,
  promptType
}

禁止客戶端傳入：

- luckyTheme
- blessing
- story
- oneLiner
- shopkeeperMessage
- source
- shopkeeperVersion
- userId

五、修訂生成流程

確認生成時：

1. 驗證 JWT
2. 驗證 Mascot/Gift 所有權
3. 原子 consume preview
4. 從 DB context_snapshot 取得 Shopkeeper Context
5. 不重新呼叫 Shopkeeper Agent
6. 交給既有 Resolver／Validator／Prompt Builder
7. 呼叫 Gemini Image
8. 寫入 wallpaper_generations metadata
9. 回應中加入安全的 Shopkeeper 顯示 DTO
10. 若圖片生成失敗，分析 Preview 是否允許重新使用；
    提出明確策略與理由

特別處理一個重要問題：
若 consume 成功後 Gemini Image 失敗，
是否讓 Preview 恢復可用？

推薦方向：
不要直接把 consumed_at 清空；
建立 generationId／jobId 關聯並允許使用既有失敗重試機制，
避免同一 Preview 被任意重放。
請提出最安全的一致性設計。

六、修訂 UI State Machine

至少包含：

idle
selecting
previewLoading
previewReady
rerolling
generating
polling
succeeded
failed
previewExpired
previewLimitReached

並定義：

- 選項變更後現有 Preview 立即在前端失效
- 不自動呼叫 Preview
- loading 時按鈕 disabled
- 剩餘重抽次數顯示
- 每日上限錯誤訊息
- Preview 過期提示
- Confirm 防連點
- 正式下載按鈕
- 生成成功後保留祝福卡內容

七、修訂測試與驗收標準

新增測試：

- 使用者無法 Preview 不屬於自己的 Mascot
- 使用者無法使用未兌換 Gift
- 每 Session 第 4 次 Preview 被拒絕
- 每日第 21 次 Preview 被拒絕
- 重抽後舊 previewId 被拒絕
- 過期 previewId 被拒絕
- 竄改 selections 被拒絕
- 同時兩次 Confirm 只能成功一次
- 客戶端傳入 Shopkeeper 欄位被拒絕
- Preview 與最終 Snapshot 完全一致
- Confirm 不會再次呼叫 Gemini Text
- 下載按鈕可用
- 手機版 9:16 顯示正常
- 既有 207 項測試全部通過

八、輸出

更新：
docs/development/reports/P2-AI-04-analysis-report.md

另外產出：
docs/development/reports/P2-AI-04-product-decisions.md

最後回報：

- 修訂後推薦架構
- Migration／RLS／RPC 清單
- Preview 與 Confirm 契約
- 一致性與失敗恢復策略
- 修改檔案預估清單
- 測試清單
- 是否 READY FOR IMPLEMENTATION
- 尚存阻擋問題

完成後停止。
不要修改功能程式碼、不要 commit、不要 push、不要 deploy。