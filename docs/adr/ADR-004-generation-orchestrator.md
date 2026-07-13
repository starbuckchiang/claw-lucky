# ADR-004: Wallpaper Generation Orchestrator

Status

Accepted

Date

2026-07-13

Authors

claw-lucky Team

---

## Context

AI Lucky Wallpaper 的生成流程不只包含一次 AI 呼叫。

完整流程還需要處理：

- 使用者驗證
- 每日生成上限
- 生成成本
- Job 建立與狀態管理
- Wallpaper Generation Service 呼叫
- 成功後扣點
- 每日使用次數更新
- 失敗時不扣點
- 錯誤正規化

如果將這些邏輯全部放在 API、Worker 或 Generation Service 中，會造成：

- Business Logic 分散
- Transaction 邊界不清楚
- Job 狀態容易不一致
- 點數與 usage 更新可能不同步
- 測試與維護困難

因此需要一個獨立的 Orchestrator，統一協調整個生成交易流程。

---

## Decision

採用 Generation Orchestrator Pattern。

`generation-orchestrator` 作為 Business Transaction Coordinator，負責協調以下服務：

- `usageService`
- `jobService`
- `generationService`
- `pointsService`

Orchestrator 僅負責流程協調與狀態轉移，不直接處理：

- Prompt 組裝
- AI Provider SDK
- Supabase Query
- Storage 上傳
- Frontend
- Queue 或 Worker 執行環境

---

## Workflow

```text
Receive Request
    ↓
Validate User
    ↓
Check Daily Usage
    ↓
Create Generation Job
    ↓
Mark Job Running
    ↓
Call Generation Service
    ↓
Generation Failed?
    ├─ Yes → Mark Job Failed → Return Normalized Error
    └─ No
         ↓
Deduct Points
         ↓
Record Daily Usage Success
         ↓
Mark Job Success
         ↓
Return Normalized Success Response
Responsibilities
Generation Orchestrator

負責：

協調完整生成流程
控制服務呼叫順序
管理成功與失敗路徑
確保失敗時不扣點
回傳統一結果

不得：

直接組 Prompt
直接呼叫 AI Provider
直接執行 SQL
直接操作 Supabase Client
實作 Storage 邏輯
Usage Service

負責：

檢查每日生成次數
執行每日上限規則
成功後增加 usage count

預設每日上限：

3

超過上限時回傳：

DAILY_LIMIT_EXCEEDED
Job Service

負責 Job 狀態管理。

目前狀態：

Pending
Running
Success
Failed

對外提供：

create
markRunning
markSuccess
markFailed
Points Service

負責：

驗證使用者存在
取得當前生成成本
生成成功後扣點
扣點失敗時回傳正規化錯誤

原則：

Generation failure must never deduct points.

Repositories

以下 Repository 僅負責 persistence：

usage-repository
job-repository
points-repository

Repository 不得包含：

每日上限規則
扣點規則
Job workflow
Retry 規則
AI 邏輯
Error Model

Orchestrator 使用 normalized error，至少包含：

DAILY_LIMIT_EXCEEDED
JOB_CREATION_FAILURE
GENERATION_FAILURE
PERSISTENCE_FAILURE
POINTS_DEDUCTION_FAILURE

外部 Provider 原生錯誤不得直接傳到 Orchestrator 使用者端。

Transaction Boundary

目前 P1-BIZ-02 建立的是 Business Transaction Coordination。

真正的資料庫原子交易仍需由後續受控 Backend、Edge Function 或 SECURITY DEFINER RPC 完成。

特別是以下操作最終必須保持一致：

扣除 Lucky Points
增加 daily usage
將 generation 標記為 succeeded
將 job 標記為 success

在原子交易尚未完成前，不得假設多步驟 persistence 已具備完全一致性。

Consequences
Benefits
Business Flow 集中管理
Service 職責清楚
容易測試成功與失敗路徑
方便未來接入 Queue 與 Worker
點數與 usage 規則不會散落
API 與 Worker 可重用相同協調邏輯
Costs
初期檔案數增加
需要 Dependency Injection
需要明確維護狀態轉移
未來仍需補資料庫原子交易

這些成本可接受。

Alternatives Considered
API 直接協調所有流程

Rejected。

原因：

API Controller 會承擔過多 Business Logic
難以被 Worker 重用
測試困難
Generation Service 同時處理 Usage、Job 與 Points

Rejected。

原因：

Generation Service 會變成 God Object
責任不清楚
維護成本過高
Repository 直接執行 Business Rules

Rejected。

原因：

Persistence 與 Business Logic 耦合
不利於單元測試
規則難以重用
Deferred Improvements

以下改善不阻擋 MVP：

建立集中式 Job Status constants
加入 Domain Event：
WallpaperGenerationCreated
WallpaperGenerationSucceeded
WallpaperGenerationFailed
將點數、usage、generation status、job status 收斂到單一資料庫交易
接入 async queue / worker
加入 correlation ID 與完整 tracing
Related ADRs
ADR-001 Provider Adapter
ADR-002 Prompt Registry
ADR-003 Wallpaper Generation Service
Related Tasks
P1-BIZ-01
P1-BIZ-02
P1-INF-05
P1-BIZ-03
Related Reviews
docs/development/reviews/P1-BIZ-01.md
docs/development/reviews/P1-BIZ-02.md
Technical Debt

目前沿用：

TD-001 Prompt Version Datatype Mismatch

本 ADR 不新增新的 Technical Debt。

Final Decision

採用獨立的 Generation Orchestrator 作為 AI Lucky Wallpaper 生成流程的 Business Transaction Coordinator。

此決策立即生效，後續 API、Worker 與 Queue 實作必須沿用此協調邊界，不得將完整生成交易流程重新散落到 Controller、Repository 或 Provider Adapter。


這份 ADR 的重點是記錄「為什麼需要 Orchestrator、它負責什麼、哪些事情不能放進去」，而不是重複程式碼細節。