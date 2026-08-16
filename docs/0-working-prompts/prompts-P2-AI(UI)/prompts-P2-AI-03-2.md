# P2-AI-03 Working Prompt (Implementation)

P2-AI-03 Analysis 已完成並通過 Product Review。

現在開始正式實作。

本次目標：

**Shopkeeper Context Agent**

---

## 必須先閱讀

請先完整閱讀：

- specs/002-p2-ai-prompt-builder/AI Constitution.md
- .specify/memory/constitution.md
- specs/002-p2-ai-prompt-builder/spec.md
- P2-AI-02 Review
- P2-AI-03 Analysis Report

請依照 AI Constitution 與 Product Review 實作。

不得自行改變 Architecture。

---

# Product Decisions（已定案）

以下內容已由 Product Review 決定：

✅ Lucky Theme

由 AI 生成。

不是固定主題池。

---

✅ Story

必要欄位。

若 AI 未提供 Story，

視同失敗。

進入 Fallback。

---

✅ One Liner

Optional。

---

✅ Shopkeeper Message

Optional。

---

✅ Mascot / Gift

由 Generation Service 查詢一次。

產生完整 DTO。

同時提供：

- Shopkeeper Context Agent
- Prompt Context Resolver

不得重複查詢 Repository。

---

✅ Wallpaper Prompt Builder

不得修改 Architecture。

不得加入任何 Shopkeeper 邏輯。

Builder 維持 Pure Function。

---

# Objective

建立：

Shopkeeper Context Agent。

Shopkeeper：

負責：

產生 Lucky Context。

不得：

組裝 Image Prompt。

不得：

呼叫 Image Provider。

---

# Architecture

必須維持：

Generation Service

↓

Mascot DTO

Gift DTO

↓

Shopkeeper Context Agent

↓

Shopkeeper Context

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

↓

Gemini

不得改變此流程。

---

# Shopkeeper Context Contract

請建立：

ShopkeeperContext

至少包含：

```json
{
    "luckyTheme": "",
    "blessing": "",
    "story": "",
    "oneLiner": "",
    "shopkeeperMessage": "",
    "version": ""
}
```

Story：

Required。

LuckyTheme：

Required。

Blessing：

Required。

OneLiner：

Optional。

ShopkeeperMessage：

Optional。

---

# Structured Output

Shopkeeper Agent：

必須要求 AI：

輸出：

JSON。

不得：

輸出：

Markdown。

不得：

輸出：

自由格式文字。

必須：

可以直接 Parse。

---

# Validator

新增：

Shopkeeper Context Validator。

驗證：

- luckyTheme

- blessing

- story

- version

若缺任何必要欄位：

直接：

Fallback。

不得回傳半成品。

---

# Fallback

建立：

Shopkeeper Fallback。

AI：

失敗時：

必須：

立即提供：

完整 Context。

不得：

中止圖片生成。

Fallback：

至少包含：

- luckyTheme

- blessing

- story

不得：

空字串。

---

# Prompt Registry

沿用：

daily_lucky_context

Prompt Type。

不得：

新增第二套 Prompt Registry。

---

# Snapshot

每次：

Shopkeeper：

成功：

保存：

shopkeeperSnapshot。

metadata_json：

新增：

```json
{
    "shopkeeperVersion": "",
    "shopkeeperSnapshot": {},
    "source": "ai|fallback"
}
```

不得新增資料表。

---

# Observability

新增：

至少：

- correlationId

- durationMs

- shopkeeperVersion

- source

AI：

與：

Fallback

必須：

可區分。

---

# Tests

新增：

至少：

1.

JSON Parse Success

2.

Missing Story

↓

Fallback

3.

Missing Blessing

↓

Fallback

4.

AI Timeout

↓

Fallback

5.

Provider Failure

↓

Fallback

6.

Same Mascot DTO

↓

產生一致 Lucky Context Structure

7.

Snapshot Persist

8.

metadata_json

包含：

shopkeeperSnapshot

---

# Out of Scope

本次禁止：

❌ UI 修改

❌ wallpaper.html

❌ Wallpaper Prompt Builder

❌ Prompt Context Resolver

❌ Prompt Validator

❌ Prompt Registry v2

❌ Wallpaper Lifecycle

❌ Image Provider

---

# Deliverables

完成後請提供：

1.

Architecture Diagram

2.

新增檔案

3.

修改檔案

4.

Shopkeeper Context Contract

5.

Fallback Strategy

6.

Observability

7.

所有新增 Tests

8.

verify-local.ps1

測試結果

9.

Constitution Compliance Checklist

---

# Important

本次：

不要 Commit。

不要 Push。

完成後等待 Product Review。

若發現更好的實作方式，

不得直接修改 Architecture。

請先提出：

- 問題
- 建議方案
- 優缺點
- 對既有設計的影響

等待 Product Review 後再實作。

## Shopkeeper Context Agent 必須專注於「產生 Lucky Context」，不得知道 Wallpaper Prompt 的內容，也不得知道圖片 Provider（Gemini、Replicate 等）的存在。任何與圖片生成相關的資訊都不得耦合到 Shopkeeper Agent。