開始實作 P2-AI-04 Phase 1：
Migration + Preview State + Atomic RPC。

本次只實作 Phase 1。
禁止修改 wallpaper.html、CSS、前端狀態機、
shopkeeper-preview Edge Function、wallpaper-generate、
commit、push、db push 或 deploy。

先閱讀並遵守：

1. AI Constitution
2. P2-AI-04-analysis-report.md v3
3. P2-AI-04-product-decisions.md
4. P2-AI-04-implementation-plan.md
5. P2-AI-04-3-review.md
6. 現有 wallpaper core migrations
7. 現有資料表與 RPC 命名慣例
8. scripts/verify-local.ps1

新增 Product Decision #17：

採用 client_request_id 冪等控制。

- 每次使用者明確點擊產生／重抽建立 UUID
- 同一次網路重送沿用相同 UUID
- UNIQUE(user_id, client_request_id)
- 相同 ID＋相同參數：回傳原 reservation
- 相同 ID＋不同參數：IDEMPOTENCY_CONFLICT
- 原 reservation ready：回傳既有資料，不重複 Gemini
- pending：PREVIEW_REQUEST_IN_PROGRESS
- failed：不得用相同 ID 重新執行，需新 ID

將此決策補入 product-decisions 文件。

一、實作前 Schema 確認

先唯讀查詢實際遠端／本機 schema，確認：

- users 主鍵欄位與型別
- mascots 主鍵欄位與型別
- gifts 主鍵欄位與型別
- user_mascots 欄位與型別
- redeem_history 欄位與型別
- wallpaper_generation_jobs 主鍵與 user_id 型別
- service_role 是否存在於 pg_roles
- gen_random_uuid() 是否可用
- 現有 migration 最新編號

只回報 schema，不得修改遠端資料。

正式 migration 必須使用實際型別，不得用猜測的 UUID。
若不同環境型別可能不一致，沿用專案既有 migration 的
動態型別策略，但不得複製不完整的省略版 SQL。

二、新增 Migration

新增一份時間序正確的 migration：

create_shopkeeper_previews.sql

建立 shopkeeper_previews，至少包含：

- id
- user_id
- session_id
- client_request_id
- mascot_id
- gift_id
- wallpaper_style
- sequence_no
- status
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
- taipei_usage_date

狀態：

- pending
- ready
- failed
- consumed
- invalidated

加入：

- 必要外鍵
- UNIQUE(user_id, client_request_id)
- UNIQUE(user_id, session_id, sequence_no)
- Session 查詢索引
- 每日額度索引
- Active／ready Preview 索引
- expires_at 索引
- status 與欄位組合的 CHECK constraints
- sequence_no 只允許 0、1、2
- expires_at > created_at
- source 只允許 ai／fallback 或 NULL（依狀態）
- context_snapshot 只在 ready／consumed／invalidated 狀態存在
- pending／failed 不得存在可用 Context
- consumed 必須有 consumed_at 與 consumed_job_id
- invalidated 必須有 invalidated_at

確認「失效後仍保留 context_snapshot 供稽核」是否符合
CHECK constraint，不可因 invalidated 就清空內容。

三、RLS

- 啟用 RLS
- authenticated／anon 不得直接 SELECT、INSERT、UPDATE、DELETE
- 所有狀態轉換只能由 Edge Function 透過可信後端執行
- 不得把 context_snapshot 直接開放給前端查表
- RPC REVOKE FROM PUBLIC、anon、authenticated
- 只 GRANT EXECUTE TO 實際確認存在的 service_role
- SECURITY DEFINER 必須固定安全 search_path
- SQL 內所有表名使用 schema-qualified 名稱

四、Reserve RPC

建立 reserve_shopkeeper_preview。

輸入至少包含：

- userId
- mascotId
- giftId
- wallpaperStyle
- sessionId nullable
- clientRequestId
- TTL = 10 分鐘

行為：

1. 先依 userId + clientRequestId 查重
2. 已存在且參數相同：
   - pending → 回報 existing pending
   - ready → 回報 existing ready
   - failed → 回報 existing failed
   - 不增加每日／Session 次數
3. 已存在但參數不同：
   - IDEMPOTENCY_CONFLICT
4. 新請求才進入額度／Session 檢查
5. 使用穩定 advisory transaction locks：
   - userId + Asia/Taipei date
   - userId + sessionId
6. 每日最多 20 筆 reservation
7. 每 Session sequence_no 只能為 0、1、2
8. 建立 pending reservation
9. 此階段不得 invalidated 舊 ready Preview
10. 回傳：
    previewId、sessionId、sequenceNo、status、
    expiresAt、remainingRerolls、isExisting

鎖定順序必須固定，避免 deadlock。

對 MD5 衍生 advisory lock key：

- 說明轉換方式
- 碰撞最壞只允許造成不必要序列化，
  不得造成額度超發
- 不使用 session-dependent 或不穩定 hash
- 加入 SQL 測試／說明證據

五、Finalize RPC

建立 finalize_shopkeeper_preview。

輸入：

- previewId
- userId
- contextSnapshot
- shopkeeperVersion
- source

行為：

- pending → 驗證完整 Context → 改為 ready
- 同一交易內 invalidated 同 Session 其他舊 ready Preview
- 重複 finalize 相同內容 → 冪等回傳既有 ready
- 重複 finalize 不同內容 → FINALIZE_CONFLICT
- reservation 已 failed／consumed／invalidated → 拒絕
- 過期 pending → 標記 failed 或回傳明確錯誤
- finalize 失敗不得 invalidated 舊 ready Preview
- 不得信任前端；此 RPC 只供 service_role 呼叫

建立 mark_shopkeeper_preview_failed 或等效安全操作：

- 只允許 pending → failed
- 記錄安全 failure_code
- 不保存 raw provider error
- 不影響舊 ready Preview

六、Consume RPC

建立 consume_shopkeeper_preview。

輸入：

- previewId
- userId
- mascotId
- giftId
- wallpaperStyle
- jobId

行為：

- ready 且未消費：
  原子改為 consumed，綁定 consumed_job_id，
  回傳 context_snapshot
- 已被相同 jobId 消費：
  冪等回傳相同 context_snapshot
- 被不同 jobId 消費：
  PREVIEW_ALREADY_CONSUMED
- expired／invalidated／owner mismatch／selection mismatch：
  對 API 層只提供不洩漏資料存在性的安全結果
- 內部可記錄詳細 reason，但不得回傳敏感 Context
- 同時兩次不同 jobId Consume，只能一個成功

確認 consumed_job_id 外鍵型別與現有 Job 主鍵一致。

七、Repository Layer

新增 Node JS 與 Deno TS twins：

- shopkeeper-preview-repository.js
- shopkeeper-preview-repository.ts

封裝：

- reserve
- finalize
- markFailed
- consume

要求：

- Dependency Injection
- 正規化 RPC response
- 固定錯誤碼 mapping
- 不記錄 context_snapshot、完整 AI 內容或 secrets
- JS／TS 行為一致
- 本 Phase 不接入任何 Edge Function

八、測試

新增：

1. Table schema contract tests
2. CHECK constraint contract tests
3. RLS／GRANT contract tests
4. client_request_id 相同參數冪等
5. client_request_id 不同參數 conflict
6. pending 網路重送不重複計數
7. ready 網路重送不重新建立
8. 每日 count=19 兩個並發 reserve，只有一個可成為第 20 筆
9. Session count=2 兩個並發 reroll，只有一個成功
10. sequence_no 不可超過 2
11. finalize 成功後才 invalidated 舊 Preview
12. finalize 失敗保留舊 Preview
13. finalize 相同內容冪等
14. finalize 不同內容 conflict
15. 同一 Preview、不同 jobId 同時 consume，只成功一次
16. 同一 jobId consume 可冪等重試
17. 過期／失效 Preview 不可 consume
18. Repository JS／TS contract 一致
19. SQL syntax／migration safety
20. 既有 verify-local.ps1 全部回歸通過

重要：

若沒有真實 PostgreSQL 測試環境，
不得宣稱 advisory lock／並發測試已真正 PASS。

請分類：

- Static Contract PASS
- Mock Repository PASS
- Real PostgreSQL Integration PASS
- BLOCKED／尚待部署前驗證

不得以 mock 測試取代資料庫並發證據。

九、Migration 安全檢查

- 不執行 supabase db push
- 執行 migration list 與 db push --dry-run 僅限唯讀確認
- dry-run 必須只列本次 migration
- 不得套用到遠端
- 如果 Supabase CLI 的 dry-run 可能修改狀態，停止不執行
- 檢查 migration 可否安全重複部署
- 不修改既有資料表內容
- 提出 rollback SQL，但本次不執行

十、輸出報告

產出：

docs/development/reviews/P2-AI-04-Phase1-review.md

內容包括：

- 修改檔案清單
- 實際 Schema 型別
- Table／Index／Constraint
- RLS／GRANT
- Advisory lock 策略
- client_request_id 冪等證據
- Reserve／Finalize／Consume RPC
- Repository twins
- 測試總數與結果
- 真實 PostgreSQL 並發測試狀態
- dry-run 結果
- 尚未驗證項目
- Phase 1 Gate：
  PASS / CONDITIONAL PASS / FAIL
- 是否可以開始 Phase 2

完成後停止。

不要修改 UI、不要接入 Function、不要 commit、不要 push、
不要 db push、不要 deploy。