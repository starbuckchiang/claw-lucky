請實作 Task：P2-AI-02

Task Name：

Real Gemini End-to-End Integration

本次目標：

將已通過真實測試的 GeminiProvider，
接入 wallpaper.html 的完整產品流程。

必須完成：

wallpaper.html
→ Generation Client
→ Server-side Generation Endpoint
→ Generation Orchestrator
→ Generation Service
→ ProviderFactory
→ GeminiProvider
→ Gemini API
→ Supabase Storage
→ Generation Status API
→ Client Polling
→ Wallpaper Preview

不得讓瀏覽器直接呼叫 Gemini。

==================================================
開始前檢查
==================================================

請先閱讀：

- specs/001-ai-lucky-wallpaper/spec.md
- specs/001-ai-lucky-wallpaper/tasks.md
- docs/development/context.md

以及：

- ADR-004 Generation Orchestrator
- ADR-005 AI Generation Pipeline
- ADR-006 Generation Status API
- ADR-007 Client Generation Workflow
- ADR-008 Observability and Tracing
- P2-AI-01 Review
- P2-UI-01 Review
- P2-UI-02 Review

並檢查目前實際存在的：

- Supabase Edge Functions 結構
- Supabase client 初始化方式
- wallpaper_generations schema
- wallpaper_generation_jobs schema
- Storage bucket 與 policies
- Generation Client API contract
- Status / Progress API controller
- ProviderFactory
- GeminiProvider
- Generation Service
- Generation Orchestrator

不得假設不存在的檔案或函式名稱。

==================================================
重要架構限制
==================================================

GitHub Pages 是靜態網站。

因此：

GEMINI_API_KEY
只能存在於：

Supabase Edge Function Secrets
或其他 server-side environment。

不得：

- 寫入 wallpaper.html
- 寫入前端 JavaScript
- 寫入 config.js
- 透過 API response 回傳
- Commit 到 Git
- 寫入瀏覽器 localStorage

前端不得直接：

new GoogleGenAI()

前端不得 import：

@google/genai

只有 server-side GeminiProvider 可以知道 Gemini SDK。

==================================================
Scope
==================================================

本 Task 要完成：

1. Server-side Generation Endpoint
2. 真實 GeminiProvider 注入
3. 真實圖片生成
4. 圖片上傳 Supabase Storage
5. 更新 generation/job 狀態
6. Status API 回傳可預覽圖片 URL
7. wallpaper.html submit → polling → preview
8. Correlation ID 全流程傳遞
9. 真實 E2E Manual Test 文件

本 Task不包含：

- Face Swap
- Selfie Upload
- 分享功能
- 歷史頁
- 多 Provider 自動切換
- Queue 系統重構
- WebSocket / SSE
- 付費金流

==================================================
1. Server-side Generation Endpoint
==================================================

建立或完成 Supabase Edge Function。

建議概念路徑：

supabase/functions/wallpaper-generate/

此 Function 必須：

1. 處理 CORS
2. 驗證 authenticated user
3. 解析 request
4. 驗證 mascotId / giftId / style / blessing
5. 建立 correlationId
6. 呼叫 Generation Orchestrator
7. 透過 ProviderFactory 建立 GeminiProvider
8. 不得直接在 handler 裡呼叫 GoogleGenAI
9. 回傳 normalized DTO

POST request 至少包含：

- mascotId
- giftId
- wallpaperStyle
- luckyTheme
- blessing
- promptType

不得接受 client 傳入：

- provider API key
- service role key
- arbitrary prompt template
- arbitrary storage path
- userId 冒用值

userId 必須由 authentication context 取得。

==================================================
2. Gemini Provider Wiring
==================================================

Server-side dependency wiring 必須固定為：

Generation Orchestrator
→ Generation Service
→ Provider Adapter
→ ProviderFactory
→ GeminiProvider
→ GoogleGenAI

不得重新建立另一套 Gemini 呼叫程式。

必須重用：

- js/services/ai/provider-factory.js
- js/services/ai/gemini-provider.js
- js/services/ai/provider-adapter.js

若 Edge Function 的 Deno runtime 無法直接載入目前 CommonJS 模組：

不得把整個專案任意改成 ESM。

請建立明確的 server adapter / runtime boundary，
並在 Review Package 說明：

- 哪些核心邏輯共用
- 哪些程式因 Edge Runtime 需要薄包裝
- 為什麼沒有複製 Business Rules

不得在 Edge Function 中複製完整 Orchestrator 邏輯。

==================================================
3. Environment / Secrets
==================================================

Server-side 至少使用：

- AI_PROVIDER=gemini
- AI_PROVIDER_MODEL=gemini-2.5-flash-image
- AI_PROVIDER_TIMEOUT_MS
- AI_PROVIDER_MAX_RETRY
- GEMINI_API_KEY
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

規則：

- GEMINI_API_KEY 只供 Edge Function 使用
- SERVICE_ROLE_KEY 只供受控 server persistence 使用
- Logger 不得輸出任何 secret
- 建立或更新 .env.example，但不得放真實值
- 不修改或提交 .env

==================================================
4. Storage Integration
==================================================

Gemini 回傳 image base64 後：

1. 轉成 binary
2. 上傳既有 private wallpaper bucket
3. 路徑必須由 server 建立

建議路徑：

{userId}/{generationId}/wallpaper.png

Client 不得指定完整 storage path。

上傳成功後保存：

- storage_bucket
- storage_path
- mime_type
- file_size（若 schema 支援）
- provider
- model
- promptVersion
- durationMs

不得將完整 base64：

- 寫入 database
- 寫入 log
- 回傳至 status API
- 長期保存於 metadata_json

==================================================
5. Generation / Job State
==================================================

流程至少遵守：

Create Generation
→ pending

Create Job
→ queued / pending

Provider Start
→ generation processing
→ job processing

Gemini Success
→ upload storage

Storage Success
→ generation succeeded
→ job succeeded

任一步失敗：

→ generation failed
→ job failed
→ failureCode / failureMessage
→ 不扣點或依既有 Orchestrator 規則處理

不得出現：

Gemini 成功但 Storage 失敗，
最後仍回 succeeded。

==================================================
6. Status / Progress API
==================================================

建立或部署 server-side status function：

概念路徑：

supabase/functions/wallpaper-status/

至少支援：

GET generation status
GET generation progress

只允許 owner 查詢。

成功完成後回傳：

- generationId
- jobId
- status
- progressStage
- progressPercent
- terminal
- recommendedPollIntervalMs
- imageUrl
- provider
- model
- failureCode
- failureMessage
- createdAt
- updatedAt

imageUrl 必須是：

- 有效的 signed URL
或
- 受控可讀 URL

不得回傳 service role credentials。

terminal state：

- succeeded
- failed
- expired
- cancelled

terminal=true 時：

recommendedPollIntervalMs=0

==================================================
7. Frontend Wiring
==================================================

修改 wallpaper.html 對應前端模組。

必須重用：

- wallpaper-generation-client
- wallpaper-polling-service
- wallpaper-result-presenter

不要在 wallpaper.js 重新實作 polling。

前端流程：

選擇 Mascot
→ 選擇 Gift
→ Generate
→ POST Edge Function
→ generationId
→ Poll Status Function
→ terminal
→ 顯示圖片

成功時：

- 顯示生成圖片
- 顯示成功訊息
- 停止 polling
- 恢復 Generate 按鈕

失敗時：

- 顯示一般使用者可理解訊息
- 不顯示 SDK stack
- 不顯示 raw Supabase error
- 停止 polling
- 恢復 Generate 按鈕

Debug 資訊：

- provider
- model
- correlationId
- generationId

只能放在 developer/debug 區塊，
一般使用者介面預設隱藏。

==================================================
8. Correlation ID
==================================================

同一次生成必須沿用同一個 correlationId：

Frontend request
→ Edge Function
→ Orchestrator
→ Generation Service
→ GeminiProvider
→ Storage
→ Status API logs

API response header 建議加入：

X-Correlation-Id

Normalized error 也必須保留 correlationId。

不得依每一層重新產生不同 ID。

==================================================
9. Error Mapping
==================================================

至少處理：

- UNAUTHORIZED
- INVALID_REQUEST
- DAILY_LIMIT_EXCEEDED
- PROVIDER_TIMEOUT
- PROVIDER_RATE_LIMIT
- PROVIDER_AUTH_FAILED
- PROVIDER_BAD_REQUEST
- PROVIDER_UNAVAILABLE
- PROVIDER_INVALID_RESPONSE
- STORAGE_UPLOAD_FAILED
- PERSISTENCE_FAILURE
- GENERATION_NOT_FOUND
- POLLING_FAILURE

所有錯誤都必須 normalized。

Provider 原始 exception、Supabase 原始 error、stack trace
不得直接回前端。

==================================================
10. Automated Testing
==================================================

Unit tests 至少包含：

1. Edge handler unauthorized
2. invalid request
3. provider success
4. provider timeout
5. provider rate limit
6. storage upload success
7. storage upload failure
8. persistence failure
9. successful status polling
10. failed terminal polling
11. owner-only status access
12. correlationId propagation
13. API key absent from response/log
14. base64 absent from response/log
15. terminal stops polling

自動測試全部使用 mock Gemini / mock Storage。

不得在一般 unit test 中打真實 Gemini。

完成後執行：

.\scripts\verify-local.ps1

若失敗，自行修正，直到全部 PASS。

==================================================
11. Real End-to-End Manual Test
==================================================

建立：

docs/testing/real-wallpaper-e2e.md

必須記錄：

1. 如何設定 Supabase Function secrets
2. 如何部署 generation function
3. 如何部署 status function
4. 如何啟動本機網站
5. 如何登入測試使用者
6. 如何選擇 mascot / gift
7. 如何按 Generate
8. 如何查看 polling
9. 如何確認 Storage 圖片
10. 如何確認 database generation/job 狀態
11. 如何依 correlationId 查 log
12. 如何確認 API key 未出現在 browser network response

Manual Acceptance Scenario：

Open wallpaper.html
→ Select owned mascot
→ Select gift
→ Generate
→ generationId received
→ polling processing
→ Gemini returns image
→ Storage upload succeeds
→ status succeeded
→ preview displays real image

==================================================
12. Review Package
==================================================

建立：

review/P2-AI-02-review.md

內容至少包含：

- 新增與修改檔案
- Runtime Architecture
- Edge Function Wiring
- Provider Wiring
- Storage Flow
- Database State Flow
- API Contract
- Frontend Integration
- Correlation Flow
- Security Review
- Automated Test Result
- Real E2E Manual Test Result
- Screenshots / evidence paths
- Known Limitations

必須清楚區分：

Automated tests

與

Real Gemini manual acceptance。

==================================================
Constraints
==================================================

不要：

- 修改已核准的 Business Rules
- 把 Gemini API Key 放入前端
- 把 Service Role Key 放入前端
- 在前端直接呼叫 Gemini
- 把 base64 存進 database
- 建立第二套 Generation Orchestrator
- 複製 Prompt Template 到 Edge Function
- 修改原有 migration（若需要 schema 變更，建立新 migration）
- Commit
- Push

完成後停止，等待 ChatGPT Review。