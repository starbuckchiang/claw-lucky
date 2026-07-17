# Prompt Archive: P2-UI-02

## 原始需求（整理版）

請實作 `P2-UI-02`。

---

## 開始前閱讀

- `specs/001-ai-lucky-wallpaper/spec.md`
- `specs/001-ai-lucky-wallpaper/tasks.md`
- `docs/development/context.md`
- `ADR-006 Generation Status API`
- `ADR-007 Client Generation Workflow`
- `ADR-008 Observability and Tracing`

---

## 範圍限制

目前只允許完成：

- `P2-UI-02`

不得提前開始：

- `P2-UI-03`

---

## Goal

將 `wallpaper.html` 與既有 `claw-lucky` 系統整合。

完成後使用者不需輸入 `mascotId`、`giftId`，改由系統載入可選資料供使用者直接選擇。

---

## Required Features

### Collection
- 載入目前登入使用者的 Collection
- 只顯示「已擁有」吉祥物
- 若無收藏，顯示 Empty State

### Gifts
- 載入可使用 Gift
- 若無 Gift，顯示 Empty State

### Selection
- 使用 Card UI
- 不可用文字輸入 ID

### Preview
- 即時更新目前選擇的 Mascot + Gift

### Generate
- 送出既有 Generation Client
- 不得修改 Business Layer

### Error
- Collection Error / Gift Error / Loading Error 全部 Normalized
- 不得顯示 Raw Error

### Accessibility
- 保持 Keyboard Navigation
- 支援 Screen Reader
- 保留 ARIA

### Responsive
- Desktop / Tablet / Mobile

### Testing
至少涵蓋（全部 Mock，不依賴真實 Supabase）：
- Collection Success
- Collection Empty
- Gift Success
- Gift Empty
- Selection
- Preview
- Generation Submit

---

## Local Verification

完成後執行：

- `.\scripts\verify-local.ps1`

需完成：

- Module Load Smoke Test

---

## Review Package

更新：

- `review/P2-UI-02-review.md`

內容至少包含：
- UI Flow
- Component Tree
- Selection Flow
- Empty State
- Accessibility
- Responsive
- Tests
- Known Limitations

---

## 交付限制

- 不要 Commit
- 不要 Push
- 完成後停止
- 等待 ChatGPT Review

## Revision
不要再使用：
findModuleFile()
createProviderFromModule()
搜尋 Provider。
請直接使用：
Gemini Provider Factory。
或：
GeminiProviderAdapter。
P2-AI-01

目的：
驗證真正Gemini Provider。不是驗證未知 Provider。
測試腳本必須100%固定Gemini。
不要Dynamic Discovery。