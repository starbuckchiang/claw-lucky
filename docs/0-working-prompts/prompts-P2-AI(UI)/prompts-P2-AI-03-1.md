# P2-AI-03 Working Prompt (Analysis)

P2-AI-02 已完成並通過 Product Review。

現在開始 P2-AI-03：

**Shopkeeper Context Agent**

本階段：

**只做分析與架構設計。**

禁止修改任何程式。

禁止 Commit。

禁止 Push。

---

## 必須先閱讀

請先完整閱讀：

- specs/002-p2-ai-prompt-builder/AI Constitution.md
- .specify/memory/constitution.md
- specs/002-p2-ai-prompt-builder/spec.md

以及：

- P2-AI-02 Review
- P2-AI-02 Architecture

理解目前 Prompt System。

---

# Product Goal

Lucky Wallpaper 並不是：

AI Image Generator。

真正產品是：

> 每天由變色龍店長替使用者打造一張專屬 Lucky Wallpaper。

因此：

Shopkeeper Agent：

不是 Prompt Builder。

也不是 Image Model。

而是：

Lucky Context Producer。

---

# 本次分析目標

分析：

Shopkeeper Context Agent

應該如何設計。

輸出：

完整 Architecture。

不得寫程式。

---

# Responsibilities

請分析：

Shopkeeper Context Agent

真正應負責哪些事情。

哪些事情：

絕對不能做。

例如：

應負責：

- Lucky Theme
- Blessing
- Story
- One Liner
- Shopkeeper Message

不應負責：

- Image Prompt
- Image Generation
- UI
- Wallpaper Layout

請逐項分析。

---

# Architecture

請設計：

Generation Flow：

User

↓

Select Mascot

↓

Select Gift

↓

Shopkeeper Context Agent

↓

Prompt Context Resolver

↓

Wallpaper Prompt Builder

↓

Gemini

請畫出完整流程。

---

# Context Contract

請設計：

Shopkeeper Agent

輸出的 JSON Contract。

例如：

{
    "luckyTheme": "...",
    "blessing": "...",
    "story": "...",
    "oneLiner": "...",
    "shopkeeperMessage": "...",
    "version": "..."
}

請說明：

每個欄位用途。

哪些是必要。

哪些可以省略。

---

# Prompt Strategy

請分析：

Shopkeeper Agent

應使用：

Structured Output

還是：

Free-form Text。

請說明原因。

---

# Determinism

哪些資訊：

必須 deterministic。

例如：

Date

Mascot

Gift

哪些資訊：

可以由 AI 自由生成。

例如：

Blessing

Story

請整理。

---

# Failure Strategy

如果：

Shopkeeper Agent：

失敗。

例如：

Timeout

Rate Limit

Provider Failure

應如何處理？

請提出：

Fallback Strategy。

---

# Observability

請提出：

需要紀錄哪些資料。

例如：

- contextVersion
- shopkeeperVersion
- correlationId

是否需要保存：

Shopkeeper JSON Snapshot。

請分析。

---

# AI Constitution Review

請逐條檢查：

目前設計：

是否符合：

AI Constitution。

若有衝突：

請指出。

---

# Deliverables

請輸出：

1.

Architecture Diagram

2.

Responsibility Matrix

3.

Generation Flow

4.

JSON Contract

5.

Failure Strategy

6.

Observability

7.

Risks

8.

Questions Requiring Product Decision

9.

Implementation Plan

---

# Important

本階段：

禁止：

- 修改程式
- 建立 Service
- 建立 Prompt
- 建立 Agent

只完成：

Architecture Analysis。

完成後等待 Product Review。
