P2-AI Roadmap
✅ P2-AI-01 AI Generation Pipeline（Done）

目標

建立 AI 圖片生成基礎能力。

完成項目：

Provider Adapter
Gemini
Retry
Storage
DB
Usage
Logging
Observability

驗收

能生成圖片
能儲存
能下載
🔴 P2-AI-02 Prompt Builder（目前要做）

目標

建立唯一且可驗證的 Prompt 組裝器。

修正：

企鵝變狐狸
Prompt 遺漏資訊
Character Consistency
Date Watermark
Composition

Deliverables

Wallpaper Prompt Builder
Prompt Validator
Prompt Schema
Unit Tests

驗收

使用固定 Input，每次都產生相同 Prompt。

🔴 P2-AI-03 Shopkeeper Context Agent

目標

正式加入「變色龍店長」。

負責：

今日 Lucky Theme
今日 Blessing
One-liner
今日故事

例如：

今天你的守護吉祥物是：

轉運小企鵝。

搭配幸運乒乓守護吊飾。

今天請勇敢迎接每一次挑戰。

輸出 JSON

{
  "luckyTheme": "...",
  "blessing": "...",
  "story": "...",
  "oneLiner": "..."
}
🔴 P2-AI-04 Wallpaper Workflow

把整個 AI Flow 串起來。

選吉祥物
      │
      ▼
選禮物
      │
      ▼
Shopkeeper Agent
      │
      ▼
顯示今日祝福
      │
      ▼
（可換一句）
      │
      ▼
Prompt Builder
      │
      ▼
Gemini
      │
      ▼
桌布

這才是真正完成產品流程。

🟡 P2-AI-05 Prompt Registry v2

升級 Prompt 管理。

例如：

shopkeeper-v1

wallpaper-v2

wallpaper-v3

支援：

Version
Rollback
A/B Test
🟡 P2-AI-06 Wallpaper Lifecycle

完成：

七天下載
Metadata
Expire
Cleanup
🟢 P2-AI-07 Personalization（未來）

例如：

使用者：

喜歡紅色
喜歡復古
常抽熊

Agent：

每天生成不同桌布。

調整重點

我建議把原本的 P2-AI-03（Prompt Builder）改名為 P2-AI-02，因為它是整個 AI 流程的基礎。

原因很簡單：

目前最大的阻礙不是店長，也不是 UI，而是 Prompt 無法正確描述要生成什麼。如果 Prompt Builder 沒做好，就算店長寫出再好的祝福，Gemini 還是可能把企鵝畫成狐狸。

因此，建議先完成：

P2-AI-02 Prompt Builder → P2-AI-03 Shopkeeper Context Agent → P2-AI-04 Wallpaper Workflow

這樣每一步都有清楚的依賴關係，開發和驗收也會更順暢。

## Known Issues / Follow-up Backlog（P2-AI-03 Gate C 驗收發現，非本次修改範圍）

以下 2 項於 P2-AI-03 Gate C 真實生成驗收過程中發現，記錄為後續 UI／資料待辦，**未在 P2-AI-03 中修改**：

1. **增加正式的桌布下載按鈕**：`wallpaper.html` 生成結果目前只顯示圖片本身，沒有獨立的「下載」按鈕，使用者僅能自行右鍵儲存。
2. **修正 Kuromi 占位圖片網址**：Gift「Kuromi」的預覽圖片目前指向占位網域 `https://your-domain/images/kuromi.png`，載入會直接失敗（`net::ERR_NAME_NOT_RESOLVED`），需改為正確的圖片網址。
