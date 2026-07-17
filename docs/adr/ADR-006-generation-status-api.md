# ADR-006: Generation Status and Progress API

Status

Accepted

Date

2026-07-15

Authors

claw-lucky Team

---

## Context

AI Lucky Wallpaper 採用非同步生成流程。

生成請求建立後，前端無法在同一個 HTTP request 中等待 AI 圖片完成，因此需要一組穩定的查詢介面，讓前端透過 polling 取得：

- Generation 狀態
- Job 狀態
- 生成進度
- 預估剩餘時間
- 成功結果
- 失敗資訊
- 是否應繼續 polling

如果前端直接讀取資料庫欄位，將造成：

- 前端與資料庫 schema 強耦合
- Job 與 Generation 狀態語意混亂
- Supabase 原始錯誤外洩
- 權限驗證散落在前端
- 未來修改資料表時破壞 API

因此需要建立統一的 Generation Status / Progress API Contract。

---

## Decision

採用獨立的只讀查詢架構：

```text
Frontend Polling
      ↓
Status Controller
      ↓
Generation Query Service
      ↓
Generation Query Repository
      ↓
Generation / Job Records
      ↓
Progress Response DTO

Controller 僅負責：

解析 request
取得 authenticated user context
呼叫 Query Service
將 normalized result 映射為 HTTP response

Controller 不得：

直接執行 SQL
直接操作 Supabase Query
修改 generation 或 job 狀態
呼叫 AI Provider
包含 polling business rules
API Endpoints

提供以下概念端點：

GET /api/wallpapers/generations/{id}
GET /api/wallpapers/generations/{id}/progress

目前實作保持 HTTP framework 中立，由 controller handler 對應未來實際 router。

Response Contract

成功回應至少包含：

generationId
jobId
status
progressPercent
progressStage
estimatedRemainingSeconds
provider
model
imageUrl
failureCode
failureMessage
createdAt
updatedAt
recommendedPollIntervalMs
terminal

尚未完成生成時，下列欄位允許為 null：

provider
model
imageUrl
failureCode
failureMessage

Frontend 不得依賴 Supabase 原始 row 格式。

Ownership and Authorization

使用者只能查詢自己的 generation 與 job。

Query Service 必須比對：

requesterUserId
        ↓
generation.userId

若沒有 authenticated user context，或 requester 不是 owner，必須回傳：

UNAUTHORIZED_GENERATION_ACCESS

前端不得使用 service role key。

Status API 為只讀介面，不提供任何狀態更新能力。

所有狀態遷移仍由受控 Backend、Worker、Edge Function 或受控 RPC 完成。

Status Mapping

Database status 不直接暴露給 Frontend。

Generation Status

支援：

pending
processing
succeeded
failed
expired
Job Status Mapping
queued      → pending
processing  → processing
succeeded   → succeeded
failed      → failed
cancelled   → failed

Job cancelled 對外視為 terminal failure，但可透過 failureCode 保留取消原因。

無法識別的狀態必須回傳：

INVALID_STATUS_RESPONSE

不得猜測或靜默轉換未知狀態。

Polling Contract

前端採 polling 作為 MVP 狀態更新方式。

建議 polling 規則：

pending
recommendedPollIntervalMs = 2500
terminal = false
processing
recommendedPollIntervalMs = 1500
terminal = false
succeeded
failed
expired
cancelled

recommendedPollIntervalMs = 0
terminal = true

Frontend 應以 API 回傳的 recommendedPollIntervalMs 為準，不應在多個前端檔案中自行硬編碼不同間隔。

SSE 或 WebSocket 不在本 ADR 的 MVP 範圍內。

Error Contract

所有錯誤必須正規化。

至少包含：

Error Code	HTTP Status
INVALID_GENERATION_ID	400
GENERATION_NOT_FOUND	404
UNAUTHORIZED_GENERATION_ACCESS	403
QUERY_FAILURE	503
INVALID_STATUS_RESPONSE	500

Supabase 原始錯誤、SQL 細節、內部 stack trace 不得傳回前端。

Layer Responsibilities
Status Controller

負責：

解析 generation ID
取得 requester identity
呼叫 Query Service
映射 HTTP status
回傳 DTO

不得包含資料查詢與狀態規則。

Generation Query Service

負責：

驗證 generation ID
ownership enforcement
status mapping
terminal 判斷
polling interval 計算
normalized error mapping
Generation Query Repository

僅負責：

查詢 generation
查詢相關 job
將 persistence row 轉為 repository result

不得包含：

authorization rule
polling rule
HTTP status
business status mapping
Progress Response DTO

負責穩定前端契約。

不得直接回傳資料庫 row 或 Provider 原始 response。

Consequences
Benefits
Frontend 不依賴資料庫 schema
Polling 規則集中管理
Ownership 驗證一致
API Contract 穩定
Supabase 錯誤不外洩
未來可替換 persistence layer
SSE 可在不破壞 DTO 的情況下加入
Costs
增加 Controller、Service、Repository、DTO 分層
需要維護 DB status 與 API status mapping
需維護 polling policy

接受此成本。

Alternatives Considered
Frontend 直接查詢 Supabase

Rejected。

原因：

前端與 schema 強耦合
權限規則容易散落
難以維護穩定 API Contract
在 Generation Orchestrator 中加入查詢功能

Rejected。

原因：

Orchestrator 負責 command workflow，不應同時處理 read model
容易混合狀態修改與只讀查詢
同一個 API 長連線等待生成完成

Rejected for MVP。

原因：

AI 生圖時間不穩定
容易造成 timeout
不利於 retry 與背景工作
立即採用 SSE 或 WebSocket

Deferred。

原因：

MVP 使用 polling 已足夠
可降低前端與基礎設施複雜度
未來可沿用相同 DTO Contract 擴充
Deferred Improvements

不阻擋 MVP：

建立集中式 status-policy.js
集中管理 terminal status
建立 progress stage registry
支援 SSE
加入 ETag 或 conditional polling
加入 correlation ID
增加 rate limiting
對 polling frequency 進行動態調整

<Related ADRs>
ADR-003 Wallpaper Generation Service
ADR-004 Wallpaper Generation Orchestrator
ADR-005 AI Generation Pipeline

<Related Tasks>
P1-BIZ-04
P1-BIZ-05
P3-BIZ-01
P3-BIZ-02

<Related Reviews>
docs/development/reviews/P1-BIZ-04.md

<Technical Debt>
本 ADR 不新增 Technical Debt。
目前仍追蹤：
TD-001 Prompt Version Datatype Mismatch
Final Decision

AI Lucky Wallpaper 採用獨立的 Generation Status and Progress API Contract。

前端只能透過穩定 DTO 查詢生成狀態，不得直接依賴資料庫 row、Job 原始狀態或 Supabase 錯誤。

MVP 使用 polling，並由 API 回傳 polling 間隔與 terminal 狀態。未來若加入 SSE 或 WebSocket，仍必須維持相同 ownership、status mapping、error normalization 與 DTO 邊界。