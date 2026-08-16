# 實作計畫：AI Lucky Wallpaper Studio

**Branch**: `[001-ai-lucky-wallpaper]` | **Date**: 2026-07-12 | **Spec**: `specs/001-ai-lucky-wallpaper/spec.md`

## Summary

本計畫以「可獨立部署、低耦合」為原則，分階段交付：

1. 核心生成能力（含點數扣除、每日上限、Retry/Timeout）
2. 歷史與保存週期（30 天圖片刪除、歷史保留）
3. 生成等待體驗與分享 metadata/平台串接
4. Selfie 流程（驗證、加密、生圖整合、24 小時刪除）

每個階段皆包含 Frontend、Backend、Database、AI Integration、API、Testing，且可獨立上線。

## Technical Context

- **前端**: 既有 HTML/CSS/JS 頁面架構（`*.html`, `js/*`）
- **後端/資料**: Supabase（Auth + Postgres + Storage + Row Level Security）
- **AI 整合**: 外部 AI 服務（文字生成/主題與圖片生成）；以可替換 Provider Adapter 實作
- **測試**: 前端流程測試、API 整合測試、資料庫約束與排程測試

## System Architecture

端到端元件鏈：

`Frontend → Wallpaper API → Generation Orchestrator → Job Queue → Generation Worker → Prompt Builder → Provider Adapters → External AI Providers → Supabase Storage → Wallpaper History`

### 元件責任

- **Frontend**
  - 僅呼叫 `Wallpaper API`，不得直接呼叫任何 External AI Provider。
  - 送出生成請求後改以 polling 查詢狀態。
- **Wallpaper API**
  - 驗證使用者身份、點數可用性、每日生成上限、請求格式。
  - 建立請求 idempotency 邊界，避免重複扣點與重複生成。
- **Generation Orchestrator**
  - 建立 `wallpaper_generations` 與 `wallpaper_generation_jobs` 記錄。
  - 將工作送入 Job Queue，回傳 `wallpaper_id`、`job_id`、`status`。
- **Job Queue**
  - 只負責工作排程與投遞，不綁定特定產品或雲服務。
- **Generation Worker**
  - 非同步執行 Lucky Context 與圖片生成。
  - 成功後寫入 Supabase Storage、更新 generation 狀態與 history。
  - 所有失敗、重試、timeout 與 provider 錯誤都必須可追蹤。
- **Prompt Builder**
  - 依固定模板與動態資料組裝 prompt。
  - 不允許 prompt 分散硬編碼於多個前端/API 檔案。
- **Provider Adapters**
  - 隔離外部供應商差異，統一回傳格式與錯誤語意。
- **External AI Providers**
  - 提供文字、圖片與（Phase 4）人像替換能力。
- **Supabase Storage**
  - 儲存桌布與自拍加密檔，並受 RLS/Storage policy 保護。
- **Wallpaper History**
  - 由 generation 記錄與 storage 狀態組合而成，保留歷史可追溯性。

### 純文字架構圖

```text
[Frontend]
    |
    v
[Wallpaper API] --(auth/points/daily limit/request validation)-->
    |
    v
[Generation Orchestrator] --create--> [wallpaper_generations]
    |                                  [wallpaper_generation_jobs]
    | enqueue
    v
[Job Queue] --> [Generation Worker] --> [Prompt Builder] --> [Provider Adapters] --> [External AI Providers]
                         |                        |                    |
                         |                        |                    v
                         |                        |             normalized result/error
                         |                        v
                         |                prompt_version bound
                         v
                 [Supabase Storage] --> [Wallpaper History]
                         |
                         v
               status/retry/failure tracking
```

## Constitution Check

- **Product Vision First**: 已對齊 `docs/product/vision.md`, `docs/product/product-principles.md`, `docs/product/architecture.md`
- **Brief-First Workflow**: 本計畫以完成之 spec 為唯一輸入
- **Clarify Before Assuming**: 規格中已完成主要歧義澄清
- **Language Policy**: 文件使用繁體中文；程式/Schema/API 命名使用英文
- **AI/Privacy**: 已納入內容安全、Selfie 24 小時刪除、圖片 30 天刪除

## 既有資源重用策略

優先重用既有 Supabase 資料來源，避免重複建模：

- `users`（身份、點數欄位）
- `collection`（吉祥物持有）
- `gifts`（已兌換禮物）
- `shop_products`, `shop_cart`, `orders`（商品與兌換脈絡）
- `logs`（行為與錯誤記錄）

## 新增資料表與 Schema 變更

### 新增資料表（明確）

1. `wallpaper_generations`
   - 用途：保存生成主記錄與 Wallpaper Metadata
   - 主要欄位：
     - `id (wallpaper_id)`, `user_id`, `mascot_id`, `gift_id`
     - `lucky_theme`, `blessing`, `wallpaper_style`
     - `ai_model`, `prompt_version`, `generation_seed`
     - `status` (`pending|processing|succeeded|failed|expired`)
     - `storage_path`, `created_at`, `expires_at`
     - `retry_count`, `failure_reason`

2. `wallpaper_generation_jobs`
   - 用途：生成流程工作狀態（進度、估時、timeout/retry）
   - 主要欄位：
     - `id`, `wallpaper_id`, `user_id`
     - `progress_percent`, `progress_stage`, `estimated_remaining_seconds`
     - `attempt_no`, `started_at`, `finished_at`, `last_error`

3. `daily_generation_usage`
   - 用途：每日成功生成次數控制（每日 3 次）
   - 主要欄位：
     - `user_id`, `usage_date`, `success_count`
   - 唯一鍵：`(user_id, usage_date)`

4. `generation_cost_config`
   - 用途：FR-015 成本可配置（預設 10 點）
   - 主要欄位：
     - `id`, `cost_points`, `effective_from`, `effective_to`, `is_active`

5. `wallpaper_share_events`
   - 用途：分享事件與 metadata 追蹤
   - 主要欄位：
     - `id`, `wallpaper_id`, `user_id`, `platform`
     - `shared_metadata_json`, `created_at`

6. `selfie_assets`
   - 用途：Selfie 上傳/驗證/加密/到期刪除
   - 主要欄位：
     - `id`, `user_id`, `wallpaper_id`
     - `storage_path_encrypted`, `mime_type`, `file_size`
     - `validation_status`, `expires_at`, `deleted_at`

7. `prompt_versions`
   - 用途：Prompt Registry（版本化模板）
   - 主要欄位：
     - `id`, `prompt_type`, `version`, `template`
     - `is_active`, `created_at`, `created_by`, `metadata_json`
   - `prompt_type` 至少支援：
     - `daily_lucky_context`
     - `wallpaper_generation`
     - `generation_progress_message`
   - 規則：
     - 每次 generation 必須保存實際使用的 `prompt_version`
     - 新版 prompt 啟用不得改寫既有 generation 歷史
     - 預留 A/B testing 擴充點（MVP 不實作完整實驗平台）

### 既有 Schema 變更（最小化）

- `logs`：新增 structured event type（不改既有語意）
  - `wallpaper_generation_started|succeeded|failed|expired`
  - `wallpaper_share_sent`
  - `selfie_uploaded|validated|deleted`
  - `job_retry_scheduled|job_lock_conflict|cleanup_reconciliation_mismatch`

## Database Integrity（補強）

### `wallpaper_generations`

- **Primary Key**: `id`
- **Foreign Key**: `user_id -> users.id`, `mascot_id -> collection.id`, `gift_id -> gifts.id`
- **Index**: `(user_id, created_at desc)`, `(status, expires_at)`
- **Check Constraint**: `expires_at > created_at`
- **Delete Behavior**: 預設 `RESTRICT`；需要隱私刪除時採 soft delete 或匿名化，不直接 cascade 清除歷史

### `wallpaper_generation_jobs`

- **Primary Key**: `id`
- **Foreign Key**: `wallpaper_id -> wallpaper_generations.id`
- **Unique Constraint**: `idempotency_key`（可搭配租戶範圍設計）
- **Index**: `(status, next_retry_at)`, `(wallpaper_id, attempt_no)`
- **必要欄位補強**:
  - `status`：`queued | processing | succeeded | failed | cancelled`
  - `next_retry_at`, `locked_at`, `locked_by`, `idempotency_key`, `created_at`, `updated_at`
- **Worker 併發保護**:
  - 以 `locked_at/locked_by` + 條件更新確保同一 job 不被重複處理
  - 以狀態轉移與 attempt 檢查避免重覆扣點/重覆完成

### `daily_generation_usage`

- **Primary Key / Unique**: `(user_id, usage_date)`（composite）
- **Check Constraint**: `success_count >= 0`
- **Delete Behavior**: 保留統計歷史，不 cascade

### `generation_cost_config`

- **Primary Key**: `id`
- **Check Constraint**: `cost_points >= 0`
- **Unique / Validity Rule**: 同一時間最多一筆有效設定（可用部分唯一索引或排他約束）
- **Delete Behavior**: 僅允許停用，不直接刪除生效歷史

### `wallpaper_share_events`

- **Primary Key**: `id`
- **Foreign Key**: `wallpaper_id -> wallpaper_generations.id`, `user_id -> users.id`
- **Index**: `(wallpaper_id, created_at)`
- **Check Constraint**: `platform` 使用受限枚舉或 check（LINE/Instagram/Threads/Facebook/X/Telegram）
- **Delete Behavior**: 保留稽核資料，預設 `RESTRICT`

### `selfie_assets`

- **Primary Key**: `id`
- **Foreign Key**: `user_id -> users.id`, `wallpaper_id -> wallpaper_generations.id`
- **Index**: `(expires_at, deleted_at)`
- **Check Constraint**: `expires_at > created_at`
- **Delete Behavior**: 內容檔案硬刪除；metadata 保留最小稽核欄位（匿名化）以符合法規與追蹤

### `prompt_versions`

- **Primary Key**: `id`
- **Unique Constraint**: `(prompt_type, version)`；同一 `prompt_type` 允許單一 active 版本
- **Index**: `(prompt_type, is_active)`, `(created_at desc)`
- **Delete Behavior**: 禁止刪除已被 generation 引用版本，僅允許停用

## 外部 AI 與圖片儲存需求

### 外部 AI 整合

1. **Text/Theme Provider**
   - 輸入：日期、吉祥物、禮物、上下文
   - 輸出：`lucky_theme`, `blessing`, `one_liner`

2. **Image Generation Provider**
   - 輸入：Prompt Strategy 輸入欄位 + 1080x1920 約束
   - 輸出：PNG 圖像

3. **Face Replacement Provider（Phase 4 啟用）**
   - 輸入：驗證通過之單人 Selfie + 吉祥物上下文
   - 輸出：替換後角色影像

> 以 Adapter 抽象層封裝，避免與特定廠商強耦合。

### 圖片儲存（Supabase Storage）

- Bucket `wallpapers`：生成結果 PNG
  - 保存 30 天；到期刪除檔案，保留 metadata/歷史狀態
- Bucket `selfies-encrypted`：Selfie 加密檔
  - 保存 24 小時；排程硬刪除
- 存取控制：RLS + signed URL（短時效）+ 僅擁有者可讀

## AI Shopkeeper Conversation Service

用途：

- 提供生成等待畫面的店長訊息。
- 依 Lucky Theme、mascot、gift 與 progress stage 顯示不同內容。
- 供未來 AI Shopkeeper Chat 共用模板能力。

### Progress Stages

- `preparing`
- `building_lucky_context`
- `composing_prompt`
- `generating_image`
- `saving_wallpaper`
- `completed`
- `retrying`
- `failed`

### 設計規則

- 等待訊息不得依賴每個階段都即時呼叫語言模型。
- MVP 優先採版本化訊息模板 + 動態欄位插值（低成本低延遲）。
- 僅在必要時由 Text Provider 產生額外內容。
- Conversation Service 與 Generation Orchestrator 解耦；對話失敗不得導致圖片生成失敗。

## Security and RLS Strategy

- 使用者僅可讀取自己的 `wallpaper_generations`、`wallpaper_generation_jobs`、history、`wallpaper_share_events`、`selfie_assets` metadata。
- 使用者不得直接把 generation 狀態更新為 `succeeded`。
- 點數扣除、`daily_generation_usage` 更新、狀態遷移僅允許受控 Backend、Edge Function 或 security-definer RPC 執行。
- `wallpapers` 與 `selfies-encrypted` bucket 皆為 private，不公開讀取。
- 下載一律以短時效 signed URL；時效不得超過必要期限。
- `selfies-encrypted` 讀取權限僅限 generation worker/service role。
- 前端不得取得 service role key。
- RLS policy 與 Storage policy 必須納入 Database 與 Testing 的交付範圍。
- 日誌不得保存自拍內容、完整 signed URL 或敏感 prompt payload。

## Data Lifecycle and Scheduler Reliability

- 30 天桌布清理與 24 小時自拍清理皆需具備：idempotent、可重跑、批次限制、失敗重試、稽核紀錄、DB/Storage 對帳。
- 明確狀態轉移：
  - wallpaper：`succeeded -> expired -> deleted(optional metadata-retained)`
  - selfie：`active -> expired -> deleted`
- 若 Storage 刪除失敗，DB 不得標記為完全刪除；應維持可重試狀態並記錄 failure code。
- 建立定期 reconciliation job，比對 DB 狀態與 Storage 實體檔案一致性。
- Selfie 刪除為高優先隱私任務，需具備失敗告警與 SLA 監控。

## Observability

每次生成請求至少需可追蹤下列欄位：

- `request_id`
- `wallpaper_id`
- `job_id`
- `user_id`
- `provider`
- `model`
- `prompt_version`
- `attempt_no`
- `duration_ms`
- `status`
- `failure_code`

最低監控指標：

- generation success rate
- p50 / p95 generation duration
- retry rate
- timeout rate
- provider error rate
- point transaction failure rate
- expired file cleanup failure rate
- selfie deletion SLA failure rate

日誌必須結構化，且不得記錄自拍內容與敏感使用者資料。

## Provider Adapter Interface

概念介面（不綁定程式語言）：

- `generateLuckyContext(input)`
- `generateWallpaper(input)`
- `replaceFace(input)`
- `classifyRetryability(error)`
- `normalizeProviderError(error)`

Adapter 統一輸出：

- provider request id
- model
- result
- duration
- retryable
- normalized failure code

業務層不得直接處理各供應商原生錯誤格式。

## 分階段實作（Independently Deployable Phases）

---

## Phase 1：核心生成 MVP

**目標**：可完成「選吉祥物/禮物/風格 → AI 生成 → 下載」核心閉環。

### Frontend
- 新增 Lucky Wallpaper Studio 核心頁與流程控制
- 顯示可用吉祥物/禮物來源（重用既有 collection/gifts）
- 生成按鈕前檢查點數與當日上限

### Backend
- 建立生成 orchestration service
- 成功後扣點（交易一致性）、失敗不扣點
- 實作 Retry（最多 3 次）與 Timeout（30 秒）
- 採非同步 job 架構：建立 generation + job 後即回應，不阻塞長時間生圖
- Worker 非同步執行生成；Queue/job runner 技術選型保持中立，不預設 Redis
- 扣點、usage 更新與 `succeeded` 狀態以 DB transaction 或 security-definer RPC 維持一致
- 支援 idempotency key，避免重複點擊造成重複生成/重複扣點

### Database
- 建立：`wallpaper_generations`, `wallpaper_generation_jobs`, `daily_generation_usage`, `generation_cost_config`
- 建立交易函式：扣點 + 生成成功寫入 + usage 計數
- 建立：`prompt_versions`（Prompt Registry 基礎）
- `wallpaper_generation_jobs` 補強欄位：`status`, `next_retry_at`, `locked_at`, `locked_by`, `idempotency_key`, `created_at`, `updated_at`
- 設計 worker lock 與狀態機，避免同一 job 被重複處理

### AI Integration
- 串接 Text/Theme Provider + Image Generation Provider
- 實作 Prompt 組裝器（含 Lucky Theme、安全限制）
- 導入 Provider Adapter 統一 provider 回應與錯誤

### API
- `POST /api/wallpapers/generations`
- `GET /api/wallpapers/generations/{id}`
- `POST /api/wallpapers/generations/{id}/retry`
- `GET /api/wallpapers/config`（取得當前成本）
- `POST /api/wallpapers/generations` 建立 generation + job 後立即回傳：`wallpaper_id`, `job_id`, `status`
- 透過 `Idempotency-Key`（header 或等價欄位）確保請求冪等

### Testing
- 單元：成本讀取、上限判斷、Retry/Timeout
- 整合：成功扣點、失敗退款、每日 3 次上限
- E2E：核心生成至下載流程
- Security：RLS policy 與 Storage policy 驗證（使用者不可越權更新成功狀態）
- Observability：基本追蹤欄位（`request_id`, `wallpaper_id`, `job_id`, `status`, `failure_code`）可觀測

### 風險與相依
- **相依**：外部 AI 可用性、users 點數欄位一致性
- **風險**：扣點與生成狀態不一致（以交易與冪等鍵避免）
- **部署邊界**：可獨立上線，不依賴分享與 Selfie

---

## Phase 2：歷史與保存週期

**目標**：完成歷史回看、重下載、到期不可下載但保留紀錄。

### Frontend
- 新增 My Lucky Wallpapers 歷史頁
- 顯示狀態（可下載/已到期）

### Backend
- 提供歷史查詢與重下載簽名 URL
- 到期檢查（資料狀態 + 檔案存在）
- lifecycle scheduler（30 天/24 小時）支援批次清理、失敗重試、可重跑
- reconciliation job 定期對帳 DB 狀態與 Storage 實檔

### Database
- 擴充 `wallpaper_generations.status` 與 `expires_at` 使用規則
- 加入排程任務：30 天到期更新 `expired` 並刪除檔案
- 明確 `expired/deleted` 狀態轉移；Storage 刪除失敗時不得誤標記為已刪除

### AI Integration
- 無新增供應商；沿用 Phase 1

### API
- `GET /api/wallpapers/history`
- `GET /api/wallpapers/{id}/download-url`
- signed download URL 採短時效，並依 owner 權限簽發

### Testing
- 排程測試：30 天到期刪檔與狀態更新
- API 測試：到期前可下載、到期後不可下載
- UI 測試：歷史列表與狀態顯示
- cleanup observability：過期清理失敗率與對帳差異監控

### 風險與相依
- **相依**：Storage 生命周期任務穩定性
- **風險**：資料狀態與實體檔案不同步（加強對帳 job）
- **部署邊界**：可獨立上線，不依賴分享/Selfie

---

## Phase 3：生成體驗與分享能力

**目標**：提升等待體驗並上線多平台分享與 metadata。

### Frontend
- 生成中顯示 AI 店長對話、進度、Lucky Theme、預估剩餘時間
- 失敗顯示友善重試引導
- 一鍵分享入口（LINE/Instagram/Threads/Facebook/X/Telegram）
- polling 為預設狀態更新機制；SSE 僅列為後續優化選項

### Backend
- 進度事件回傳（polling 或 SSE）
- 分享 payload 組裝與平台導流
- 新增 Conversation Service（模板插值優先，必要時才呼叫 Text Provider）
- 平台能力不足時啟用 metadata 欄位降級策略

### Database
- 建立：`wallpaper_share_events`
- `wallpaper_generations` 補齊 metadata 欄位覆核（ai_model/prompt_version/seed）
- `prompt_versions` 支援 `generation_progress_message` 類型模板

### AI Integration
- 對話文案模板與生成進度 stage mapping
- 無新增核心生圖供應商
- progress stage 標準化：`preparing|building_lucky_context|composing_prompt|generating_image|saving_wallpaper|completed|retrying|failed`

### API
- `GET /api/wallpapers/generations/{id}/progress`
- `POST /api/wallpapers/{id}/share`
- `GET /api/wallpapers/{id}/share-metadata`

### Testing
- UI：等待體驗元素完整性
- API：分享 metadata 欄位完整性
- 整合：各平台分享導流可用性

### 風險與相依
- **相依**：各社群平台分享能力限制
- **風險**：平台間 metadata 支援差異（定義欄位優先級）
- **部署邊界**：可獨立上線，不依賴 Selfie

---

## Phase 4：Selfie 生圖流程

**目標**：上線 Selfie（單人驗證、加密儲存、生圖整合、24h 刪除）。

### Frontend
- Selfie 上傳元件（JPG/PNG、10MB）
- 顯示驗證結果與錯誤引導

### Backend
- 驗證管線：格式/大小/單人檢測
- 加密上傳與到期刪除排程
- 生成時引用有效 Selfie 資產
- Selfie 僅允許 service-only access，前端不直接讀取私有檔案
- provider fallback/degradation：人像替換失敗時安全降級為無自拍生成

### Database
- 建立：`selfie_assets`
- 排程：24 小時刪除，寫入 `deleted_at`
- 追加隱私稽核紀錄（不含敏感內容）與刪除 SLA 狀態

### AI Integration
- 串接 Face Replacement Provider
- 驗證未通過或過期時，自動降級為無 Selfie 生成
- 保持 provider 可替換，不綁定單一廠商

### API
- `POST /api/selfies/upload`
- `GET /api/selfies/{id}/status`
- `DELETE /api/selfies/{id}`（手動刪除）

### Testing
- 安全：加密與權限
- 功能：單人檢測/格式與大小限制
- 生命周期：24 小時自動刪除驗證
- 隱私：deletion SLA 與失敗告警驗證
- 稽核：privacy audit logs 內容脫敏檢查

### 風險與相依
- **相依**：人像檢測與臉部替換供應商品質
- **風險**：誤判導致可用性下降（需可觀測性與人工校正策略）
- **部署邊界**：最後獨立上線，不影響無 Selfie 主流程

## 跨階段相依與去耦策略

- 以 Feature Flag 控制：`wallpaper_core`, `wallpaper_history`, `wallpaper_share`, `wallpaper_selfie`
- 補強 Feature Flag：`wallpaper_async_jobs`, `wallpaper_provider_fallback`, `wallpaper_prompt_registry`
- API 向後相容：新增欄位不破壞既有回應
- 事件與排程獨立：到期清理、對帳 job、分享事件寫入分離
- Provider Adapter：AI 供應商替換不影響業務流程

## Feature Flags（補強）

- `wallpaper_async_jobs`
  - 預設值：`on`
  - 影響範圍：`POST /api/wallpapers/generations` 非同步回應模式、job/polling 流程
  - 關閉降級：暫停新生成入口或回退至受控同步備援（僅限內部維運）
- `wallpaper_provider_fallback`
  - 預設值：`off`（MVP）
  - 影響範圍：主 provider 失敗時是否啟用次要 provider
  - 關閉降級：只使用主 provider，失敗走既有 retry/failure 流程
- `wallpaper_prompt_registry`
  - 預設值：`on`
  - 影響範圍：Prompt Builder 是否從 `prompt_versions` 載入模板
  - 關閉降級：使用內建單一安全預設模板（集中於後端單點，不分散硬編碼）

## Architecture Decisions Pending

| 決策項目 | 決策時點 | 評估標準 | 受影響 Phase |
|---|---|---|---|
| Worker 執行環境 | Phase 1 開發前 | 併發能力、成本、可觀測性、維運複雜度 | Phase 1-4 |
| Queue / job runner 技術 | Phase 1 開發前 | at-least-once 行為、延遲、鎖定能力、可重試模型 | Phase 1-3 |
| Text Provider | Phase 1 開發前 | 品質、延遲、成本、內容安全能力 | Phase 1,3 |
| Image Provider | Phase 1 開發前 | 圖像品質、穩定性、成本、速率限制 | Phase 1-3 |
| Face Replacement Provider | Phase 4 開發前 | 單人辨識品質、隱私條款、失敗率 | Phase 4 |
| Scheduler 實作方式 | Phase 2 開發前 | idempotency、重跑能力、監控整合、操作簡單性 | Phase 2,4 |
| Encryption key management | Phase 4 開發前 | 金鑰輪替、存取控制、稽核可追溯性 | Phase 4 |
| Polling vs SSE 最終方案 | Phase 3 上線前 | 前端複雜度、即時性需求、連線成本 | Phase 3 |

## 主要實作風險總覽

1. **AI 穩定性風險**：以 Retry/Timeout/友善重試與供應商抽換降低風險
2. **交易一致性風險（扣點）**：以 DB 交易與冪等鍵確保「成功才扣點」
3. **儲存生命周期風險**：以排程 + 對帳機制確保 30 天/24 小時刪除規則
4. **第三方分享差異風險**：統一 metadata schema + 平台降級策略
