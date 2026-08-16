# Prompt Archive: P2-AI-01 Real Provider Adapter Integration Test

## 原始需求（整理版）

建立 `P2-AI-01` 的真實 Provider 驗證腳本。

---

## 目標

不要直接在測試腳本中呼叫 `GoogleGenAI`。  
必須透過目前已完成的 `GeminiProviderAdapter` 或 `provider factory` 執行一次真實圖片生成。

---

## 開始前要求

請先檢查並使用專案中的實際模組名稱與 exports，不得假設函式名稱。

---

## 建立檔案

- `scripts/test-real-gemini-provider.js`

---

## Requirements

### 1. 環境變數
從 `process.env` 讀取：

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_TIMEOUT`
- `GEMINI_MAX_RETRY`
- `IMAGE_SIZE`
- `SAFETY_LEVEL`

### 2. Provider 建立方式
必須透過現有 provider factory 或 `GeminiProviderAdapter` 建立 provider。

### 3. SDK 使用限制
不得在腳本中直接 `new GoogleGenAI`，除非現有 Adapter 的公開 factory 本來就需要注入 SDK client。

### 4. 呼叫方式
呼叫現有的：

- `generateWallpaper(...)`
- 或 Adapter 公開的等效方法

### 5. 傳入參數
至少傳入：

- `renderedPrompt`
- `correlationId`
- `metadata`
- `aspectRatio = 9:16`

### 6. Response 驗證
至少確認 normalized response 包含：

- `provider`
- `model`
- `durationMs`
- `image` 或 `imageUrl`
- `providerRequestId`（若 Gemini 有提供）
- `finishReason`（若有）

### 7. 輸出圖片
若回傳 base64 / inlineData：

- 寫入 `output/provider-adapter-wallpaper.png`
- 不得把完整 base64 印到 console

### 8. Console 安全輸出
Console 只輸出安全摘要：

- `provider`
- `model`
- `durationMs`
- `mimeType`
- `output path`
- `correlationId`

不得輸出：

- API key
- prompt 全文
- rawResponse
- base64 image data

### 9. Error Normalization
發生錯誤時必須顯示 normalized error：

- `failureCode`
- `failureMessage`
- `retryable`
- `correlationId`

不得直接印出含 secret 的 SDK 原始物件。

### 10. 不修改範圍
不得修改：

- Business Layer
- API
- DTO
- migration
- RLS

### 11. 交付限制
- 不要 commit
- 不要 push

---

## Manual Verification
若需要真實 Gemini 測試，請使用環境變數執行腳本，不可把 API key 寫入程式碼。

---

## Local Verification
完成後可執行：

- `.\scripts\verify-local.ps1`

---

## Review Package
如有需要，更新：

- `review/P2-AI-01-review.md`