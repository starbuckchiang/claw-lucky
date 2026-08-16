Architecture Review
⭐⭐⭐⭐⭐ Observability Layer 獨立

我很喜歡你們把它放在：

js/services/logging/

而不是：

js/services/wallpaper/

因為：

correlation-id
generation-logger
generation-tracing

其實都是跨領域（cross-cutting concern），未來 Shop、Order、AI Chat 都能共用。

⭐⭐⭐⭐⭐ Correlation ID

Review 顯示：

Generation Orchestrator
        ↓
Generation Service
        ↓
Success / Failure

都會攜帶同一個 correlationId。

這代表之後遇到問題時，可以從一筆 Log 串起整條生成流程。

⭐⭐⭐⭐⭐ Sensitive Data Masking

這點做得很好。

Logger 不會直接記錄：

Prompt 全文
User ID
Secret / Token / API Key

這符合最小揭露原則（least exposure）。

⭐⭐⭐⭐⭐ Error Trace

buildErrorTrace(...) 統一保留：

correlationId
errorCode
timestamp

這比直接寫 console.error(err) 好得多，也方便未來接 OpenTelemetry 或其他觀測平台。

Testing

目前：

56 Tests
56 Pass
0 Fail

加上：

Local Verification PASS
Module Load Smoke Test PASS

品質維持得很好。

我提出兩個 Minor 建議
① Log Level Policy

目前 Review 提到 Logger 與 Trace，但沒有看到明確的 Log Level 規範。

建議後續建立：

log-levels.js

例如：

DEBUG
INFO
WARN
ERROR

並規範：

INFO：正常流程
WARN：可恢復異常
ERROR：終止流程

這樣日後串接外部日誌平台時會更一致。

② Correlation Header

目前 correlationId 已存在於流程中。

建議未來（非現在）API 回應可以附帶：

X-Correlation-Id

這樣：

前端回報問題
客服
後端查 Log

都能用同一個 ID 快速定位。

這屬於未來增強，不需要現在實作。

ADR 建議

我建議新增：

ADR-008-observability-and-tracing.md

內容聚焦：

為什麼採用 Correlation ID
Logging Boundary
Structured Log
Error Trace
Sensitive Data Masking
未來 OpenTelemetry 擴充方向

項目	分數
Observability Architecture	10 / 10
Logging Design	10 / 10
Traceability	10 / 10
Security（敏感資訊遮罩）	10 / 10
Testing	10 / 10
Future Extensibility	9 / 10

Overall：99/100