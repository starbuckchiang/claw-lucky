P2-AI-02 已完成分析並經 Product Review 通過。

現在開始正式實作。

在開始修改程式前，請再次遵循：

- specs/002-p2-ai-prompt-builder/AI constitution.md
- .specify/memory/constitution.md
- specs/002-p2-ai-prompt-builder/spec.md

以及剛完成的分析報告。

==================================================
本次目標
==================================================

建立 Deterministic Prompt System。

本次不是修 Prompt 字串，而是建立完整且可長期維護的 Prompt Architecture。

請遵循 AI Constitution。

==================================================
Architecture
==================================================

請建立以下四個元件：

① Prompt Context Resolver

責任：

將目前 Generation Service 收到的 request 解析成完整的 WallpaperPromptInput。

Resolver 可以：

- 查詢 mascot 詳細資料
- 查詢 gift 詳細資料
- 產生 Asia/Taipei 日期
- 整理 style
- 整理 blessing
- 整理 luckyTheme

Resolver 可以依賴：

Repository
Database
Supabase

--------------------------------------------------

② Wallpaper Prompt Builder

責任：

唯一允許組裝 Image Prompt 的模組。

Builder 必須：

- Pure Function
- Deterministic
- 不查 Database
- 不呼叫 Repository
- 不依賴 Supabase
- 不讀 Environment

Builder：

輸入：

WallpaperPromptInput

輸出：

WallpaperPromptResult

相同 Input 必須產生完全相同 Prompt。

--------------------------------------------------

③ Prompt Validator

責任：

驗證：

- mascot
- gift
- blessing
- luckyTheme
- date
- style

缺任何必要欄位：

直接 ValidationError。

不得產生半成品 Prompt。

--------------------------------------------------

④ Prompt Snapshot

每次生成前：

保存：

- promptVersion
- promptSnapshot
- contextVersion

方便：

Debug
Replay
Observability

請盡量沿用現有 metadata_json。

==================================================
Implementation Rules
==================================================

Prompt Builder：

不得：

- 查 DB
- 查 Repository
- Fetch
- 呼叫 AI
- 猜測日期

只能：

WallpaperPromptInput

↓

Prompt

--------------------------------------------------

Prompt Context Resolver：

負責：

UUID

↓

完整 Mascot DTO

UUID

↓

完整 Gift DTO

↓

WallpaperPromptInput

--------------------------------------------------

Date

必須：

Asia/Taipei

不得：

UTC

不得：

Hardcode

--------------------------------------------------

Character

Prompt 必須包含：

Species

Appearance

Colors

Character Consistency Rules

不得只有：

mascotId

==================================================
Refactor
==================================================

請找出：

目前：

generation-service

內：

renderPrompt()

buildPromptContext()

將其重構：

Generation Service

↓

Prompt Context Resolver

↓

Prompt Validator

↓

Wallpaper Prompt Builder

↓

Prompt Snapshot

↓

Provider Adapter

Provider Adapter

不得再自行組 Prompt。

==================================================
Tests
==================================================

新增：

Unit Tests

至少包含：

1.
相同 Input

↓

相同 Prompt

2.
缺 mascot

↓

ValidationError

3.
缺 gift

↓

ValidationError

4.
日期固定格式

YYYY.MM.DD

Asia/Taipei

5.
Prompt 一定包含：

Species

Appearance

Gift

Blessing

Date

==================================================
Out of Scope
==================================================

本次禁止：

❌ Shopkeeper Context Agent

❌ Lucky Theme AI 生成

❌ Blessing AI 生成

❌ UI Workflow

❌ Wallpaper Lifecycle

❌ Prompt Registry v2

==================================================
Deliverables
==================================================

完成後請提供：

1.

Architecture Diagram

2.

修改檔案清單

3.

新增檔案清單

4.

Prompt Context Resolver 流程

5.

Wallpaper Prompt Builder Contract

6.

Prompt Validator Contract

7.

Prompt Snapshot 格式

8.

所有 Tests 結果

9.

Constitution Compliance Checklist

==================================================
Important
==================================================

不要只修 Bug。

請把這次視為：

AI Prompt Architecture Refactor。

所有修改必須符合 AI Constitution。

不要 Commit。

不要 Push。

完成後等待 Product Review。