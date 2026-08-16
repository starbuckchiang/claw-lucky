# Tasks: AI Lucky Wallpaper Studio

**Input**: `specs/001-ai-lucky-wallpaper/plan.md`  
**Scope**: 僅產生任務，不實作程式碼  
**原則**: 每個任務可獨立完成、可獨立測試、可在單一 PR 完成
**路徑註記**: `Files to modify` 若為建議路徑，實作前需「依專案實際路徑確認」。

---

## Task 編號規則

- `P1-INF-*`：Phase 1 基礎設施
- `P1-BIZ-*`：Phase 1 業務功能
- `P2-INF-*`：Phase 2 基礎設施
- `P2-BIZ-*`：Phase 2 業務功能
- `P3-INF-*`：Phase 3 基礎設施
- `P3-BIZ-*`：Phase 3 業務功能
- `P4-INF-*`：Phase 4 基礎設施
- `P4-BIZ-*`：Phase 4 業務功能

---

## Phase 1：核心生成 MVP（Async Jobs / Idempotency / Prompt Registry 基礎）

### 基礎設施任務

### P1-INF-01 — 建立核心資料表 migration（generation / jobs / usage / cost / prompt）
- **Goal**: 建立 Phase 1 所需資料表與欄位，包含完整約束與索引。
- **Files to modify**:
  - `supabase/migrations/*_create_wallpaper_core_tables.sql`
  - `supabase/migrations/*_create_prompt_versions.sql`
  - `specs/001-ai-lucky-wallpaper/plan.md`（若需補註 migration 映射）
- **Database migration**:
  - create: `wallpaper_generations`, `wallpaper_generation_jobs`, `daily_generation_usage`, `generation_cost_config`, `prompt_versions`
  - constraints/indexes/checks 依 plan 定義（含 `expires_at > created_at`, `success_count >= 0`, `cost_points >= 0`）
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - migration up/down
  - schema 檢查（PK/FK/unique/check/index）
- **Dependencies**: 無
- **Parallel**: Yes
- **Acceptance criteria**:
  - migration 可在乾淨 DB 成功執行
  - 所有表與索引存在且名稱一致
  - 重要 check/unique constraint 可被測試驗證
- **User Story**: US1
- **Estimated Size**: M
- **Owner Role**: Database
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可執行的核心 SQL migration（含 core tables + prompt_versions）與可驗證的 constraints/indexes。
- **PR Guidance**:
  - Suggested title: `feat(db): add wallpaper core and prompt registry tables`
  - Merge with: none
  - Exclude: API、worker、frontend 實作
- **Acceptance Evidence**:
  - migration 執行成功輸出（up/down）
  - SQL schema 查詢結果（tables/indexes/constraints）
  - migration 測試報告截圖或 log

### P1-INF-02 — 建立 RLS 與 Storage policy（Phase 1 基線）
- **Goal**: 保障 generation/jobs/history 只能由 owner 讀取，敏感狀態不可由前端直改。
- **Files to modify**:
  - `supabase/migrations/*_rls_wallpaper_core.sql`
  - `supabase/migrations/*_storage_policies_wallpapers.sql`
- **Database migration**:
  - enable RLS on `wallpaper_generations`, `wallpaper_generation_jobs`, `daily_generation_usage`
  - owner read policy、限制更新 policy
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - owner/non-owner 存取測試
  - 禁止 client 將 status 更新為 `succeeded` 測試
- **Dependencies**: `P1-INF-01`
- **Parallel**: Partial — 可先撰寫 policy，但需等待 core tables migration 套用完成後驗證。
- **Acceptance criteria**:
  - 非 owner 讀取被拒絕
  - client 不能直接做成功狀態遷移
  - `wallpapers` bucket 非公開
- **User Story**: US1
- **Estimated Size**: M
- **Owner Role**: Security + Database
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可部署的 RLS 與 storage policy SQL（owner-only read、禁止客戶端狀態竄改）。
- **PR Guidance**:
  - Suggested title: `feat(security): add RLS and storage policies for wallpaper core`
  - Merge with: `P1-INF-01`（僅在 migration 尚未合併時）
  - Exclude: orchestrator、UI 與 provider adapter
- **Acceptance Evidence**:
  - owner / non-owner RLS 測試結果
  - storage bucket policy 驗證輸出
  - 嘗試 client 更新 `succeeded` 被拒絕的測試結果

### P1-INF-03 — 建立 Provider Adapter 抽象介面與錯誤正規化
- **Goal**: 建立 `generateLuckyContext`, `generateWallpaper`, `classifyRetryability`, `normalizeProviderError` 的統一邊界。
- **Files to modify**:
  - `js/api/*` 或 `js/services/ai/*`（依專案實際路徑）
  - `js/config/*`（provider 設定）
- **Database migration**: 無
- **API changes**: 無（內部服務層）
- **Frontend changes**: 無
- **Testing**:
  - adapter contract tests
  - provider error normalize 測試
- **Dependencies**: 無
- **Parallel**: Yes
- **Acceptance criteria**:
  - 業務層不再直接依賴 provider 原生錯誤格式
  - 介面輸出含 `model`, `duration`, `retryable`, `normalized failure code`
- **User Story**: US1
- **Estimated Size**: M
- **Owner Role**: AI + Backend
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 通過 contract test 的 Provider Adapter 介面與錯誤正規化模組。
- **PR Guidance**:
  - Suggested title: `feat(ai): add provider adapter interface and error normalization`
  - Merge with: none
  - Exclude: DB migration、API endpoint 與前端頁面
- **Acceptance Evidence**:
  - adapter contract test 報告
  - normalize 前後錯誤樣本比對

### P1-INF-04 — 實作 Prompt Registry 載入器（不再分散硬編碼）
- **Goal**: 從 `prompt_versions` 讀取 active 模板並提供版本回傳。
- **Files to modify**:
  - `js/services/prompt/*`
  - `js/api/*`
- **Database migration**: 無（使用 `P1-INF-01` 結果）
- **API changes**: 無（內部服務）
- **Frontend changes**: 無
- **Testing**:
  - active prompt 查詢測試
  - prompt_type 不存在/停用 fallback 測試
- **Dependencies**: `P1-INF-01`
- **Parallel**: Partial — 可先完成讀取器介面，但需待 generation request schema 穩定後再完成整合。
- **Acceptance criteria**:
  - 支援 `daily_lucky_context`、`wallpaper_generation`
  - generation 可保存實際使用 `prompt_version`
- **User Story**: US1
- **Estimated Size**: S
- **Owner Role**: AI
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可從 `prompt_versions` 載入 active 模板並回傳 `prompt_version` 的 prompt loader。
- **PR Guidance**:
  - Suggested title: `feat(ai): implement prompt registry loader`
  - Merge with: `P1-INF-01`（若需同時補 seed）
  - Exclude: worker 執行流程與 UI
- **Acceptance Evidence**:
  - prompt type 載入測試報告
  - `prompt_version` 寫入 generation 的驗證結果

### P1-INF-05 — 建立非同步 Job runner 與鎖定機制（技術中立）
- **Goal**: 建立 job claim/lock/retry 的執行器，避免同一 job 重複處理。
- **Files to modify**:
  - `js/services/jobs/*`
  - `js/config/*`
- **Database migration**: 無（使用 `wallpaper_generation_jobs` 欄位）
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - lock 競爭測試（`locked_at`, `locked_by`）
  - retry/next_retry_at 測試
- **Dependencies**: `P1-INF-01`
- **Parallel**: Partial — 可先完成 queue/lock 基礎，但最終需與 orchestrator job payload 對齊。
- **Acceptance criteria**:
  - job 狀態可在 `queued|processing|succeeded|failed|cancelled` 正確轉移
  - 同一 job 不會被雙 worker 同時成功 claim
- **User Story**: US1
- **Estimated Size**: L
- **Owner Role**: Backend + DevOps
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可部署的 async job runner（含 claim-lock-retry 與 job 狀態機）。
- **PR Guidance**:
  - Suggested title: `feat(backend): add async wallpaper job runner with locking`
  - Merge with: none
  - Exclude: frontend polling 與分享功能
- **Acceptance Evidence**:
  - 併發 claim 測試結果
  - retry/timeout 狀態轉移測試報告

### 業務功能任務

### P1-BIZ-01 — 實作 `POST /api/wallpapers/generations`（立即回傳 job）
- **Goal**: API 建立 generation + job 後立即回傳 `wallpaper_id`, `job_id`, `status`。
- **Files to modify**:
  - `js/api/*`
  - `js/services/wallpaper/*`
- **Database migration**: 無
- **API changes**:
  - add `POST /api/wallpapers/generations`
  - 支援 `Idempotency-Key`
- **Frontend changes**: 無
- **Testing**:
  - request validation
  - idempotency 重送測試
- **Dependencies**: `P1-INF-01`, `P1-INF-05`
- **Parallel**: Partial — 可先完成 request validation 與 idempotency，最終需對齊 orchestrator 回應欄位。
- **Acceptance criteria**:
  - API 不阻塞生圖流程
  - 重複 key 不重複建單
  - 回應包含必要欄位
- **User Story**: US1
- **Estimated Size**: M
- **Owner Role**: Backend
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可呼叫的 `POST /api/wallpapers/generations` endpoint（立即回傳 `wallpaper_id`, `job_id`, `status`）。
- **PR Guidance**:
  - Suggested title: `feat(api): add async wallpaper generation create endpoint`
  - Merge with: `P1-BIZ-04`（僅在 API contract 已穩定）
  - Exclude: worker 內部生成細節與 UI
- **Acceptance Evidence**:
  - API request/response 範例（含 idempotency 重送）
  - endpoint 整合測試報告

### P1-BIZ-02 — 實作 Generation Orchestrator（成功才扣點）
- **Goal**: 串接 usage 檢查、成本設定、成功後扣點與狀態一致性。
- **Files to modify**:
  - `js/services/wallpaper/orchestrator.*`
  - `js/services/points/*`
- **Database migration**:
  - 可選：`supabase/migrations/*_rpc_wallpaper_finalize_success.sql`（若採 security-definer RPC）
- **API changes**: 內部流程
- **Frontend changes**: 無
- **Testing**:
  - 成功扣點、失敗不扣點、重試最終失敗退款
  - 每日 3 次上限
- **Dependencies**: `P1-INF-01`, `P1-INF-02`, `P1-INF-05`
- **Parallel**: No
- **Acceptance criteria**:
  - 扣點、usage 更新、`succeeded` 狀態在同一交易邊界完成
  - 任一環節失敗不留下不一致狀態
- **User Story**: US1
- **Estimated Size**: L
- **Owner Role**: Backend + Database
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可重入且一致的 orchestrator 流程（成功扣點、失敗不扣點、usage 與狀態同步）。
- **PR Guidance**:
  - Suggested title: `feat(backend): implement generation orchestrator transaction flow`
  - Merge with: none
  - Exclude: 分享、歷史頁與 selfie
- **Acceptance Evidence**:
  - 交易一致性測試報告
  - 成功/失敗/重試退款案例測試輸出

### P1-BIZ-03 — 實作 Worker 生成流程（context + image + storage）
- **Goal**: Worker 非同步完成 Lucky context、圖片生成、寫入 storage、回寫狀態。
- **Files to modify**:
  - `js/services/jobs/worker.*`
  - `js/services/ai/*`
  - `js/services/storage/*`
- **Database migration**: 無
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - worker happy path
  - retry/timeout path
- **Dependencies**: `P1-INF-03`, `P1-INF-04`, `P1-INF-05`, `P1-BIZ-02`
- **Parallel**: Partial — 可先接通 provider/stub，但需等待 orchestrator finalize contract 才能完成上線整合。
- **Acceptance criteria**:
  - 成功生成後 `wallpaper_generations` 與 storage 路徑一致
  - 失敗/重試均可追蹤 `failure_code` 與 `attempt_no`
- **User Story**: US1
- **Estimated Size**: XL
- **Split Recommendation**: 拆為 (1) context+prompt 子流程、(2) image+storage 子流程、(3) retry/error handling 子流程。
- **Owner Role**: AI + Backend
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可運作的 generation worker（包含 context 生成、圖片生成、storage 寫入與失敗追蹤）。
- **PR Guidance**:
  - Suggested title: `feat(worker): implement async wallpaper generation pipeline`
  - Merge with: none
  - Exclude: 前端 polling UI 與分享功能
- **Acceptance Evidence**:
  - worker happy/timeout/retry 測試報告
  - storage 寫入與 DB 狀態一致性的驗證輸出

### P1-BIZ-04 — 實作狀態查詢 API（polling）
- **Goal**: 前端可用 polling 取得 generation/job 狀態。
- **Files to modify**:
  - `js/api/*`
  - `js/services/wallpaper/*`
- **Database migration**: 無
- **API changes**:
  - `GET /api/wallpapers/generations/{id}`
  - `GET /api/wallpapers/generations/{id}/progress`
- **Frontend changes**: 無
- **Testing**:
  - 不同 job 狀態回應測試
  - owner 權限測試
- **Dependencies**: `P1-BIZ-01`, `P1-BIZ-03`
- **Parallel**: Partial — 可先定義 API 介面，但需等待 worker status schema 穩定。
- **Acceptance criteria**:
  - 回應包含 status/progress 所需欄位
  - 非 owner 無法查詢
- **User Story**: US1
- **Estimated Size**: M
- **Owner Role**: Backend
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可呼叫的 generation/progress 查詢 API（owner-only）。
- **PR Guidance**:
  - Suggested title: `feat(api): add generation status and progress endpoints`
  - Merge with: `P1-BIZ-01`（若 API schema 尚未穩定）
  - Exclude: 前端等待畫面文案與分享
- **Acceptance Evidence**:
  - status/progress API response 範例
  - owner/non-owner 權限測試結果

### P1-BIZ-05 — 前端核心生成頁串接 async + polling
- **Goal**: 完成提交生成、輪詢狀態、成功下載入口、失敗重試入口。
- **Files to modify**:
  - `luck_complete.html` 或對應 wallpaper 頁面
  - `js/pages/*wallpaper*`
  - `js/ui/*`
- **Database migration**: 無
- **API changes**: 無（使用既有）
- **Frontend changes**:
  - submit 後輪詢
  - 顯示 `status`
- **Testing**:
  - 前端流程 E2E（submit→poll→result）
- **Dependencies**: `P1-BIZ-01`, `P1-BIZ-04`
- **Parallel**: Partial — 可先完成 UI 流程骨架，但需等待 progress response schema 定版。
- **Acceptance criteria**:
  - 使用者可完成非同步生成流程
  - 重複點擊不造成重複單（搭配 idempotency）
- **User Story**: US1
- **Estimated Size**: L
- **Owner Role**: Frontend
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可運作的 async 生成前端流程（submit → polling → result/retry）。
- **PR Guidance**:
  - Suggested title: `feat(frontend): integrate async wallpaper generation flow`
  - Merge with: none
  - Exclude: 後端交易邏輯與 DB migration
- **Acceptance Evidence**:
  - 前端 E2E 測試報告
  - submit/poll/result 介面截圖

### P1-BIZ-06 — 基本 Observability（生成鏈路）
- **Goal**: 生成流程記錄最小追蹤欄位與核心指標。
- **Files to modify**:
  - `js/services/logging/*`
  - `js/services/wallpaper/*`
- **Database migration**:
  - 可選：`supabase/migrations/*_logs_event_types_wallpaper.sql`
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - log field 完整性測試（`request_id`, `wallpaper_id`, `job_id`, `status`, `failure_code`）
- **Dependencies**: `P1-BIZ-03`
- **Parallel**: Yes
- **Acceptance criteria**:
  - 關鍵事件有結構化日誌
  - 不記錄敏感 prompt payload
- **User Story**: US1, Cross-cutting
- **Estimated Size**: M
- **Owner Role**: DevOps + Backend
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 具備最小欄位的結構化觀測事件（request/job/status/failure）與指標上報。
- **PR Guidance**:
  - Suggested title: `feat(obs): add baseline observability for generation pipeline`
  - Merge with: none
  - Exclude: UI 樣式修改與分享功能
- **Acceptance Evidence**:
  - 結構化 log 範例
  - metrics 輸出樣本（success/retry/timeout）

---

## Phase 2：歷史與資料生命週期（30 天/24 小時）

### 基礎設施任務

### P2-INF-01 — 建立 lifecycle / cleanup migration（狀態機與稽核欄位）
- **Goal**: 補強 `expired/deleted` 狀態轉移所需欄位與索引。
- **Files to modify**:
  - `supabase/migrations/*_lifecycle_schema_updates.sql`
- **Database migration**:
  - add lifecycle-related columns/indexes
  - 確保 `(status, expires_at)` 與 cleanup 查詢效率
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - migration 驗證與狀態轉移 constraint 驗證
- **Dependencies**: `P1-INF-01`
- **Parallel**: Partial — 可先設計狀態欄位，但需與 cleanup scheduler 的實作契約對齊。
- **Acceptance criteria**:
  - DB 可支持可重跑清理與對帳流程
- **User Story**: US2
- **Estimated Size**: S
- **Owner Role**: Database
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可執行的 lifecycle schema migration（含狀態與索引補強）。
- **PR Guidance**:
  - Suggested title: `feat(db): add lifecycle schema updates for wallpapers`
  - Merge with: none
  - Exclude: scheduler、API、frontend 變更
- **Acceptance Evidence**:
  - migration 執行輸出
  - schema/index 查詢結果

### P2-INF-02 — 實作 cleanup scheduler（idempotent + retry + batch）
- **Goal**: 建立可重跑清理 job，支持批次、重試、告警鉤子。
- **Files to modify**:
  - `js/services/scheduler/*`
  - `js/services/cleanup/*`
- **Database migration**: 無
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - 同批重跑不重複刪除
  - 部分失敗重試
- **Dependencies**: `P2-INF-01`
- **Parallel**: Partial — 可先完成 scheduler 框架，但最終需對齊 history/status 判定規則。
- **Acceptance criteria**:
  - 清理任務具 idempotency
  - 失敗不會誤標記 DB 為已完整刪除
- **User Story**: US2
- **Estimated Size**: L
- **Owner Role**: Backend + DevOps
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可部署的 cleanup scheduler（batch + retry + rerun + audit hook）。
- **PR Guidance**:
  - Suggested title: `feat(backend): implement lifecycle cleanup scheduler`
  - Merge with: none
  - Exclude: 歷史頁 UI 與分享功能
- **Acceptance Evidence**:
  - idempotent 重跑測試報告
  - 刪除失敗後狀態維持可重試的驗證結果

### P2-INF-03 — 實作 reconciliation job（DB vs Storage 對帳）
- **Goal**: 定期比對 DB 狀態與 storage 實檔並產生稽核結果。
- **Files to modify**:
  - `js/services/reconciliation/*`
- **Database migration**:
  - 可選：`supabase/migrations/*_reconciliation_audit_table.sql`
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - mismatch 偵測測試
  - 對帳修復流程測試
- **Dependencies**: `P2-INF-02`
- **Parallel**: Partial — 可先建立對帳流程，但需等待 signed URL/download 路徑穩定後補完整規則。
- **Acceptance criteria**:
  - 可輸出可追蹤 mismatch 記錄
  - 支援定期重跑
- **User Story**: US2
- **Estimated Size**: M
- **Owner Role**: Backend + DevOps
- **Priority**: Should
- **Status**: Not Started
- **Deliverable**: 可部署的 reconciliation job 與 mismatch 稽核輸出。
- **PR Guidance**:
  - Suggested title: `feat(ops): add reconciliation job for DB and storage consistency`
  - Merge with: none
  - Exclude: 前端頁面與 share API
- **Acceptance Evidence**:
  - mismatch 偵測測試輸出
  - reconciliation report 範例

### 業務功能任務

### P2-BIZ-01 — 實作歷史查詢 API（含 expired 狀態）
- **Goal**: 提供 history 列表，保留紀錄但標示是否可下載。
- **Files to modify**:
  - `js/api/*`
  - `js/services/history/*`
- **Database migration**: 無
- **API changes**:
  - `GET /api/wallpapers/history`
- **Frontend changes**: 無
- **Testing**:
  - history 分頁與 owner 權限
  - expired 顯示邏輯
- **Dependencies**: `P2-INF-01`
- **Parallel**: Partial — 可先完成查詢 API，但 expired 規則需與 cleanup 狀態機對齊。
- **Acceptance criteria**:
  - 30 天後仍可見紀錄但不可下載
- **User Story**: US2
- **Estimated Size**: M
- **Owner Role**: Backend
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可呼叫的 history API（含 expired 可視但不可下載狀態）。
- **PR Guidance**:
  - Suggested title: `feat(api): add wallpaper history endpoint with expired status`
  - Merge with: `P2-BIZ-02`（僅在同一 API contract 下）
  - Exclude: cleanup scheduler 與分享功能
- **Acceptance Evidence**:
  - API response 範例（available/expired）
  - owner 權限測試報告

### P2-BIZ-02 — 實作 signed download URL（短時效）
- **Goal**: 下載統一改為短時效 signed URL。
- **Files to modify**:
  - `js/api/*`
  - `js/services/storage/*`
- **Database migration**: 無
- **API changes**:
  - `GET /api/wallpapers/{id}/download-url`
- **Frontend changes**:
  - 歷史與結果頁改用下載 URL API
- **Testing**:
  - URL 過期測試
  - 非 owner 拒絕測試
- **Dependencies**: `P2-BIZ-01`
- **Parallel**: Partial — 可先完成 URL 簽發，但最終需與 storage policy 與 owner 檢查整合驗證。
- **Acceptance criteria**:
  - bucket 不公開仍可下載
  - URL 超時後不可使用
- **User Story**: US2
- **Estimated Size**: M
- **Owner Role**: Backend + Security
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可呼叫的短時效 signed download URL endpoint。
- **PR Guidance**:
  - Suggested title: `feat(api): add signed download url endpoint for wallpapers`
  - Merge with: `P2-BIZ-01`（若需同版 schema）
  - Exclude: 前端歷史頁重構與 scheduler
- **Acceptance Evidence**:
  - signed URL request/response 範例
  - URL 過期與非 owner 拒絕測試結果

### P2-BIZ-03 — 前端歷史頁（可下載 / 已到期）
- **Goal**: 完成 My Lucky Wallpapers 列表與狀態呈現。
- **Files to modify**:
  - `mascot-collection.html` 或 history 對應頁
  - `js/pages/*history*`
- **Database migration**: 無
- **API changes**: 無
- **Frontend changes**:
  - 顯示生成日期、狀態、下載按鈕可用性
- **Testing**:
  - UI/E2E 測試
- **Dependencies**: `P2-BIZ-01`, `P2-BIZ-02`
- **Parallel**: Partial — 可先開發 UI 元件，但需等待 history/download API response schema 定版。
- **Acceptance criteria**:
  - UI 能正確區分可下載與已到期
- **User Story**: US2
- **Estimated Size**: M
- **Owner Role**: Frontend
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可運作的歷史列表 UI（含狀態標示與下載互動）。
- **PR Guidance**:
  - Suggested title: `feat(frontend): build wallpaper history page with expired state`
  - Merge with: none
  - Exclude: cleanup scheduler 與 provider adapter
- **Acceptance Evidence**:
  - E2E 截圖或錄影（可下載/已到期）
  - 前端測試報告

### P2-BIZ-04 — Cleanup Observability 與告警
- **Goal**: 建立 cleanup 失敗率與對帳失敗率監控。
- **Files to modify**:
  - `js/services/logging/*`
  - `js/services/metrics/*`
- **Database migration**: 無
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - 指標上報測試
  - 告警觸發測試（模擬失敗）
- **Dependencies**: `P2-INF-02`, `P2-INF-03`
- **Parallel**: Yes
- **Acceptance criteria**:
  - 至少包含 expired cleanup failure rate 指標
  - 失敗可被告警系統捕捉
- **User Story**: Cross-cutting
- **Estimated Size**: M
- **Owner Role**: DevOps
- **Priority**: Should
- **Status**: Not Started
- **Deliverable**: cleanup observability 指標與告警規則（含 expired cleanup failure）。
- **PR Guidance**:
  - Suggested title: `feat(obs): add cleanup and reconciliation monitoring`
  - Merge with: none
  - Exclude: history UI 與 share API
- **Acceptance Evidence**:
  - metric 範例輸出
  - 告警觸發測試結果

---

## Phase 3：等待體驗、Conversation Service、分享

### 基礎設施任務

### P3-INF-01 — 擴充 Prompt Registry（progress message type）
- **Goal**: 支援 `generation_progress_message` 類型模板版本化。
- **Files to modify**:
  - `supabase/migrations/*_prompt_registry_progress_type.sql`
  - `js/services/prompt/*`
- **Database migration**:
  - seed/constraint for `generation_progress_message`
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - prompt type 查詢與版本切換測試
- **Dependencies**: `P1-INF-04`
- **Parallel**: Yes
- **Acceptance criteria**:
  - progress 訊息可由 registry 載入
- **User Story**: US1
- **Estimated Size**: S
- **Owner Role**: AI + Database
- **Priority**: Should
- **Status**: Not Started
- **Deliverable**: `generation_progress_message` 可版本化管理並可被服務層讀取。
- **PR Guidance**:
  - Suggested title: `feat(ai): add progress message prompt registry support`
  - Merge with: `P3-BIZ-01`（僅在同一模板契約下）
  - Exclude: share API 與前端 UI
- **Acceptance Evidence**:
  - prompt type 讀取測試結果
  - active version 查詢輸出

### P3-INF-02 — 建立分享事件資料表 migration
- **Goal**: 建立 `wallpaper_share_events` 與平台約束。
- **Files to modify**:
  - `supabase/migrations/*_create_wallpaper_share_events.sql`
- **Database migration**:
  - create table + `(wallpaper_id, created_at)` index + platform check
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - platform check constraint 測試
- **Dependencies**: `P1-INF-01`
- **Parallel**: Yes
- **Acceptance criteria**:
  - 僅允許指定平台值
  - 查詢索引可用
- **User Story**: US3
- **Estimated Size**: S
- **Owner Role**: Database
- **Priority**: Should
- **Status**: Not Started
- **Deliverable**: 可執行的 `wallpaper_share_events` migration（含 platform constraint 與索引）。
- **PR Guidance**:
  - Suggested title: `feat(db): add wallpaper share events table`
  - Merge with: none
  - Exclude: share UI 與 conversation service
- **Acceptance Evidence**:
  - migration 執行輸出
  - platform check constraint 驗證結果

### 業務功能任務

### P3-BIZ-01 — AI Shopkeeper Conversation Service（解耦）
- **Goal**: 依 progress stage + lucky context 產生等待訊息，不阻塞核心生圖。
- **Files to modify**:
  - `js/services/conversation/*`
  - `js/services/wallpaper/*`
- **Database migration**: 無
- **API changes**:
  - 可內部使用，不強制新增公開 API
- **Frontend changes**: 無
- **Testing**:
  - stage-to-message mapping 測試
  - service failure 不影響 generation 測試
- **Dependencies**: `P3-INF-01`, `P1-BIZ-03`
- **Parallel**: Partial — 可先建立服務介面與模板插值，但需待 progress API schema 穩定後完成整合。
- **Acceptance criteria**:
  - 支援 `preparing` 至 `failed` 全 stages
  - 訊息服務故障時生圖仍可完成
- **User Story**: US1
- **Estimated Size**: M
- **Owner Role**: AI + Backend
- **Priority**: Should
- **Status**: Not Started
- **Deliverable**: 解耦的 Conversation Service（stage message 生成且可失敗降級）。
- **PR Guidance**:
  - Suggested title: `feat(ai): add shopkeeper conversation service for generation stages`
  - Merge with: none
  - Exclude: share metadata API 與歷史頁改動
- **Acceptance Evidence**:
  - stage-to-message 測試報告
  - conversation failure 不影響 generation 的整合測試

### P3-BIZ-02 — 進度查詢與 polling 前端體驗（SSE 為可選優化）
- **Goal**: 前端顯示 AI 店長對話、progress、Lucky Theme、估時。
- **Files to modify**:
  - `js/pages/*wallpaper*`
  - `js/ui/*`
  - `luck_complete.html` 或對應頁
- **Database migration**: 無
- **API changes**:
  - `GET /api/wallpapers/generations/{id}/progress`（如尚未完整）
- **Frontend changes**:
  - polling 更新等待畫面
  - 友善錯誤與 retry 引導
- **Testing**:
  - UI 狀態切換測試
  - timeout/retry 文案流程測試
- **Dependencies**: `P1-BIZ-04`, `P3-BIZ-01`
- **Parallel**: Partial — 可先完成 polling 與畫面骨架，需等待 progress payload 與 conversation stage schema 定版。
- **Acceptance criteria**:
  - loading 畫面符合 AI generation experience 規格
  - 不依賴 SSE 即可完整運作
- **User Story**: US1
- **Estimated Size**: L
- **Owner Role**: Frontend + Backend
- **Priority**: Should
- **Status**: Not Started
- **Deliverable**: 可運作的 generation waiting experience（polling + progress + lucky theme + retry guidance）。
- **PR Guidance**:
  - Suggested title: `feat(frontend): implement generation waiting experience with polling`
  - Merge with: none
  - Exclude: share 平台串接與 selfie 功能
- **Acceptance Evidence**:
  - 等待畫面 E2E 截圖/錄影
  - timeout/retry 流程測試報告

### P3-BIZ-03 — 分享 API 與 metadata 組裝 + 平台降級策略
- **Goal**: 提供分享 metadata（日期/主題/祝福/吉祥物/禮物/風格）與平台降級。
- **Files to modify**:
  - `js/api/*`
  - `js/services/share/*`
- **Database migration**: 無（使用 `P3-INF-02`）
- **API changes**:
  - `POST /api/wallpapers/{id}/share`
  - `GET /api/wallpapers/{id}/share-metadata`
- **Frontend changes**:
  - 分享入口串接
- **Testing**:
  - metadata completeness 測試
  - 平台限制降級測試
- **Dependencies**: `P3-INF-02`
- **Parallel**: Partial — 可先完成 metadata schema 與 API，但最終需與前端分享導流格式對齊。
- **Acceptance criteria**:
  - 六個平台可導流
  - 平台不支援完整欄位時可按優先順序降級
- **User Story**: US3
- **Estimated Size**: M
- **Owner Role**: Backend
- **Priority**: Should
- **Status**: Not Started
- **Deliverable**: 可呼叫的 share API 與 share metadata endpoint（含平台降級策略）。
- **PR Guidance**:
  - Suggested title: `feat(api): add wallpaper share metadata and share endpoints`
  - Merge with: `P3-BIZ-04`（僅在前端改動很小時）
  - Exclude: conversation service 與 cleanup 任務
- **Acceptance Evidence**:
  - share API request/response 範例
  - 平台降級測試輸出

### P3-BIZ-04 — 分享入口前端實作
- **Goal**: 結果頁與歷史頁可一鍵分享並回報事件。
- **Files to modify**:
  - `js/pages/*wallpaper*`
  - `js/ui/*share*`
- **Database migration**: 無
- **API changes**: 無（使用既有分享 API）
- **Frontend changes**:
  - 多平台 UI
  - 失敗 fallback 提示
- **Testing**:
  - 前端 E2E 分享路徑
- **Dependencies**: `P3-BIZ-03`
- **Parallel**: Partial — 可先做 UI 元件，但需等待 share API payload 最終欄位。
- **Acceptance criteria**:
  - 分享按鈕觸發正確平台 payload
- **User Story**: US3
- **Estimated Size**: M
- **Owner Role**: Frontend
- **Priority**: Should
- **Status**: Not Started
- **Deliverable**: 可操作的多平台分享前端入口與錯誤 fallback 提示。
- **PR Guidance**:
  - Suggested title: `feat(frontend): add one-click share UI for wallpapers`
  - Merge with: none
  - Exclude: DB migration、conversation service
- **Acceptance Evidence**:
  - 多平台分享流程截圖
  - 前端 E2E 測試報告

### P3-BIZ-05 — Phase 3 Observability（progress/share）
- **Goal**: 補齊 progress 與 share 事件可觀測性。
- **Files to modify**:
  - `js/services/logging/*`
  - `js/services/metrics/*`
- **Database migration**: 無
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - progress stage 指標與 share event 指標測試
- **Dependencies**: `P3-BIZ-01`, `P3-BIZ-03`
- **Parallel**: Partial — 可先建立指標計算，但需等待 conversation/share 事件命名穩定。
- **Acceptance criteria**:
  - 可追蹤 retry rate、timeout rate、provider error rate
- **User Story**: US1, US3
- **Estimated Size**: M
- **Owner Role**: DevOps + Backend
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: progress/share 事件的觀測儀表欄位與指標上報管線。
- **PR Guidance**:
  - Suggested title: `feat(obs): add phase3 observability for progress and sharing`
  - Merge with: none
  - Exclude: 前端樣式與 DB 新表 migration
- **Acceptance Evidence**:
  - retry/timeout/provider error 指標樣本
  - 結構化事件 log 範例

---

## Phase 4：Selfie（私有儲存、加密、刪除 SLA、降級）

### 基礎設施任務

### P4-INF-01 — 建立 selfie_assets migration + 隱私索引
- **Goal**: 建立 `selfie_assets` 與隱私清理所需欄位/索引。
- **Files to modify**:
  - `supabase/migrations/*_create_selfie_assets.sql`
- **Database migration**:
  - create table + `(expires_at, deleted_at)` index + `expires_at > created_at` check
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - migration schema 測試
- **Dependencies**: `P1-INF-01`
- **Parallel**: Yes
- **Acceptance criteria**:
  - selfie metadata 結構與約束完整
- **User Story**: US1
- **Estimated Size**: S
- **Owner Role**: Database
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可執行的 `selfie_assets` migration（含隱私清理索引與 check）。
- **PR Guidance**:
  - Suggested title: `feat(db): add selfie assets table and constraints`
  - Merge with: none
  - Exclude: API upload 與 worker replaceFace
- **Acceptance Evidence**:
  - migration 執行輸出
  - schema/check/index 查詢結果

### P4-INF-02 — Selfie Storage policy（service-only access）
- **Goal**: `selfies-encrypted` bucket 私有化，僅 worker/service role 可讀。
- **Files to modify**:
  - `supabase/migrations/*_storage_policies_selfies.sql`
- **Database migration**:
  - storage policy SQL
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - client token 無法讀取 selfie file
  - service role 可讀寫測試
- **Dependencies**: `P4-INF-01`
- **Parallel**: Partial — 可先定義 policy，但需待 bucket 與 service role 權限配置完成才能驗證。
- **Acceptance criteria**:
  - 前端無法直接讀取自拍檔
  - bucket 非公開
- **User Story**: US1
- **Estimated Size**: M
- **Owner Role**: Security
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: `selfies-encrypted` service-only storage policy（前端不可直讀）。
- **PR Guidance**:
  - Suggested title: `feat(security): enforce service-only selfie storage access`
  - Merge with: none
  - Exclude: replaceFace 流程與前端上傳 UI
- **Acceptance Evidence**:
  - client token 存取被拒絕測試
  - service role 存取成功測試

### P4-INF-03 — Selfie cleanup scheduler + SLA 告警
- **Goal**: 24h 刪除、重試、告警與稽核紀錄。
- **Files to modify**:
  - `js/services/scheduler/*`
  - `js/services/cleanup/*`
  - `js/services/alerts/*`
- **Database migration**:
  - 可選：`supabase/migrations/*_selfie_cleanup_audit.sql`
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - 刪除失敗重試測試
  - SLA failure 告警測試
- **Dependencies**: `P4-INF-01`
- **Parallel**: Partial — 可先完成 cleanup 與 SLA 告警骨架，但需等待 replaceFace 路徑落地後補完整事件。
- **Acceptance criteria**:
  - 自拍到期可被可靠刪除
  - SLA 失敗可告警且有稽核紀錄
- **User Story**: US1
- **Estimated Size**: L
- **Owner Role**: Backend + DevOps
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可部署的 selfie cleanup scheduler（24h 刪除 + retry + SLA 告警）。
- **PR Guidance**:
  - Suggested title: `feat(ops): add selfie cleanup scheduler with SLA alerts`
  - Merge with: none
  - Exclude: 分享功能與歷史頁
- **Acceptance Evidence**:
  - cleanup 重試測試報告
  - SLA failure 告警觸發紀錄

### 業務功能任務

### P4-BIZ-01 — Selfie 上傳/驗證 API（JPG/PNG, <=10MB, 單人）
- **Goal**: 提供自拍上傳與驗證狀態 API。
- **Files to modify**:
  - `js/api/*`
  - `js/services/selfie/*`
- **Database migration**: 無
- **API changes**:
  - `POST /api/selfies/upload`
  - `GET /api/selfies/{id}/status`
  - `DELETE /api/selfies/{id}`
- **Frontend changes**: 無
- **Testing**:
  - 格式/大小/單人驗證測試
  - owner 權限測試
- **Dependencies**: `P4-INF-01`, `P4-INF-02`
- **Parallel**: Partial — 可先完成 API contract，但需等待 storage policy 驗證通過後整合上傳。
- **Acceptance criteria**:
  - 不合規檔案被拒絕且有明確錯誤碼
- **User Story**: US1
- **Estimated Size**: L
- **Owner Role**: Backend + Security
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可呼叫的 selfie upload/validate/status/delete API（含單人/格式/大小驗證）。
- **PR Guidance**:
  - Suggested title: `feat(api): add selfie upload and validation endpoints`
  - Merge with: none
  - Exclude: 前端 selfie UI 與 share API
- **Acceptance Evidence**:
  - API request/response 範例（合法與不合法）
  - owner 權限與驗證錯誤碼測試報告

### P4-BIZ-02 — Worker 整合 replaceFace + provider fallback/degradation
- **Goal**: 在有效 selfie 下啟用 replaceFace，失敗時安全降級為無自拍生成。
- **Files to modify**:
  - `js/services/jobs/worker.*`
  - `js/services/ai/*`
- **Database migration**: 無
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - replaceFace 成功/失敗降級測試
  - provider fallback flag 測試
- **Dependencies**: `P1-BIZ-03`, `P4-BIZ-01`
- **Parallel**: Partial — 可先接入 replaceFace stub，但需等待 selfie API 與 storage policy 穩定後完成真實整合。
- **Acceptance criteria**:
  - 自拍流程失敗不阻塞一般生圖
  - 日誌含 normalized failure code
- **User Story**: US1
- **Estimated Size**: XL
- **Split Recommendation**: 拆為 (1) replaceFace adapter 整合、(2) fallback/degradation 規則、(3) failure observability 與回歸測試。
- **Owner Role**: AI + Backend
- **Priority**: Should
- **Status**: Not Started
- **Deliverable**: replaceFace 整合與 provider fallback/degradation 可運作流程。
- **PR Guidance**:
  - Suggested title: `feat(worker): integrate replaceFace with fallback strategy`
  - Merge with: none
  - Exclude: 前端 selfie 上傳介面與非相關 migration
- **Acceptance Evidence**:
  - replaceFace 成功/失敗降級測試報告
  - normalized failure code log 範例

### P4-BIZ-03 — Selfie 前端上傳流程與提示
- **Goal**: 提供自拍上傳、驗證中、驗證失敗提示與非自拍降級選擇。
- **Files to modify**:
  - `js/pages/*wallpaper*`
  - `js/ui/*selfie*`
  - `*.html` 對應頁
- **Database migration**: 無
- **API changes**: 無
- **Frontend changes**:
  - selfie upload UI + status 顯示
- **Testing**:
  - 前端 E2E（上傳→驗證→生成）
- **Dependencies**: `P4-BIZ-01`
- **Parallel**: Partial — 可先實作 UI 與驗證提示，但需等待 upload/status API schema 穩定。
- **Acceptance criteria**:
  - 使用者可清楚知道自拍是否可用
  - 驗證失敗時可繼續無自拍生成
- **User Story**: US1
- **Estimated Size**: M
- **Owner Role**: Frontend
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 可運作的 selfie 上傳/狀態/降級前端流程。
- **PR Guidance**:
  - Suggested title: `feat(frontend): add selfie upload and validation UX`
  - Merge with: none
  - Exclude: worker replaceFace 邏輯與 DB policy
- **Acceptance Evidence**:
  - 自拍流程 E2E 截圖/錄影
  - 驗證失敗可降級流程測試結果

### P4-BIZ-04 — Privacy audit logs 脫敏與稽核
- **Goal**: 補強隱私稽核事件，確保不記錄自拍內容、完整 signed URL、敏感 prompt。
- **Files to modify**:
  - `js/services/logging/*`
  - `js/services/selfie/*`
- **Database migration**:
  - 可選：`supabase/migrations/*_privacy_audit_events.sql`
- **API changes**: 無
- **Frontend changes**: 無
- **Testing**:
  - log redaction 測試
  - privacy audit event 完整性測試
- **Dependencies**: `P4-INF-02`, `P4-INF-03`
- **Parallel**: Partial — 可先加脫敏規則，但需待 cleanup/alert 事件欄位穩定後完成最終稽核映射。
- **Acceptance criteria**:
  - 稽核日誌符合脫敏要求
  - 可追蹤 selfie deletion SLA failure rate
- **User Story**: US1
- **Estimated Size**: M
- **Owner Role**: Security + DevOps
- **Priority**: Must
- **Status**: Not Started
- **Deliverable**: 隱私稽核日誌規則（脫敏）與 selfie deletion SLA 指標上報。
- **PR Guidance**:
  - Suggested title: `feat(security): add privacy audit logging and selfie SLA metrics`
  - Merge with: none
  - Exclude: 新增產品功能 UI 與分享功能
- **Acceptance Evidence**:
  - log redaction 測試報告
  - selfie deletion SLA metric 範例

---

## 並行開發建議（跨 Phase）

- **可高並行（先做）**:
  - `P1-INF-01`, `P1-INF-03`
- **Phase 1 中並行**:
  - `P1-INF-02` 與 `P1-INF-04`
  - `P1-BIZ-04` 與 `P1-BIZ-05`
- **Phase 2 中並行**:
  - `P2-INF-02` 與 `P2-BIZ-01`
  - `P2-INF-03` 與 `P2-BIZ-02`
- **Phase 3 中並行**:
  - `P3-BIZ-01` 與 `P3-BIZ-02`
  - `P3-BIZ-03` 與 `P3-BIZ-04`
- **Phase 4 中並行**:
  - `P4-INF-02` 與 `P4-BIZ-01`
  - `P4-BIZ-02` 與 `P4-BIZ-03`

---

## 里程碑完成定義（DoD）

- 每個任務皆需：
  - 通過該任務列出的測試
  - 不破壞既有功能
  - 文件/設定更新完成
  - 可單獨合併為一個 PR

---

## Release Plan

### Sprint 1 — Database and Security Foundation

- **Tasks**: `P1-INF-01`, `P1-INF-02`, `P1-INF-04`
- **Sprint Goal**: 完成 core tables、RLS、Prompt Registry 基礎可驗收版本。
- **Dependencies**:
  - `P1-INF-01` 為 `P1-INF-02`、`P1-INF-04` 前置
- **Release Gate**:
  - migration 成功且 schema/constraints 可驗證
  - RLS owner/non-owner 測試通過
  - prompt active version 可讀取
- **Demo Scenario**:
  - 展示 DB schema
  - 展示未授權讀取被拒絕
  - 展示 prompt loader 讀取 active 模板

### Sprint 2 — Async Generation Backend

- **Tasks**: `P1-INF-03`, `P1-INF-05`, `P1-BIZ-01`, `P1-BIZ-02`
- **Sprint Goal**: 建立可用的非同步生成後端入口與交易一致性。
- **Dependencies**:
  - 需 Sprint 1 完成
  - `P1-INF-05` 先於 `P1-BIZ-01`
- **Release Gate**:
  - `POST /api/wallpapers/generations` 可立即回傳 `wallpaper_id/job_id/status`
  - `Idempotency-Key` 驗證通過
  - 成功才扣點與 usage 更新一致
- **Demo Scenario**:
  - 送出生成請求並立即取得 job
  - 重送相同 idempotency key 不重複建單

### Sprint 3 — Worker and Core Frontend MVP

- **Tasks**: `P1-BIZ-03`, `P1-BIZ-04`, `P1-BIZ-05`, `P1-BIZ-06`
- **Sprint Goal**: 打通 worker、polling API、核心前端流程與基本 observability。
- **Dependencies**:
  - 需 Sprint 2 完成
  - `P1-BIZ-03` 先於 `P1-BIZ-04`
- **Release Gate**:
  - worker 可完成生成/重試/timeout
  - 前端可完成 submit → polling → result
  - 基本指標與結構化 log 可查
- **Demo Scenario**:
  - 端到端生成一張可下載桌布
  - 模擬 timeout 並觀察 retry 與日誌

### Sprint 4 — History and Lifecycle

- **Tasks**: `P2-INF-01`, `P2-INF-02`, `P2-INF-03`, `P2-BIZ-01`, `P2-BIZ-02`, `P2-BIZ-03`, `P2-BIZ-04`
- **Sprint Goal**: 上線 history、signed URL、cleanup 與 reconciliation。
- **Dependencies**:
  - 需 Sprint 1-3 完成
  - `P2-INF-01` 先於 `P2-INF-02` / `P2-BIZ-01`
- **Release Gate**:
  - history 可顯示 available/expired
  - signed URL 短時效與 owner 限制通過
  - cleanup/reconciliation 有監控與告警
- **Demo Scenario**:
  - 展示歷史列表與已到期狀態
  - 展示 cleanup 任務與對帳報告

### Sprint 5 — Generation Experience and Sharing

- **Tasks**: `P3-INF-01`, `P3-INF-02`, `P3-BIZ-01`, `P3-BIZ-02`, `P3-BIZ-03`, `P3-BIZ-04`, `P3-BIZ-05`
- **Sprint Goal**: 上線等待體驗、分享 metadata/API/UI 與 phase 3 observability。
- **Dependencies**:
  - 需 Sprint 3 完成
  - `P3-INF-02` 先於 `P3-BIZ-03`
- **Release Gate**:
  - waiting experience 含 progress/lucky theme/retry guidance
  - share API 與前端多平台導流可用
  - US1/US3 相關指標可觀測
- **Demo Scenario**:
  - 生成中顯示 AI 店長訊息與進度
  - 成功後一鍵分享至指定平台

### Sprint 6 — Selfie Privacy Flow

- **Tasks**: `P4-INF-01`, `P4-INF-02`, `P4-INF-03`, `P4-BIZ-01`, `P4-BIZ-02`, `P4-BIZ-03`, `P4-BIZ-04`
- **Sprint Goal**: 上線 selfie 私有儲存、驗證、replaceFace、24h 刪除與隱私稽核。
- **Dependencies**:
  - 需 Sprint 3 完成（worker 管線）
  - `P4-INF-01` 先於 `P4-INF-02`、`P4-BIZ-01`
- **Release Gate**:
  - 自拍檔案僅 service 可讀
  - 上傳驗證與降級流程可用
  - 24h deletion 與 SLA 告警可用
- **Demo Scenario**:
  - 上傳自拍生成桌布
  - 模擬 replaceFace 失敗並降級成功
  - 展示刪除稽核紀錄

---

## MVP Release Definition

### Core MVP

Core MVP 至少需完成：

- 使用者選擇 mascot / gift / style
- 非同步生成
- 成功才扣點
- 每日 3 次上限
- PNG 下載
- RLS / Storage security
- Retry / Timeout
- 基本 observability

**Required Tasks (Core MVP)**:

- `P1-INF-01`, `P1-INF-02`, `P1-INF-03`, `P1-INF-04`, `P1-INF-05`
- `P1-BIZ-01`, `P1-BIZ-02`, `P1-BIZ-03`, `P1-BIZ-04`, `P1-BIZ-05`, `P1-BIZ-06`

### MVP Plus

Core MVP 穩定後建議加入：

- History
- 30 天重新下載
- AI Shopkeeper waiting experience
- Share

**Recommended Tasks (MVP Plus)**:

- `P2-INF-01` ~ `P2-BIZ-04`
- `P3-INF-01`, `P3-INF-02`, `P3-BIZ-01` ~ `P3-BIZ-05`

### Optional MVP Extension

- Selfie flow

**Product Spec Status**: Selfie is currently included in MVP  
**Delivery Recommendation**: Selfie may be released behind `wallpaper_selfie` feature flag after Core MVP stability is confirmed.

---

## Critical Path

### Core MVP 最短必要任務鏈

`P1-INF-01`  
→ `P1-INF-02`  
→ `P1-INF-04`  
→ `P1-INF-05`  
→ `P1-BIZ-01`  
→ `P1-BIZ-02`  
→ `P1-BIZ-03`  
→ `P1-BIZ-04`  
→ `P1-BIZ-05`  
→ `P1-BIZ-06`

### Blocking Tasks

- `P1-INF-01`（多數 DB / RLS / prompt 依賴）
- `P1-INF-05`（async job 基礎）
- `P1-BIZ-02`（交易一致性與扣點核心）
- `P1-BIZ-03`（worker 生圖主流程）

### Non-blocking Tasks

- `P2-BIZ-04`
- `P3-BIZ-04`
- `P4-BIZ-04`

### High-risk Tasks

- `P1-BIZ-03`（多供應商與重試流程）
- `P1-BIZ-02`（點數與狀態一致性）
- `P4-BIZ-02`（replaceFace + fallback）
- `P4-INF-03`（隱私刪除 SLA）

---

## Task Review Checklist

在每個 Task 開始實作前，確認：

- [ ] Spec 與 Plan 仍一致
- [ ] Dependencies 已完成
- [ ] Files to modify 路徑已確認存在
- [ ] API contract 已確認
- [ ] Database migration 命名已確定
- [ ] RLS / Security 影響已評估
- [ ] 測試方式可實際執行
- [ ] PR 範圍未超出 Task
- [ ] 無未核准需求被加入
