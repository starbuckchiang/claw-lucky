目標：

建立 AI Generation 的診斷能力，讓開發與營運能快速追蹤一筆生成請求的完整生命週期。

這不是做監控平台，而是建立必要的診斷資訊。整條流程都帶著同一個 correlationId。


Generation Request
        │
        ▼
Correlation ID
        │
        ▼
Generation Orchestrator
        │
        ▼
Generation Service
        │
        ▼
Provider Adapter
        │
        ▼
Status API
        │
        ▼
Client Polling